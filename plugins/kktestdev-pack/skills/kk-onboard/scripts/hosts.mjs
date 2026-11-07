// AI hosts (where MCP servers and their env live) and model-provider signals. Read-only.
// Values of env/headers are NEVER returned: only the key name and a state
// (`literal` = a value is written in the file, `ref` = only references such as ${VAR}, ${env:VAR}, ${input:id},
// $VAR, %VAR% or `Bearer ${VAR}`, `empty`).
import { existsSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { CONFIG_MAX_BYTES, canonicalFile, isObject, readJsonText, samePath, valueState } from './common.mjs';

export { canonicalFile, valueState }; // defined in common.mjs (single source with inventory.mjs)

export const HOST_IDS = Object.freeze(['claude-code', 'claude-desktop', 'cursor', 'vscode', 'windsurf']);

/** platform-specific application-data directory (macOS Library/Application Support, Windows APPDATA, XDG) */
export function appDataDir({ home, env = process.env, platform = process.platform }) {
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || p.join(home, 'AppData', 'Roaming');
  // the XDG spec says a relative XDG_CONFIG_HOME is invalid and must be ignored
  return env.XDG_CONFIG_HOME && p.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : p.join(home, '.config');
}

/**
 * where each host keeps MCP config; `key` is the property that holds the server map, `jsonc` marks editors whose
 * files may carry comments and trailing commas (VS Code, Cursor). Claude Code's user file follows
 * CLAUDE_CONFIG_DIR like inventory.mjs does.
 */
export function hostDefinitions({ home, cwd, env = process.env, platform = process.platform }) {
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const app = appDataDir({ home, env, platform });
  const claudeDir = env.CLAUDE_CONFIG_DIR || p.join(home, '.claude');
  const claudeJson = env.CLAUDE_CONFIG_DIR ? p.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : p.join(home, '.claude.json');
  return [
    {
      id: 'claude-code', label: 'Claude Code', appDir: claudeDir,
      files: [
        { file: claudeJson, key: 'mcpServers', scope: 'user', projectKey: cwd },
        { file: p.join(cwd, '.mcp.json'), key: 'mcpServers', scope: 'project' },
      ],
      settings: [
        { file: p.join(claudeDir, 'settings.json'), scope: 'user' },
        { file: p.join(cwd, '.claude', 'settings.json'), scope: 'project' },
        { file: p.join(cwd, '.claude', 'settings.local.json'), scope: 'local' },
      ],
    },
    { id: 'claude-desktop', label: 'Claude Desktop', appDir: p.join(app, 'Claude'), files: [{ file: p.join(app, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', scope: 'user' }] },
    { id: 'cursor', label: 'Cursor', appDir: p.join(home, '.cursor'), files: [{ file: p.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', scope: 'user', jsonc: true }, { file: p.join(cwd, '.cursor', 'mcp.json'), key: 'mcpServers', scope: 'project', jsonc: true }] },
    { id: 'vscode', label: 'VS Code (GitHub Copilot)', appDir: p.join(app, 'Code', 'User'), files: [{ file: p.join(app, 'Code', 'User', 'mcp.json'), key: 'servers', scope: 'user', jsonc: true }, { file: p.join(cwd, '.vscode', 'mcp.json'), key: 'servers', scope: 'project', jsonc: true }] },
    { id: 'windsurf', label: 'Windsurf', appDir: p.join(home, '.codeium', 'windsurf'), files: [{ file: p.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', scope: 'user' }] },
  ];
}

/** read a JSON config (JSONC when `jsonc`): BOM / UTF-16 aware, size-capped; returns { ok, value, error } and never throws */
export function readConfig(file, { readFile = readFileSync, stat = statSync, exists = existsSync } = {}, { jsonc = false } = {}) {
  try {
    if (!exists(file)) return { ok: false, missing: true };
    if (stat(file).size > CONFIG_MAX_BYTES) return { ok: false, error: 'over 50 MB, skipped' };
    return { ok: true, value: readJsonText(readFile(file), { jsonc }) };
  } catch (e) {
    return { ok: false, error: e?.code || 'not valid JSON' };
  }
}

const envState = (map) => Object.entries(isObject(map) ? map : {}).map(([name, v]) => ({ name, state: valueState(v) }));

/** servers of one host config file: { name, command, args, url, env: [{name,state}], headers: [{name,state}] } */
function serversOf(json, def, platform) {
  const out = [];
  const add = (map, scope) => {
    for (const [name, c] of Object.entries(isObject(map) ? map : {})) {
      if (!isObject(c)) continue;
      out.push({
        name, scope,
        command: typeof c.command === 'string' ? c.command : null,
        args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === 'string') : [],
        url: typeof c.url === 'string' ? c.url : typeof c.serverUrl === 'string' ? c.serverUrl : null,
        env: envState(c.env), headers: envState(c.headers),
      });
    }
  };
  if (!isObject(json)) return out;
  add(json[def.key], def.scope);
  if (def.projectKey && isObject(json.projects)) {
    // same rule as inventory.mjs projectEntry: / vs \, trailing slash, case only where the FS is case-insensitive
    for (const [k, v] of Object.entries(json.projects)) if (samePath(k, def.projectKey, platform)) add(v?.mcpServers, 'local');
  }
  return out;
}

/** WSL: Windows-side configs (/mnt/c/Users/...) are not read; say so instead of silently reporting "absent" */
function isWsl(env, platform, readFile) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try { return /microsoft/i.test(String(readFile('/proc/version', 'utf8'))); } catch { return false; }
}

/**
 * every host: present?, config files (also the expected ones that do not exist yet: `exists: false`, so a write
 * target is known), servers (env key names + states), Claude Code settings env. `short` shortens paths in notes.
 */
export function readHosts({ home, cwd, env = process.env, platform = process.platform, fs = {}, short = (p) => p } = {}) {
  const exists = fs.exists ?? existsSync;
  const notes = [];
  // a project file that IS the user file (cwd = home) is read once, under its user scope
  const seen = new Set();
  const firstTime = (file) => { const k = canonicalFile(file, platform); if (seen.has(k)) return false; seen.add(k); return true; };
  const hosts = hostDefinitions({ home, cwd, env, platform }).map((h) => {
    const files = [];
    const servers = [];
    for (const def of h.files) {
      if (!firstTime(def.file)) continue;
      const r = readConfig(def.file, fs, { jsonc: def.jsonc });
      if (r.missing) { files.push({ file: def.file, scope: def.scope, exists: false }); continue; }
      files.push({ file: def.file, scope: def.scope, exists: true, ok: r.ok, ...(r.error ? { error: r.error } : {}) });
      if (r.ok) servers.push(...serversOf(r.value, def, platform).map((s) => ({ ...s, file: def.file })));
      else notes.push(`${h.label}: ${short(def.file)}: ${r.error}`);
    }
    const settingsEnv = [];
    for (const s of h.settings ?? []) {
      if (!firstTime(s.file)) continue;
      const r = readConfig(s.file, fs);
      if (r.missing) continue;
      if (r.ok) settingsEnv.push(...envState(r.value?.env).map((e) => ({ ...e, scope: s.scope, file: s.file })));
      else notes.push(`${h.label}: ${short(s.file)}: ${r.error}`);
    }
    const present = files.some((f) => f.exists) || exists(h.appDir);
    return { id: h.id, label: h.label, present, files, servers, settingsEnv };
  });
  if (isWsl(env, platform, fs.readFile ?? readFileSync)) notes.push('WSL detected: only the Linux-side configs were read; Windows-side configs (Claude Desktop, VS Code, Cursor under /mnt/c/Users/...) are not included');
  return { hosts, notes };
}

// ---------------------------------------------------------------- model providers
// Signals only (env var NAMES and local binaries); this says nothing about whether a key is valid.
export const PROVIDER_SIGNALS = Object.freeze([
  { id: 'anthropic', label: 'Anthropic API', env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL'] },
  { id: 'bedrock', label: 'Amazon Bedrock', env: ['CLAUDE_CODE_USE_BEDROCK', 'AWS_BEARER_TOKEN_BEDROCK'] },
  { id: 'vertex', label: 'Google Vertex AI', env: ['CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_VERTEX_PROJECT_ID', 'CLOUD_ML_REGION'] },
  { id: 'openai', label: 'OpenAI / OpenAI-compatible', env: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE'] },
  { id: 'azure-openai', label: 'Azure OpenAI', env: ['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT'] },
  { id: 'gemini', label: 'Google Gemini', env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
  { id: 'openrouter', label: 'OpenRouter', env: ['OPENROUTER_API_KEY'] },
  { id: 'ollama', label: 'Ollama (local)', env: ['OLLAMA_HOST', 'OLLAMA_MODELS'], bins: ['ollama'] },
  { id: 'lmstudio', label: 'LM Studio (local)', env: [], bins: ['lms'] },
]);

/** which providers show a signal: env names in the process or in Claude Code settings env, or a local binary */
export function detectProviders({ env = process.env, hosts = [], findBin = () => ({ found: false }) } = {}) {
  const settingsEnv = hosts.find((h) => h.id === 'claude-code')?.settingsEnv ?? [];
  return PROVIDER_SIGNALS.map((p) => {
    const signals = [];
    for (const name of p.env) {
      if (env[name] !== undefined && env[name] !== '') signals.push(`env ${name} (shell)`);
      for (const s of settingsEnv.filter((e) => e.name === name)) signals.push(`env ${name} (${s.scope} settings, ${s.state})`);
    }
    for (const b of p.bins ?? []) if (findBin(b).found) signals.push(`binary ${b} on PATH`);
    return { id: p.id, label: p.label, signals };
  });
}
