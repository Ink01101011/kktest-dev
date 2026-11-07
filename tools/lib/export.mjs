// `kktest-dev export`: write per-target artifacts into an output folder (never into tool configs).
import fs from 'node:fs';
import path from 'node:path';
import { RefusedError, UsageError, claudeOnlyParts, portableSkillPlugins, selectPlugins, serverRuntimeDirs } from './catalog.mjs';
import { buildSkill, walk } from './skills.mjs';
import { createZip, readZip } from './zip.mjs';
import { CONFIG_KEY, codexToml, jsonEntry } from './mcp.mjs';
import { homeDir, liveToolDirs } from './paths.mjs';
import { lexists } from './safefs.mjs';

export const EXPORT_TARGETS = ['agents', 'claude-ai', 'chatgpt', 'gemini-extension', 'codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf'];
// Manifest of what the last export wrote into a folder; a re-export deletes only those files (G2-04).
export const MARKER = '.kktest-dev-export';
const MARKER_TOOL = 'kktest-dev export';

// Upload limits documented for OpenAI API skill bundles (developers.openai.com/api/docs/guides/tools-skills,
// checked 2026-11-08): 50 MB zip, 500 files, 25 MB per file. Applied to both zip targets as a conservative
// bound; neither the ChatGPT app nor claude.ai documents its own size limit (docs/providers.md).
const MB = 1024 * 1024;
const ZIP_MAX_FILES = 500;
const ZIP_MAX_FILE_BYTES = 25 * MB;
const ZIP_MAX_BYTES = 50 * MB;
const SERVERS_NOTE =
  'The config points at the servers/ folder inside this export with absolute paths: keep this folder, or move it first and fix the paths (or use `kktest-dev install`, which copies the servers to ~/.kktest-dev/servers).';

const CONFIG_FILE = {
  codex: 'config.toml',
  cursor: 'mcp.json',
  vscode: 'mcp.json',
  'claude-desktop': 'claude_desktop_config.json',
  windsurf: 'mcp_config.json',
};

const HOW_TO = {
  codex: 'Append config.toml to ~/.codex/config.toml (or .codex/config.toml in a trusted project).',
  cursor: 'Merge mcp.json into ~/.cursor/mcp.json (or .cursor/mcp.json in the project).',
  vscode: 'Merge mcp.json ("servers") into .vscode/mcp.json, or run "MCP: Open User Configuration" and paste there.',
  'claude-desktop':
    'Merge into claude_desktop_config.json (macOS ~/Library/Application Support/Claude/, Windows %APPDATA%\\Claude\\, Linux ~/.config/Claude/) and restart Claude Desktop.',
  windsurf:
    'Windsurf is now Devin Local (docs.devin.ai). Merge mcp_config.json ("mcpServers") into .devin/mcp_config.json (project), ~/.config/devin/mcp_config.json (user) or %APPDATA%\\devin\\mcp_config.json (Windows user). UNVERIFIED: whether Devin Local reads exactly these files (its page links to the Devin CLI docs for them).',
};

/** Files a server needs, keyed by path relative to the server copy root. */
export function serverRuntimeFiles(plugin, server, root) {
  const files = new Map();
  for (const d of serverRuntimeDirs(server)) {
    const src = path.join(plugin.dir, d);
    if (fs.statSync(src).isDirectory()) for (const rel of walk(src)) files.set(`${d}/${rel}`, path.join(src, ...rel.split('/')));
    else files.set(d, src);
  }
  for (const [dest, src] of Object.entries(plugin.extraFiles ?? {})) files.set(dest, path.join(root, ...src.split('/')));
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}

function skillPlugins(plugins, log) {
  const sel = portableSkillPlugins(plugins);
  sel.skipped.forEach((l) => log(l));
  return sel.plugins;
}

const reportSkipped = (plugins, log) => claudeOnlyParts(plugins).forEach((l) => log(l));

