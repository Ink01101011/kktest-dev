// `kktest-dev install`: dry-run by default; --apply backs up, merges, and writes atomically.
import fs from 'node:fs';
import path from 'node:path';
import { UsageError, claudeOnlyParts, portableSkillPlugins, selectPlugins } from './catalog.mjs';
import { buildSkill } from './skills.mjs';
import { serverRuntimeFiles } from './export.mjs';
import { CONFIG_KEY, codexTableState, codexToml, hasJsonComments, jsonEntry } from './mcp.mjs';
import { targetPaths } from './paths.mjs';
import { INSTALL_MCP_TARGETS, INSTALL_TARGETS, orList } from './providers.mjs';
import { ApplyError, acquireLock, atomicWrite, backupFile, checkTarget, freshPath, lexists, modeOf, moveDir, rand, renameRetry, sha256 } from './safefs.mjs';

export function timestamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Regular files of a folder (rel -> path), or null when it holds anything else (symlink, FIFO, device). */
function dirFiles(dir) {
  const out = new Map();
  const rec = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (!rec(full)) return false;
      } else if (ent.isFile()) out.set(path.relative(dir, full).split(path.sep).join('/'), full);
      else return false; // never follow or read links and special files (G2-07)
    }
    return true;
  };
  return rec(dir) ? out : null;
}

function sameTree(dir, files) {
  const have = dirFiles(dir);
  if (!have || have.size !== files.size) return false;
  for (const [rel, data] of files) {
    const f = have.get(rel);
    if (!f || fs.lstatSync(f).size !== data.length || !fs.readFileSync(f).equals(data)) return false;
  }
  return true;
}

/** Number of actions that would change something on disk. */
export const pendingChanges = (plan) => plan.actions.filter((a) => a.kind === 'file' || a.state !== 'identical');

/**
 * Build the install plan. Pure apart from reading the filesystem.
 * @returns {{actions: object[], refusals: string[], manual: string[], notes: string[]}}
 */
