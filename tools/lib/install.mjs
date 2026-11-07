// `kktest-dev install`: dry-run by default; --apply backs up, merges, and writes atomically.
import fs from 'node:fs';
import path from 'node:path';
import { RefusedError, UsageError, selectPlugins } from './catalog.mjs';
import { buildSkill } from './skills.mjs';
import { serverRuntimeFiles } from './export.mjs';
import { CONFIG_KEY, codexTableState, codexToml, hasJsonComments, jsonEntry } from './mcp.mjs';
import { INSTALL_TARGETS, homeDir, targetPaths } from './paths.mjs';

const CONFIG_TARGET = { 'gemini-json': 'gemini', 'cursor-json': 'cursor', 'vscode-json': 'vscode', 'claude-desktop-json': 'claude-desktop' };

export function timestamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function dirFiles(dir) {
  const out = new Map();
  const rec = (d, base) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (ent.isDirectory()) rec(full, base);
      else out.set(rel, fs.readFileSync(full));
    }
  };
  if (fs.existsSync(dir)) rec(dir, dir);
  return out;
}

function sameTree(dir, files) {
  const have = dirFiles(dir);
  if (have.size !== files.size) return false;
  for (const [rel, data] of files) if (!have.has(rel) || !have.get(rel).equals(data)) return false;
  return true;
}

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
  const refusals = [];
  const manual = [];
  const notes = [];
  const actions = [];
  if (tp.unsupported) {
    refusals.push(tp.unsupported);
    return { actions, refusals, manual, notes, paths: tp };
  }
  const plugins = selectPlugins(catalog, { plugin, skill });
  const p = platform === 'win32' ? path.win32 : path.posix;
  const ts = opts.timestamp ?? timestamp();
  const backupRoot = p.join(homeDir({ platform, env }), '.kktest-dev', 'backups', ts);

  // Skills -> .agents/skills/<name>
  if (tp.skillsDir && only !== 'mcp') {
    for (const pl of plugins) {
      if (!pl.skills.length) continue;
      if (pl.tier === 'Claude-only') {
        notes.push(`skip ${pl.name}: Claude-only (${pl.note})`);
        continue;
      }
      for (const s of pl.skills) {
        const { files } = buildSkill(s, pl, { root: catalog.root });
        const dest = p.join(tp.skillsDir, s.name);
        let state = 'new';
        if (fs.existsSync(dest)) {
          if (sameTree(dest, files)) state = 'identical';
          else if (force) state = 'replace';
          else {
            refusals.push(`skill ${s.name}: ${dest} already exists with different content (use --force to replace; the old folder is backed up)`);
            continue;
          }
        }
        actions.push({ kind: 'dir', what: `skill ${s.name}`, dest, files, state, backup: p.join(backupRoot, 'skills', s.name) });
      }
    }
  } else if (only === 'skills' && !tp.skillsDir) {
    notes.push(`${target} has no documented local skills folder; use export --target claude-ai for zip upload`);
  }

  // MCP servers
  const servers = [];
  if (tp.format && only !== 'skills') {
    for (const pl of plugins) {
      for (const srv of pl.mcpServers) {
        const files = new Map([...serverRuntimeFiles(pl, srv, catalog.root)].map(([rel, src]) => [rel, fs.readFileSync(src)]));
        const dest = p.join(tp.serversDir, pl.name);
        let state = 'new';
        if (fs.existsSync(dest)) state = sameTree(dest, files) ? 'identical' : 'replace'; // our own managed folder
        if (!actions.some((a) => a.dest === dest)) {
          actions.push({ kind: 'dir', what: `MCP server runtime ${pl.name}`, dest, files, state, backup: p.join(backupRoot, 'servers', pl.name) });
        }
        servers.push({ srv, pathFor: (rel) => p.join(dest, ...rel.split('/')) });
      }
    }
    for (const pl of plugins) {
      if (pl.hasHooks) notes.push(`skip ${pl.name} hooks: Claude Code only`);
    }
  }

  if (servers.length) {
    if (tp.format === 'codex-toml') planToml(tp.mcpConfig, servers, { refusals, actions, force });
    else if (tp.manual === 'code --add-mcp') {
      for (const { srv, pathFor } of servers) {
        const { entry } = jsonEntry('vscode', srv, pathFor);
        const json = JSON.stringify({ name: srv.name, ...entry });
        manual.push(platform === 'win32' ? `code --add-mcp "${json.replace(/"/g, '\\"')}"` : `code --add-mcp '${json.replace(/'/g, "'\\''")}'`);
      }
      notes.push('VS Code user scope: the user mcp.json path is not documented, so run the printed `code --add-mcp` command(s) yourself (or use --scope project).');
    } else planJson(tp.mcpConfig, CONFIG_TARGET[tp.format], servers, { refusals, actions, notes, manual, force });
  }
  if (target === 'claude-desktop') notes.push('Claude Desktop has no local skills folder; upload skills with `export --target claude-ai`. Restart Claude Desktop after the config changes.');
  return { actions, refusals, manual, notes, paths: tp };
}