/** Plan an export: returns {dir, files: [{rel, data}], notes}. Nothing is written. */
export function planExport(catalog, target, { outDir, plugin, skill, log = () => {}, env = process.env, platform = process.platform }) {
  if (!EXPORT_TARGETS.includes(target)) throw new UsageError(`unknown export target "${target}" (one of: ${EXPORT_TARGETS.join(', ')})`);
  const plugins = selectPlugins(catalog, { plugin, skill });
  const files = [];
  const notes = [];
  const out = path.resolve(outDir);
  refuseLiveOut(out, { env, platform });
  let dir;

  if (target === 'agents' || target === 'claude-ai' || target === 'chatgpt') {
    dir = target === 'agents' ? path.join(out, '.agents') : path.join(out, target);
    reportSkipped(plugins, log);
    for (const p of skillPlugins(plugins, log)) {
      for (const s of p.skills) {
        const zip = target !== 'agents';
        const built = buildSkill(s, p, { zip, root: catalog.root });
        for (const n of built.notes) log(`${s.name}: ${n}`);
        if (!zip) {
          for (const [rel, data] of built.files) files.push({ rel: `skills/${s.name}/${rel}`, data });
          continue;
        }
        if (built.files.size > ZIP_MAX_FILES) throw new RefusedError(`${s.name}: ${built.files.size} files exceeds ${ZIP_MAX_FILES}`);
        const entries = [{ name: `${s.name}/` }];
        const dirs = new Set();
        for (const [rel, data] of built.files) {
          if (data.length > ZIP_MAX_FILE_BYTES) throw new RefusedError(`${s.name}: ${rel} is larger than ${ZIP_MAX_FILE_BYTES / MB} MB`);
          const parts = rel.split('/');
          for (let i = 1; i < parts.length; i++) dirs.add(`${s.name}/${parts.slice(0, i).join('/')}/`);
          entries.push({ name: `${s.name}/${rel}`, data });
        }
        for (const d of dirs) entries.push({ name: d });
        const zipBuf = createZip(entries);
        if (zipBuf.length > ZIP_MAX_BYTES) throw new RefusedError(`${s.name}: the zip is ${(zipBuf.length / MB).toFixed(1)} MB, over the ${ZIP_MAX_BYTES / MB} MB limit`);
        readZip(zipBuf); // self-check: CRCs and structure
        files.push({ rel: `${s.name}.zip`, data: zipBuf });
      }
    }
    if (target !== 'agents') {
      notes.push(
        target === 'claude-ai'
          ? 'Upload each zip at claude.ai: Customize > Skills > + > Create skill > Upload a skill (code execution must be enabled). Documented: name at most 64 characters, description at most 200, the skill folder at the zip root. Zip size limit: UNVERIFIED (not documented; these zips stay within the OpenAI API limits of 50 MB / 500 files / 25 MB per file).'
          : 'Upload each zip in ChatGPT: Plugins > Skills > Create > Upload from your computer. The zips stay within the documented OpenAI API skill limits (50 MB zip, 500 files, 25 MB per file); the ChatGPT app\'s own size limit and Plus/Pro eligibility are UNVERIFIED (its help page refuses automated reads).',
      );
    } else {
      notes.push('Copy skills/<name>/ into .agents/skills/ (project) or ~/.agents/skills/ (user). Read by Codex, Gemini CLI, VS Code Copilot, Copilot CLI and Cursor.');
    }
  } else if (target === 'gemini-extension') {
    const extName = plugin && !String(plugin).includes(',') ? String(plugin) : 'kktest-dev';
    dir = path.join(out, 'gemini-extension', extName);
    reportSkipped(plugins, log);
    for (const p of skillPlugins(plugins, log)) {
      for (const s of p.skills) {
        const built = buildSkill(s, p, { root: catalog.root });
        for (const [rel, data] of built.files) files.push({ rel: `skills/${s.name}/${rel}`, data });
      }
    }
    const mcpServers = {};
    for (const p of plugins) {
      for (const srv of p.mcpServers) {
        for (const [rel, src] of serverRuntimeFiles(p, srv, catalog.root)) files.push({ rel: `servers/${p.name}/${rel}`, data: fs.readFileSync(src) });
        const pathFor = (rel) => ['${extensionPath}', 'servers', p.name, ...rel.split('/')].join('${/}');
        mcpServers[srv.name] = jsonEntry('gemini', srv, pathFor).entry;
      }
    }
    const manifest = {
      name: extName,
      version: catalog.version,
      description:
        extName === 'kktest-dev'
          ? 'kktest-dev skills and MCP servers (exported from the Claude Code marketplace)'
          : String(plugins[0].description ?? '').slice(0, 300),
    };
    if (Object.keys(mcpServers).length) manifest.mcpServers = mcpServers;
    files.push({ rel: 'gemini-extension.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
    notes.push(`Install with: gemini extensions install <path-to>/gemini-extension/${extName}`);
  } else {
    dir = path.join(out, target);
    reportSkipped(plugins, log);
    const servers = [];
    const pathMap = new Map();
    for (const p of plugins) {
      for (const srv of p.mcpServers) {
        for (const [rel, src] of serverRuntimeFiles(p, srv, catalog.root)) files.push({ rel: `servers/${p.name}/${rel}`, data: fs.readFileSync(src) });
        servers.push(srv);
        pathMap.set(srv.name, p.name);
      }
    }
    if (!servers.length) log('no MCP servers in the selection');
    const sep = platform === 'win32' ? '\\' : '/';
    const pathFor = (srv) => (rel) => [dir, 'servers', pathMap.get(srv.name), ...rel.split('/')].join(sep);
    const allNotes = [];
    let text;
    if (target === 'codex') text = servers.map((srv) => codexToml(srv, pathFor(srv))).join('\n');
    else {
      const block = {};
      for (const srv of servers) {
        const r = jsonEntry(target, srv, pathFor(srv));
        block[srv.name] = r.entry;
        allNotes.push(...r.notes);
      }
      text = JSON.stringify({ [CONFIG_KEY[target]]: block }, null, 2) + '\n';
    }
    if (servers.length) files.push({ rel: CONFIG_FILE[target], data: Buffer.from(text) });
    notes.push(HOW_TO[target], ...allNotes);
    if (servers.length) notes.push(SERVERS_NOTE);
    if (target === 'windsurf') notes.push('Env references in "env" are UNVERIFIED for Windsurf/Devin (${env:VAR} is documented for OAuth fields only); secrets are left as placeholders.');
  }
  files.push({ rel: 'NOTES.txt', data: Buffer.from(notes.join('\n') + '\n') });
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  files.push({ rel: MARKER, data: Buffer.from(JSON.stringify({ tool: MARKER_TOOL, files: files.map((f) => f.rel) }, null, 2) + '\n') });
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { dir, files, notes };
}

const sameOrInside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const realish = (p) => {
  // realpath of the deepest existing ancestor + the rest, so /tmp vs /private/tmp compare equal
  const tail = [];
  let cur = p;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return p;
      tail.unshift(path.basename(cur));
      cur = up;
    }
  }
};