export function planInstall(catalog, target, opts) {
  const { scope = 'user', plugin, skill, only = 'all', force = false, platform = process.platform, env = process.env, cwd = process.cwd() } = opts;
  if (!INSTALL_TARGETS.includes(target)) throw new UsageError(`unknown install target "${target}" (one of: ${INSTALL_TARGETS.join(', ')})`);
  if (!['user', 'project'].includes(scope)) throw new UsageError(`--scope must be user or project`);
  if (!['all', 'skills', 'mcp'].includes(only)) throw new UsageError(`--only must be all, skills or mcp`);
  const tp = targetPaths(target, { platform, env, scope, cwd });
  const p = platform === 'win32' ? path.win32 : path.posix;
  const refusals = [];
  const manual = [];
  const notes = [...tp.notes];
  const actions = [];
  const plan = { actions, refusals, manual, notes, paths: tp, platform, stateDir: p.join(tp.home, '.kktest-dev') };
  if (tp.unsupported) {
    refusals.push(tp.unsupported);
    return plan;
  }
  const plugins = selectPlugins(catalog, { plugin, skill });
  // Unique per run, so two installs in the same second never share a backup folder (G1-09/G2-06).
  const ts = opts.timestamp ?? `${timestamp()}-${rand()}`;
  plan.ts = ts;
  const backupRoot = p.join(plan.stateDir, 'backups', ts);

  // Skills -> .agents/skills/<name>
  if (tp.skillsDir && only !== 'mcp') {
    const sel = portableSkillPlugins(plugins);
    notes.push(...sel.skipped);
    for (const pl of sel.plugins) {
      for (const s of pl.skills) {
        const { files } = buildSkill(s, pl, { root: catalog.root });
        const dest = p.join(tp.skillsDir, s.name);
        const g = checkTarget(dest, { root: tp.root, scope, kind: 'dir', platform });
        if (!g.ok) {
          refusals.push(`skill ${s.name}: ${g.reason}`);
          continue;
        }
        let state = 'new';
        if (lexists(dest)) {
          if (sameTree(dest, files)) state = 'identical';
          else if (force) state = 'replace';
          else {
            refusals.push(`skill ${s.name}: ${dest} already exists with different content (use --force to replace; the old folder is backed up)`);
            continue;
          }
        }
        actions.push({ kind: 'dir', what: `skill ${s.name}`, dest, files, state, backup: p.join(backupRoot, 'skills', s.name), guard: { root: tp.root, scope } });
      }
    }
  } else if (only === 'skills' && !tp.skillsDir) {
    notes.push(`${target} has no documented local skills folder; use export --target claude-ai for zip upload`);
  }
  if (only === 'mcp' && !tp.format) notes.push(`${target} has no MCP config; pick ${orList(INSTALL_MCP_TARGETS)}`);

  // MCP servers
  const servers = [];
  if (tp.format && only !== 'skills') {
    for (const pl of plugins) {
      for (const srv of pl.mcpServers) {
        const files = new Map([...serverRuntimeFiles(pl, srv, catalog.root)].map(([rel, src]) => [rel, fs.readFileSync(src)]));
        const dest = p.join(tp.serversDir, pl.name);
        servers.push({ srv, pathFor: (rel) => p.join(dest, ...rel.split('/')) });
        if (actions.some((a) => a.dest === dest)) continue;
        // Our own folder under ~/.kktest-dev, whatever the scope.
        const g = checkTarget(dest, { root: tp.home, scope: 'user', kind: 'dir', platform });
        if (!g.ok) {
          refusals.push(`MCP server runtime ${pl.name}: ${g.reason}`);
          continue;
        }
        let state = 'new';
        if (lexists(dest)) state = sameTree(dest, files) ? 'identical' : 'replace'; // our own managed folder
        actions.push({ kind: 'dir', what: `MCP server runtime ${pl.name}`, dest, files, state, backup: p.join(backupRoot, 'servers', pl.name), guard: { root: tp.home, scope: 'user' } });
      }
    }
  }
  notes.push(...claudeOnlyParts(plugins));

  if (servers.length) {
    if (tp.format === 'codex-toml') planToml(tp.mcpConfig, servers, { refusals, actions, root: tp.configRoot, scope, platform });
    else if (tp.manual === 'code --add-mcp') {
      for (const { srv, pathFor } of servers) {
        const { entry } = jsonEntry('vscode', srv, pathFor);
        const json = JSON.stringify({ name: srv.name, ...entry });
        if (platform === 'win32') {
          // cmd.exe keeps \" inside double quotes; PowerShell does not, so it gets the stop-parsing
          // token --% which hands the rest of the line to code.cmd unchanged (G1-07, G3-X6).
          const cmd = `--add-mcp "${json.replace(/"/g, '\\"')}"`;
          manual.push(`(cmd.exe) code ${cmd}`, `(PowerShell) code --% ${cmd}`);
        } else manual.push(`code --add-mcp '${json.replace(/'/g, "'\\''")}'`);
      }
      notes.push('VS Code user scope: the user mcp.json path is not documented, so run the printed `code --add-mcp` command(s) yourself (or use --scope project).');
    } else planJson(tp.mcpConfig, target, servers, { refusals, actions, notes, force, root: tp.configRoot, scope, platform });
    if (scope === 'project' && tp.mcpConfig) notes.push(`${tp.mcpConfig} will hold absolute paths under ${tp.serversDir}; do not commit it for a team`);
    if (platform === 'win32' && servers.some(({ srv }) => srv.command === 'python3')) {
      notes.push('Windows: if `python3` opens the Microsoft Store, change the server command to `py` with "-3" as the first argument (or to `python`).');
    }
    if (platform === 'linux' && (env.WSL_DISTRO_NAME || env.WSL_INTEROP) && ['claude-desktop', 'cursor', 'vscode'].includes(target)) {
      notes.push(`WSL: ${target} usually runs on the Windows side and does not read this Linux config; run kktest-dev from Windows for it.`);
    }
  }
  if (target === 'claude-desktop') notes.push('Claude Desktop has no local skills folder; upload skills with `export --target claude-ai`. Restart Claude Desktop after the config changes.');
  return plan;
}

/** Read an existing config through the guard. @returns {{refused: string}|{real, buf, exists, mode}} */
function readGuarded(file, { root, scope, platform }) {
  const g = checkTarget(file, { root, scope, kind: 'file', platform });
  if (!g.ok) return { refused: g.reason };
  const exists = lexists(g.real);
  if (exists && !fs.statSync(g.real).isFile()) return { refused: `${file} is not a regular file` };
  const buf = exists ? fs.readFileSync(g.real) : null;
  const link = g.real !== file ? ` (symlink -> ${g.real}; the link is kept)` : '';
  return { real: g.real, buf, exists, mode: modeOf(g.real), link };
}

