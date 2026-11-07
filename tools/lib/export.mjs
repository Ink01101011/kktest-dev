// `kktest-dev export`: write per-target artifacts into an output folder (never into tool configs).
import fs from 'node:fs';
import path from 'node:path';
import { RefusedError, UsageError, selectPlugins, serverRuntimeDirs } from './catalog.mjs';
import { buildSkill, walk } from './skills.mjs';
import { createZip, readZip } from './zip.mjs';
import { jsonSnippet, codexSnippet } from './mcp.mjs';

export const EXPORT_TARGETS = ['agents', 'claude-ai', 'chatgpt', 'gemini-extension', 'codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf'];
const MARKER = '.kktest-dev-export';

// Upload limits documented for OpenAI skill bundles (developers.openai.com/api/docs/guides/tools-skills).
const ZIP_MAX_FILES = 500;
const ZIP_MAX_FILE_BYTES = 25 * 1024 * 1024;

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
    'UNVERIFIED: Windsurf is now documented as Devin Local (docs.devin.ai). Its MCP file is .devin/mcp_config.json (project) or ~/.config/devin/mcp_config.json (user); check the format against the tool\'s docs before pasting.',
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
  const out = [];
  for (const p of plugins) {
    if (!p.skills.length) continue;
    if (p.tier === 'Claude-only') {
      log(`skip ${p.name}: Claude-only (${p.note})`);
      continue;
    }
    out.push(p);
  }
  return out;
}

function reportSkipped(plugins, log) {
  for (const p of plugins) {
    const parts = [];
    if (p.hasHooks) parts.push('hooks');
    if (p.hasCommands) parts.push('slash commands');
    if (parts.length) log(`skip ${p.name} ${parts.join(' + ')}: Claude Code only`);
  }
}

/** Plan an export: returns {dir, files: [{rel, data}], notes}. Nothing is written. */
export function planExport(catalog, target, { outDir, plugin, skill, log = () => {} }) {
  if (!EXPORT_TARGETS.includes(target)) throw new UsageError(`unknown export target "${target}" (one of: ${EXPORT_TARGETS.join(', ')})`);
  const plugins = selectPlugins(catalog, { plugin, skill });
  const files = [];
  const notes = [];
  const out = path.resolve(outDir);
  let dir;

  if (target === 'agents' || target === 'claude-ai' || target === 'chatgpt') {
    dir = target === 'agents' ? path.join(out, '.agents') : path.join(out, target);
    reportSkipped(plugins, log, { skills: true });
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
          if (data.length > ZIP_MAX_FILE_BYTES) throw new RefusedError(`${s.name}: ${rel} is larger than 25 MB`);
          const parts = rel.split('/');
          for (let i = 1; i < parts.length; i++) dirs.add(`${s.name}/${parts.slice(0, i).join('/')}/`);
          entries.push({ name: `${s.name}/${rel}`, data });
        }
        for (const d of dirs) entries.push({ name: d });
        const zipBuf = createZip(entries);
        readZip(zipBuf); // self-check: CRCs and structure
        files.push({ rel: `${s.name}.zip`, data: zipBuf });
      }
    }
    if (target !== 'agents') {
      notes.push(
        target === 'claude-ai'
          ? 'Upload each zip at claude.ai: Customize > Skills > + > Create skill > Upload a skill (code execution must be enabled).'
          : 'Upload each zip in ChatGPT: Plugins > Skills > Create > Upload from your computer. Plan eligibility and size limits are UNVERIFIED (help page not readable).',
      );
    } else {
      notes.push('Copy skills/<name>/ into .agents/skills/ (project) or ~/.agents/skills/ (user). Read by Codex, Gemini CLI, VS Code Copilot, Copilot CLI and Cursor.');
    }
  } else if (target === 'gemini-extension') {
    const extName = plugin && !String(plugin).includes(',') ? String(plugin) : 'kktest-dev';
    dir = path.join(out, 'gemini-extension', extName);
    reportSkipped(plugins, log, { skills: true, mcp: true });
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
        const snip = JSON.parse(jsonSnippet('gemini', [srv], pathFor).text).mcpServers;
        Object.assign(mcpServers, snip);
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
    reportSkipped(plugins, log, { mcp: true });
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
    const sep = process.platform === 'win32' ? '\\' : '/';
    const snippets = [];
    const allNotes = [];
    for (const srv of servers) {
      const pathFor = (rel) => [dir, 'servers', pathMap.get(srv.name), ...rel.split('/')].join(sep);
      const r = target === 'codex' ? codexSnippet([srv], pathFor) : jsonSnippet(target, [srv], pathFor);
      snippets.push(r.text);
      allNotes.push(...r.notes);
    }
    let text;
    if (target === 'codex') text = snippets.join('\n');
    else {
      const key = target === 'vscode' ? 'servers' : 'mcpServers';
      const merged = {};
      for (const s of snippets) Object.assign(merged, JSON.parse(s)[key]);
      text = JSON.stringify({ [key]: merged }, null, 2) + '\n';
    }
    if (servers.length) files.push({ rel: CONFIG_FILE[target], data: Buffer.from(text) });
    notes.push(HOW_TO[target], ...allNotes);
    if (target === 'windsurf') notes.push('Env references are UNVERIFIED for Windsurf/Devin; secrets are left as placeholders.');
  }
  files.push({ rel: 'NOTES.txt', data: Buffer.from(notes.join('\n') + '\n') });
  files.push({ rel: MARKER, data: Buffer.from('written by kktest-dev export; safe to delete\n') });
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { dir, files, notes };
}

export function writeExport(plan) {
  const { dir, files } = plan;
  if (fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir);
    if (entries.length && !entries.includes(MARKER)) {
      throw new RefusedError(`${dir} exists and was not written by kktest-dev export; choose another --out`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const f of files) {
    const dest = path.join(dir, ...f.rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
  }
}