/** --out must not be HOME or a folder another tool reads live (~/.agents, ~/.codex, ...) (G2-04). */
function refuseLiveOut(out, { env, platform }) {
  let home;
  try {
    home = homeDir({ platform, env });
  } catch {
    return;
  }
  const o = realish(out);
  if (o === realish(home)) throw new RefusedError(`--out ${out} is your home folder; export writes a self-contained folder. Use --out <new folder>, or \`kktest-dev install\` to install into a tool`);
  for (const d of liveToolDirs({ platform, env })) {
    if (sameOrInside(o, realish(d))) throw new RefusedError(`--out ${out} is inside ${d}, which a tool reads live. Use another --out, or \`kktest-dev install\``);
  }
}

/** Files the previous export listed in its manifest; null when the folder has no manifest. */
function readManifest(dir) {
  const m = path.join(dir, MARKER);
  if (!lexists(m)) return null;
  if (!fs.lstatSync(m).isFile()) throw new RefusedError(`${m} is not a regular file; choose another --out`);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(m, 'utf8'));
  } catch {
    data = null;
  }
  const ok = data && data.tool === MARKER_TOOL && Array.isArray(data.files) && data.files.every((r) => typeof r === 'string' && safeRel(r));
  if (!ok) throw new RefusedError(`${m} is not a kktest-dev export manifest (or is from an older version); delete ${dir} by hand and export again`);
  return data.files;
}

const safeRel = (rel) => rel !== '' && !rel.startsWith('/') && !rel.includes('\\') && !rel.split('/').some((s) => s === '..' || s === '.' || s === '');

/** True when every folder between dir and dir/rel is a real folder (no links to escape through). */
function plainPath(dir, rel) {
  let cur = dir;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    cur = path.join(cur, parts[i]);
    if (!lexists(cur)) return true;
    if (!fs.lstatSync(cur).isDirectory()) return false;
  }
  return true;
}

/**
 * Write the export. A folder written before is updated in place: only files the previous manifest
 * lists are deleted, anything else (a skill the user added, say) is kept; a new file never
 * overwrites an unlisted one. A non-empty folder without a manifest is refused.
 */
export function writeExport(plan) {
  const { dir, files } = plan;
  let previous = [];
  if (lexists(dir)) {
    if (fs.lstatSync(dir).isSymbolicLink() || !fs.lstatSync(dir).isDirectory()) throw new RefusedError(`${dir} is not a plain folder; choose another --out`);
    const manifest = readManifest(dir);
    if (manifest === null && fs.readdirSync(dir).length) {
      throw new RefusedError(`${dir} exists and was not written by kktest-dev export; choose another --out`);
    }
    previous = manifest ? [...manifest, MARKER] : [];
  }
  const prev = new Set(previous);
  for (const f of files) {
    if (!safeRel(f.rel)) throw new RefusedError(`unsafe export path ${f.rel}`);
    if (!plainPath(dir, f.rel)) throw new RefusedError(`${path.join(dir, f.rel)}: a folder on the way is a link or a file; not writing through it`);
    const dest = path.join(dir, ...f.rel.split('/'));
    if (!prev.has(f.rel) && lexists(dest)) throw new RefusedError(`${dest} exists and the previous export did not write it; not overwriting it`);
  }
  // Delete what the previous export wrote (regular files only), then the folders it emptied.
  const emptied = new Set();
  for (const rel of previous) {
    if (!plainPath(dir, rel)) continue;
    const f = path.join(dir, ...rel.split('/'));
    if (lexists(f) && fs.lstatSync(f).isFile()) fs.unlinkSync(f);
    for (let d = path.dirname(f); d !== dir && sameOrInside(d, dir); d = path.dirname(d)) emptied.add(d);
  }
  for (const d of [...emptied].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(d);
    } catch {
      // not empty: holds files the previous export did not write; keep them
    }
  }
  for (const f of files) {
    const dest = path.join(dir, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data, { flag: 'wx' });
  }
}