function planJson(file, target, servers, { refusals, actions, notes, force, root, scope, platform }) {
  const key = CONFIG_KEY[target];
  const entries = {};
  for (const { srv, pathFor } of servers) {
    const r = jsonEntry(target, srv, pathFor);
    entries[srv.name] = r.entry;
    notes.push(...r.notes);
  }
  const snippet = JSON.stringify({ [key]: entries }, null, 2);
  const cur = readGuarded(file, { root, scope, platform });
  if (cur.refused) {
    refusals.push(`${cur.refused}. Paste this into "${key}" by hand:\n${snippet}`);
    return;
  }
  let doc = {};
  let bom = false;
  let crlf = false;
  if (cur.exists) {
    let text = cur.buf.toString('utf8');
    bom = text.startsWith('﻿'); // Windows PowerShell 5.1 and old Notepad write one (G3-X4)
    if (bom) text = text.slice(1);
    crlf = text.includes('\r\n');
    if (hasJsonComments(text)) {
      refusals.push(`${file} contains comments; kktest-dev will not rewrite it. Paste this into "${key}" by hand:\n${snippet}`);
      return;
    }
    try {
      doc = text.trim() ? JSON.parse(text) : {};
    } catch {
      refusals.push(`${file} is not valid JSON; kktest-dev will not rewrite it. Paste this into "${key}" by hand:\n${snippet}`);
      return;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc[key] !== undefined && (typeof doc[key] !== 'object' || doc[key] === null || Array.isArray(doc[key])))) {
      refusals.push(`${file}: unexpected shape (top level or "${key}" is not an object); not touching it`);
      return;
    }
  }
  const block = { ...(doc[key] ?? {}) };
  const added = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (name in block) {
      if (deepEqual(block[name], entry)) continue;
      if (!force) {
        refusals.push(`${file}: "${key}.${name}" already exists with different settings (use --force to replace it)`);
        continue;
      }
    }
    block[name] = entry;
    added.push(name);
  }
  if (!added.length) return;
  let content = JSON.stringify({ ...doc, [key]: block }, null, 2) + '\n';
  if (crlf) content = content.replace(/\n/g, '\r\n'); // keep the file's line endings (G3-N1)
  if (bom) content = '﻿' + content;
  const show = JSON.stringify({ [key]: Object.fromEntries(added.map((n) => [n, entries[n]])) }, null, 2);
  actions.push(fileAction(file, cur, { what: `merge ${added.map((n) => `${key}.${n}`).join(', ')}`, content, show, root, scope }));
}

function fileAction(file, cur, { what, content, show, root, scope }) {
  return { kind: 'file', what: what + cur.link, dest: file, real: cur.real, content, show, exists: cur.exists, mode: cur.mode, hash: cur.buf ? sha256(cur.buf) : null, guard: { root, scope } };
}

function planToml(file, servers, { refusals, actions, root, scope, platform }) {
  const cur = readGuarded(file, { root, scope, platform });
  if (cur.refused) {
    refusals.push(`${cur.refused}. Add this to config.toml by hand:\n${servers.map(({ srv, pathFor }) => codexToml(srv, pathFor)).join('\n')}`);
    return;
  }
  const existing = cur.exists ? cur.buf.toString('utf8') : '';
  const tables = [];
  for (const { srv, pathFor } of servers) {
    const state = codexTableState(existing, srv.name);
    const table = codexToml(srv, pathFor);
    if (state === 'present') {
      // Never edit an existing table: no TOML parser here, and the user may have tuned it.
      // --force does not apply here (documented in --help and docs/providers.md).
      if (!existing.replace(/\r\n/g, '\n').includes(table.trim())) {
        refusals.push(`${file}: [mcp_servers.${srv.name}] already exists; remove it by hand (or \`codex mcp remove ${srv.name}\`) to reinstall. --force does not apply to config.toml`);
      }
      continue;
    }
    if (state === 'unsure') {
      refusals.push(`${file}: cannot tell whether mcp_servers.${srv.name} is defined (unusual TOML layout); add this by hand:\n${table}`);
      continue;
    }
    tables.push({ name: srv.name, table });
  }
  if (!tables.length) return;
  const nl = existing.includes('\r\n') ? '\r\n' : '\n';
  const add = tables.map((t) => t.table).join('\n');
  const sep = existing === '' ? '' : existing.endsWith(nl + nl) ? '' : existing.endsWith(nl) ? nl : nl + nl;
  const content = existing + sep + (nl === '\n' ? add : add.replace(/\n/g, nl));
  actions.push(fileAction(file, cur, { what: `append ${tables.map((t) => `[mcp_servers.${t.name}]`).join(', ')}`, content, show: add, root, scope }));
}