function planJson(file, target, servers, { refusals, actions, notes, manual, force }) {
  const key = CONFIG_KEY[target];
  const entries = {};
  for (const { srv, pathFor } of servers) {
    const r = jsonEntry(target, srv, pathFor);
    entries[srv.name] = r.entry;
    notes.push(...r.notes);
  }
  const snippet = JSON.stringify({ [key]: entries }, null, 2);
  let doc = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
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
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc[key] !== undefined && (typeof doc[key] !== 'object' || Array.isArray(doc[key])))) {
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
  const next = { ...doc, [key]: block };
  const show = JSON.stringify({ [key]: Object.fromEntries(added.map((n) => [n, entries[n]])) }, null, 2);
  actions.push({ kind: 'file', what: `merge ${added.map((n) => `${key}.${n}`).join(', ')}`, dest: file, content: JSON.stringify(next, null, 2) + '\n', show, exists: fs.existsSync(file) });
}

function planToml(file, servers, { refusals, actions }) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const tables = [];
  for (const { srv, pathFor } of servers) {
    const state = codexTableState(existing, srv.name);
    const table = codexToml(srv, pathFor);
    if (state === 'present') {
      // Never edit an existing table: no TOML parser here, and the user may have tuned it.
      if (!existing.includes(table.trim())) refusals.push(`${file}: [mcp_servers.${srv.name}] already exists; remove it by hand (or \`codex mcp remove ${srv.name}\`) to reinstall`);
      continue;
    }
    if (state === 'unsure') {
      refusals.push(`${file}: cannot tell whether mcp_servers.${srv.name} is defined (unusual TOML layout); add this by hand:\n${table}`);
      continue;
    }
    tables.push({ name: srv.name, table });
  }
  if (!tables.length) return;
  const add = tables.map((t) => t.table).join('\n');
  const sep = existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  actions.push({ kind: 'file', what: `append ${tables.map((t) => `[mcp_servers.${t.name}]`).join(', ')}`, dest: file, content: existing + sep + add, show: add, exists: existing !== '' || fs.existsSync(file) });
}

export function formatPlan(plan, { target, scope, apply }) {
  const lines = [`${apply ? 'install' : 'dry run'}: target=${target} scope=${scope}`];
  for (const a of plan.actions) {
    if (a.kind === 'dir') lines.push(`  ${a.state === 'identical' ? 'unchanged' : a.state === 'replace' ? 'replace  ' : 'create   '} ${a.what} -> ${a.dest}${a.state === 'replace' ? ` (old copy backed up to ${a.backup})` : ''}`);
    else {
      lines.push(`  ${a.exists ? 'update   ' : 'create   '} ${a.dest}: ${a.what}${a.exists ? ' (backup: <file>.kktest-dev.bak-<timestamp>)' : ''}`);
      lines.push(...a.show.split('\n').map((l) => `      ${l}`));
    }
  }
  for (const m of plan.manual) lines.push(`  manual step: ${m}`);
  for (const n of plan.notes) lines.push(`  note: ${n}`);
  for (const r of plan.refusals) lines.push(`  REFUSED: ${r}`);
  const changes = plan.actions.filter((a) => a.kind === 'file' || a.state !== 'identical').length;
  if (!apply) lines.push(changes ? `${changes} change(s). Nothing written; re-run with --apply to write.` : 'Nothing to change.');
  return lines.join('\n');
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.kktest-dev.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function applyPlan(plan, { timestamp: ts = timestamp() } = {}) {
  const done = [];
  for (const a of plan.actions) {
    if (a.kind === 'dir') {
      if (a.state === 'identical') continue;
      const tmp = `${a.dest}.kktest-dev.tmp-${process.pid}`;
      fs.rmSync(tmp, { recursive: true, force: true });
      for (const [rel, data] of a.files) {
        const f = path.join(tmp, ...rel.split('/'));
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, data);
      }
      if (fs.existsSync(a.dest)) {
        fs.mkdirSync(path.dirname(a.backup), { recursive: true });
        fs.renameSync(a.dest, a.backup);
        done.push(`backed up ${a.dest} -> ${a.backup}`);
      }
      fs.mkdirSync(path.dirname(a.dest), { recursive: true });
      fs.renameSync(tmp, a.dest);
      done.push(`wrote ${a.dest}`);
    } else {
      if (fs.existsSync(a.dest)) {
        const bak = `${a.dest}.kktest-dev.bak-${ts}`;
        fs.copyFileSync(a.dest, bak);
        done.push(`backed up ${a.dest} -> ${bak}`);
      }
      atomicWrite(a.dest, a.content);
      done.push(`wrote ${a.dest}`);
    }
  }
  return done;
}

export { RefusedError };