export function formatPlan(plan, { target, scope, apply }) {
  const lines = [`${apply ? 'install' : 'dry run'}: target=${target} scope=${scope}`];
  for (const a of plan.actions) {
    if (a.kind === 'dir') lines.push(`  ${a.state === 'identical' ? 'unchanged' : a.state === 'replace' ? 'replace  ' : 'create   '} ${a.what} -> ${a.dest}${a.state === 'replace' ? ` (old copy backed up to ${a.backup})` : ''}`);
    else {
      lines.push(`  ${a.exists ? 'update   ' : 'create   '} ${a.dest}: ${a.what}${a.exists ? ' (backup: <file>.kktest-dev.bak-<timestamp>-<random>)' : ''}`);
      lines.push(...a.show.split('\n').map((l) => `      ${l}`));
    }
  }
  for (const m of plan.manual) lines.push(`  manual step: ${m}`);
  for (const n of plan.notes) lines.push(`  note: ${n}`);
  for (const r of plan.refusals) lines.push(`  REFUSED: ${r}`);
  const changes = pendingChanges(plan).length;
  if (!apply) lines.push(changes ? `${changes} change(s). Nothing written; re-run with --apply to write.` : 'Nothing to change.');
  return lines.join('\n');
}

/** Re-check every action against the disk right before writing (the plan may be minutes old). */
function verify(plan) {
  for (const a of plan.actions) {
    const g = checkTarget(a.dest, { root: a.guard.root, scope: a.guard.scope, kind: a.kind, platform: plan.platform });
    if (!g.ok) throw new ApplyError(`${g.reason}; nothing was written`);
    if (a.kind === 'file') {
      if (g.real !== a.real) throw new ApplyError(`${a.dest} now resolves to ${g.real}; nothing was written. Re-run the install.`);
      const now = lexists(a.real) ? sha256(fs.readFileSync(a.real)) : null;
      if (now !== a.hash) throw new ApplyError(`${a.dest} changed after the plan was printed; nothing was written. Re-run the install.`);
    } else if (a.state === 'new' && lexists(a.dest)) {
      throw new ApplyError(`${a.dest} appeared after the plan was printed; nothing was written. Re-run the install.`);
    }
  }
}

function applyDir(a, { platform, retry, log }) {
  const tmp = `${a.dest}.kktest-dev.tmp-${rand()}`;
  let backup = null;
  try {
    fs.mkdirSync(path.dirname(a.dest), { recursive: true });
    fs.mkdirSync(tmp); // exclusive: fails on anything already there, including a planted link
    for (const [rel, data] of a.files) {
      const f = path.join(tmp, ...rel.split('/'));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, data, { flag: 'wx' });
    }
    if (lexists(a.dest)) {
      backup = freshPath(a.backup);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      moveDir(a.dest, backup, { platform, delays: retry }); // copy + delete across volumes (G3-X1)
      log(`backed up ${a.dest} -> ${backup}`);
    }
    try {
      renameRetry(tmp, a.dest, { platform, delays: retry });
    } catch (e) {
      let where = '';
      if (backup) {
        try {
          moveDir(backup, a.dest, { platform, delays: retry });
          where = ' The previous folder was put back in place.';
        } catch {
          where = ` The previous folder is at ${backup}; move it back to ${a.dest} by hand.`;
        }
      }
      throw new ApplyError(`could not move the new ${a.what} into ${a.dest} (${e.code ?? e.message}).${where}`);
    }
    log(`wrote ${a.dest}`);
  } catch (e) {
    if (e instanceof ApplyError) throw e;
    throw new ApplyError(`${a.what}: ${e.message}${backup ? ` (the previous folder is at ${backup})` : ''}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function applyFile(a, { ts, platform, log }) {
  let bak = null;
  try {
    fs.mkdirSync(path.dirname(a.real), { recursive: true });
    if (lexists(a.real)) {
      bak = backupFile(a.real, ts);
      log(`backed up ${a.dest} -> ${bak}`);
    }
    atomicWrite(a.real, a.content, { mode: a.mode, platform });
    log(`wrote ${a.dest}`);
  } catch (e) {
    throw new ApplyError(`could not write ${a.dest} (${e.code ?? e.message}); the original is unchanged${bak ? ` and a copy is at ${bak}` : ''}`);
  }
}

/**
 * Write the plan. Holds ~/.kktest-dev/install.lock, re-checks every target first, then writes.
 * `log` gets each line as it happens, so a later failure never hides what was already done.
 */
export function applyPlan(plan, { timestamp: ts = plan.ts ?? timestamp(), log = () => {}, retry } = {}) {
  const done = [];
  const say = (l) => {
    done.push(l);
    log(l);
  };
  const platform = plan.platform ?? process.platform;
  const release = acquireLock(plan.stateDir);
  try {
    verify(plan);
    for (const a of plan.actions) {
      if (a.kind === 'dir') {
        if (a.state !== 'identical') applyDir(a, { platform, retry, log: say });
      } else applyFile(a, { ts, platform, log: say });
    }
  } finally {
    release();
  }
  return done;
}
