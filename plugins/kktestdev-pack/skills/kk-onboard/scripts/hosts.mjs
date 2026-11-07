// AI hosts (where MCP servers and their env live) and model-provider signals. Read-only.
// Values of env/headers are NEVER returned: only the key name and a state
// (`literal` = a value is written in the file, `ref` = only references such as ${VAR}, ${env:VAR}, ${input:id},
// $VAR, %VAR% or `Bearer ${VAR}`, `empty`).
// Codex CLI keeps MCP servers in TOML (config.toml); a minimal read-only reader for that subset is below.
// Codex does not expand ${VAR}: there `ref` = a name in env_vars / env_http_headers / bearer_token_env_var, and any
// non-empty env value is `literal`.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { CONFIG_MAX_BYTES, canonicalFile, decodeText, isInside, isObject, readJsonText, samePath, valueState } from './common.mjs';

export { canonicalFile, valueState }; // defined in common.mjs (single source with inventory.mjs)

export const HOST_IDS = Object.freeze(['claude-code', 'claude-desktop', 'cursor', 'vscode', 'windsurf', 'codex', 'gemini']);

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
 * Codex CLI (.shiftwork/reports-xp/P0-providers.md section 2, learn.chatgpt.com/docs/extend/mcp?surface=cli): user
 * `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`), project `.codex/config.toml` (trusted projects only),
 * tables `[mcp_servers.<name>]`. Gemini CLI (P0 section 3, geminicli.com/docs/tools/mcp-server/): user
 * `~/.gemini/settings.json`, project `.gemini/settings.json`, key `mcpServers`, `url` (SSE) or `httpUrl`.
 */
export function hostDefinitions({ home, cwd, env = process.env, platform = process.platform, managedFile = null }) {
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const app = appDataDir({ home, env, platform });
  const claudeDir = env.CLAUDE_CONFIG_DIR || p.join(home, '.claude');
  const claudeJson = env.CLAUDE_CONFIG_DIR ? p.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : p.join(home, '.claude.json');
  const vsUser = vscodeUserDirs({ home, app, platform, p });
  return [
    {
      id: 'claude-code', label: 'Claude Code', appDir: claudeDir,
      files: [
        { file: claudeJson, key: 'mcpServers', scope: 'user', projectKey: cwd },
        { file: p.join(cwd, '.mcp.json'), key: 'mcpServers', scope: 'project' },
        // admin-deployed; read when it exists, never a write target
        { file: managedFile ?? managedMcpPath({ env, platform }), key: 'mcpServers', scope: 'managed', optional: true },
      ],
      settings: [
        { file: p.join(claudeDir, 'settings.json'), scope: 'user' },
        { file: p.join(cwd, '.claude', 'settings.json'), scope: 'project' },
        { file: p.join(cwd, '.claude', 'settings.local.json'), scope: 'local' },
      ],
      // code.claude.com/docs/en/plugins/loading: the plugins root is ~/.claude/plugins unless CLAUDE_CODE_PLUGIN_CACHE_DIR
      // is set; installed_plugins.json is the install record, enabledPlugins in settings turns a plugin on per scope
      pluginRoot: env.CLAUDE_CODE_PLUGIN_CACHE_DIR && p.isAbsolute(env.CLAUDE_CODE_PLUGIN_CACHE_DIR) ? env.CLAUDE_CODE_PLUGIN_CACHE_DIR : p.join(claudeDir, 'plugins'),
    },
    {
      id: 'claude-desktop', label: 'Claude Desktop', appDir: p.join(app, 'Claude'),
      files: [{ file: p.join(app, 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', scope: 'user' }],
      // Microsoft Store (MSIX) installs are redirected to %LOCALAPPDATA%\Packages\Claude_<publisher id>\LocalCache\Roaming\Claude.
      // Not in Anthropic's docs (modelcontextprotocol.io/quickstart/user names %APPDATA% only): reasoned from the MSIX
      // AppData redirection rule (learn.microsoft.com, "Understanding how packaged desktop apps run on Windows").
      ...(platform === 'win32' ? { msixPackages: p.join(env.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), 'Packages') } : {}),
    },
    { id: 'cursor', label: 'Cursor', appDir: p.join(home, '.cursor'), files: [{ file: p.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', scope: 'user', jsonc: true }, { file: p.join(cwd, '.cursor', 'mcp.json'), key: 'mcpServers', scope: 'project', jsonc: true }] },
    {
      id: 'vscode', label: 'VS Code (GitHub Copilot)', appDir: vsUser[0].dir,
      files: [
        { file: p.join(vsUser[0].dir, 'mcp.json'), key: 'servers', scope: 'user', jsonc: true },
        { file: p.join(cwd, '.vscode', 'mcp.json'), key: 'servers', scope: 'project', jsonc: true },
        // Insiders, VSCodium, Flatpak/Snap builds: read only when the file exists (never offered as a write target)
        ...vsUser.slice(1).map((u) => ({ file: p.join(u.dir, 'mcp.json'), key: 'servers', scope: 'user', jsonc: true, optional: true, variant: u.variant })),
      ],
      appDirs: vsUser.slice(1).map((u) => u.dir),
      profileRoots: vsUser, // User/profiles/<id>/mcp.json, listed at read time
    },
    { id: 'windsurf', label: 'Windsurf', appDir: p.join(home, '.codeium', 'windsurf'), files: [{ file: p.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', scope: 'user' }] },
    codexDefinition({ home, cwd, env, p }),
    {
      id: 'gemini', label: 'Gemini CLI', appDir: p.join(home, '.gemini'),
      files: [
        { file: p.join(home, '.gemini', 'settings.json'), key: 'mcpServers', scope: 'user', urlKeys: GEMINI_URL_KEYS },
        { file: p.join(cwd, '.gemini', 'settings.json'), key: 'mcpServers', scope: 'project', urlKeys: GEMINI_URL_KEYS },
      ],
      // geminicli.com/docs/extensions/reference: extensions load from ~/.gemini/extensions/<name>/gemini-extension.json,
      // whose mcpServers map has the settings.json shape
      extensionsDir: p.join(home, '.gemini', 'extensions'),
    },
  ];
}

/**
 * Claude Code managed-mcp.json (system-wide, admin-deployed). code.claude.com/docs/en/managed-mcp, "Deploy
 * managed-mcp.json": macOS /Library/Application Support/ClaudeCode, Linux and WSL /etc/claude-code, Windows
 * C:\Program Files\ClaudeCode.
 */
export function managedMcpPath({ env = process.env, platform = process.platform } = {}) {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-mcp.json';
  if (platform === 'win32') return nodePath.win32.join(env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode', 'managed-mcp.json');
  return '/etc/claude-code/managed-mcp.json';
}

/**
 * VS Code user dirs: stable first (the write target), then Insiders and VSCodium in the same app-data dir
 * (code.visualstudio.com/docs/configure/profiles, "Where are profiles kept?": Code / Code - Insiders under
 * %APPDATA%, ~/Library/Application Support, ~/.config). Linux also: Flatpak keeps XDG config under
 * ~/.var/app/<app id>/config (docs.flatpak.org, "Sandbox Permissions": XDG_CONFIG_HOME), and a strictly confined
 * Snap under ~/snap/<name>/current/.config (snapcraft.io docs, "Data locations"; the official `code` snap is
 * classic and uses ~/.config like a .deb install).
 */
function vscodeUserDirs({ home, app, platform, p }) {
  const out = [
    { dir: p.join(app, 'Code', 'User'), variant: 'VS Code' },
    { dir: p.join(app, 'Code - Insiders', 'User'), variant: 'VS Code Insiders' },
    { dir: p.join(app, 'VSCodium', 'User'), variant: 'VSCodium' },
  ];
  if (platform === 'linux') {
    out.push(
      { dir: p.join(home, '.var', 'app', 'com.visualstudio.code', 'config', 'Code', 'User'), variant: 'VS Code (Flatpak)' },
      { dir: p.join(home, '.var', 'app', 'com.vscodium.codium', 'config', 'VSCodium', 'User'), variant: 'VSCodium (Flatpak)' },
      { dir: p.join(home, 'snap', 'code', 'current', '.config', 'Code', 'User'), variant: 'VS Code (Snap)' },
      { dir: p.join(home, 'snap', 'codium', 'current', '.config', 'VSCodium', 'User'), variant: 'VSCodium (Snap)' },
    );
  }
  return out;
}

const GEMINI_URL_KEYS = Object.freeze(['url', 'httpUrl']);

/** Codex home: an absolute $CODEX_HOME, else ~/.codex. A relative CODEX_HOME is not guessed: the user file is skipped. */
function codexDefinition({ home, cwd, env, p }) {
  const project = { file: p.join(cwd, '.codex', 'config.toml'), key: 'mcp_servers', scope: 'project', format: 'codex-toml' };
  if (env.CODEX_HOME && !p.isAbsolute(env.CODEX_HOME)) {
    return { id: 'codex', label: 'Codex CLI', appDir: null, files: [project], notes: ['CODEX_HOME is not an absolute path: the Codex user config.toml was not read'] };
  }
  const dir = env.CODEX_HOME || p.join(home, '.codex');
  const notes = env.CODEX_HOME ? ['CODEX_HOME is set: the Codex user config is read from there'] : [];
  return { id: 'codex', label: 'Codex CLI', appDir: dir, files: [{ file: p.join(dir, 'config.toml'), key: 'mcp_servers', scope: 'user', format: 'codex-toml' }, project], notes };
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

/** read a Codex config.toml with the minimal reader below; same contract as readConfig ({ ok, value, error }, never throws) */
export function readTomlConfig(file, { readFile = readFileSync, stat = statSync, exists = existsSync } = {}) {
  try {
    if (!exists(file)) return { ok: false, missing: true };
    if (stat(file).size > CONFIG_MAX_BYTES) return { ok: false, error: 'over 50 MB, skipped' };
    return parseToml(decodeText(readFile(file)));
  } catch (e) {
    return { ok: false, error: e?.code || 'TOML not understood' };
  }
}

// ---------------------------------------------------------------- minimal TOML reader (read-only)
// Accepts: [table] and [a."b".c] headers, key = value with bare / "basic" / 'literal' keys (dotted too), basic strings
// (TOML 1.0 escapes) and literal strings on one line, arrays (may span lines, comments, trailing comma), inline tables
// (one line), booleans and plain numbers (kept only as "a scalar", value dropped), comments, CRLF. [[array.of.tables]]
// outside mcp_servers is checked and dropped. Refuses (ok: false, 'TOML not understood (line N)'), never guesses:
// multi-line strings, dates/times, unknown escapes, duplicate keys or tables, a table redefined by a value, [[...]]
// under mcp_servers, nesting deeper than 32, anything else. One pass over the text; the only regex runs on a short
// token that is already scanned (no backtracking over whitespace).
export const TOML_SCALAR = Symbol('toml-scalar');
const TOML_MAX_DEPTH = 32;
const BARE_KEY = /[A-Za-z0-9_-]/;
const TOML_NUMBER = /^(?:[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?|[+-]?(?:inf|nan)|0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/;
const TOML_ESC = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

class TomlRefused extends Error {}

export function parseToml(text) {
  const src = String(text ?? '');
  let i = 0;
  let line = 1;
  const fail = () => { throw new TomlRefused(); };
  const headerTables = new WeakSet(); // created by [header] (explicitly or as a parent)
  const explicit = new WeakSet(); // named by a [header] of its own
  const dotted = new WeakSet(); // created by a dotted key (a.b = ...)
  const newTable = () => Object.create(null);
  const root = newTable();
  headerTables.add(root); explicit.add(root);

  const ws = () => { while (src[i] === ' ' || src[i] === '\t') i++; };
  const comment = () => { if (src[i] === '#') while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++; };
  const newline = () => {
    if (src[i] === '\n') { i++; line++; return true; }
    if (src[i] === '\r') { if (src[i + 1] !== '\n') fail(); i += 2; line++; return true; }
    return false;
  };
  const endOfLine = () => { ws(); comment(); if (i < src.length && !newline()) fail(); };

  function basicString() {
    i++; // opening "
    if (src[i] === '"' && src[i + 1] === '"') fail(); // multi-line basic string
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n' || c === '\r') fail();
      if (c === '"') { i++; return out; }
      const code = c.charCodeAt(0);
      if ((code < 0x20 && c !== '\t') || code === 0x7f) fail();
      if (c !== '\\') { out += c; i++; continue; }
      const e = src[i + 1];
      if (e in TOML_ESC) { out += TOML_ESC[e]; i += 2; continue; }
      const len = e === 'u' ? 4 : e === 'U' ? 8 : 0;
      if (!len) fail();
      const hex = src.slice(i + 2, i + 2 + len);
      if (hex.length !== len || !/^[0-9A-Fa-f]+$/.test(hex)) fail();
      const cp = parseInt(hex, 16);
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail();
      out += String.fromCodePoint(cp); i += 2 + len;
    }
  }
  function literalString() {
    i++; // opening '
    if (src[i] === "'" && src[i + 1] === "'") fail(); // multi-line literal string
    const start = i;
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n' || c === '\r') fail();
      if (c === "'") { i++; return src.slice(start, i - 1); }
      const code = c.charCodeAt(0);
      if ((code < 0x20 && c !== '\t') || code === 0x7f) fail();
      i++;
    }
  }
  function simpleKey() {
    if (src[i] === '"') return basicString();
    if (src[i] === "'") return literalString();
    const start = i;
    while (i < src.length && BARE_KEY.test(src[i])) i++;
    if (i === start) fail();
    return src.slice(start, i);
  }
  function keyPath() {
    const parts = [];
    for (;;) {
      ws(); parts.push(simpleKey()); ws();
      if (src[i] !== '.') return parts;
      i++;
    }
  }
  function value(depth) {
    if (depth > TOML_MAX_DEPTH) fail();
    const c = src[i];
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (c === '[') return array(depth + 1);
    if (c === '{') return inlineTable(depth + 1);
    const start = i;
    while (i < src.length && /[A-Za-z0-9_+.\-]/.test(src[i])) i++;
    const tok = src.slice(start, i);
    if (tok === 'true' || tok === 'false' || TOML_NUMBER.test(tok)) return TOML_SCALAR;
    return fail(); // dates, times, bare words, empty
  }
  // whitespace, newlines and comments between array elements
  const arrayGap = () => { for (;;) { ws(); comment(); if (!newline()) return; } };
  function array(depth) {
    i++; // [
    const out = [];
    for (;;) {
      arrayGap();
      if (src[i] === ']') { i++; return out; }
      out.push(value(depth));
      arrayGap();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ']') { i++; return out; }
      fail();
    }
  }
  function inlineTable(depth) {
    i++; // {
    const t = newTable();
    ws();
    if (src[i] === '}') { i++; return t; }
    for (;;) {
      assign(t, keyPath(), depth);
      ws();
      if (src[i] === ',') { i++; continue; }
      if (src[i] === '}') { i++; return t; }
      fail();
    }
  }
  /** key = value into table `t`; a dotted key creates (or reuses) tables made by dotted keys only */
  function assign(t, parts, depth) {
    if (src[i] !== '=') fail();
    i++; ws();
    let cur = t;
    for (const k of parts.slice(0, -1)) {
      if (!(k in cur)) { const n = newTable(); dotted.add(n); cur[k] = n; }
      else if (!dotted.has(cur[k])) fail();
      cur = cur[k];
    }
    const last = parts[parts.length - 1];
    if (last in cur) fail(); // duplicate key
    cur[last] = value(depth);
  }
  function header() {
    const arrayOfTables = src[i + 1] === '[';
    i += arrayOfTables ? 2 : 1;
    const parts = keyPath();
    if (src[i] !== ']' || (arrayOfTables && src[i + 1] !== ']')) fail();
    i += arrayOfTables ? 2 : 1;
    if (arrayOfTables && parts[0] === 'mcp_servers') fail();
    let cur;
    if (arrayOfTables) {
      cur = newTable(); headerTables.add(cur); explicit.add(cur); // checked, then dropped: nothing read here lives there
    } else {
      cur = root;
      for (const k of parts) {
        if (!(k in cur)) { const n = newTable(); headerTables.add(n); cur[k] = n; }
        else if (!headerTables.has(cur[k])) fail(); // a value or an inline table cannot be reopened
        cur = cur[k];
      }
      if (explicit.has(cur)) fail(); // the same [table] twice
      explicit.add(cur);
    }
    endOfLine(); // after the checks, so a refusal names the header's line
    return cur;
  }

  try {
    let table = root;
    while (i < src.length) {
      ws();
      if (newline()) continue;
      if (src[i] === '#') { comment(); continue; }
      if (i >= src.length) break;
      if (src[i] === '[') { table = header(); continue; }
      assign(table, keyPath(), 0);
      endOfLine();
    }
    return { ok: true, value: root };
  } catch (e) {
    if (e instanceof TomlRefused || e instanceof RangeError) return { ok: false, error: `TOML not understood (line ${line})` };
    return { ok: false, error: 'TOML not understood' };
  }
}

/** Codex env values are passed as written (no ${VAR} expansion, P0 section 2): a non-empty value is a literal */
const codexState = (v) => (v === '' ? 'empty' : 'literal');
const codexEnv = (map) => Object.entries(isObject(map) ? map : {}).map(([name, v]) => ({ name, state: codexState(v) }));

/** servers of one Codex config.toml: env (literal/empty), env_vars (ref), http_headers, env_http_headers and bearer_token_env_var (ref) */
function codexServersOf(toml, def, notes, label, short) {
  const out = [];
  for (const [name, c] of Object.entries(isObject(toml?.mcp_servers) ? toml.mcp_servers : {})) {
    if (!isObject(c)) continue;
    const env = codexEnv(c.env);
    for (const [k, v] of Object.entries(isObject(c.env) ? c.env : {})) {
      if (typeof v === 'string' && valueState(v) === 'ref') notes.push(`${label}: ${short(def.file)}: server "${name}" env ${k} looks like a \${VAR} reference, but Codex passes it as literal text (use env_vars)`);
    }
    for (const e of Array.isArray(c.env_vars) ? c.env_vars : []) {
      const n = typeof e === 'string' ? e : isObject(e) && typeof e.name === 'string' ? e.name : null;
      if (n) env.push({ name: n, state: 'ref' });
    }
    const headers = codexEnv(c.http_headers);
    for (const k of Object.keys(isObject(c.env_http_headers) ? c.env_http_headers : {})) headers.push({ name: k, state: 'ref' });
    if (typeof c.bearer_token_env_var === 'string') headers.push({ name: 'Authorization', state: 'ref' });
    out.push({
      name, scope: def.scope,
      command: typeof c.command === 'string' ? c.command : null,
      args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === 'string') : [],
      url: typeof c.url === 'string' ? c.url : null,
      env, headers,
    });
  }
  return out;
}

const envState = (map) => Object.entries(isObject(map) ? map : {}).map(([name, v]) => ({ name, state: valueState(v) }));

/** servers of one host config file: { name, command, args, url, env: [{name,state}], headers: [{name,state}] } */
function serversOf(json, def, platform) {
  const out = [];
  const add = (map, scope) => {
    for (const [name, c] of Object.entries(isObject(map) ? map : {})) {
      if (!isObject(c)) continue;
      if (def.flat && typeof c.command !== 'string' && typeof c.url !== 'string') continue; // flat .mcp.json: only server-shaped entries
      out.push({
        name, scope,
        command: typeof c.command === 'string' ? c.command : null,
        args: Array.isArray(c.args) ? c.args.filter((a) => typeof a === 'string') : [],
        url: (def.urlKeys ?? ['url', 'serverUrl']).map((k) => c[k]).find((u) => typeof u === 'string') ?? null,
        env: envState(c.env), headers: envState(c.headers),
        ...(def.plugin ? { plugin: def.plugin } : {}),
      });
    }
  };
  if (!isObject(json)) return out;
  // a plugin's .mcp.json is { mcpServers: {...} } or the flat server map itself (as inventory.mjs serversOfMcpJson)
  add(def.flat && !isObject(json[def.key]) ? json : json[def.key], def.scope);
  if (def.projectKey && isObject(json.projects)) {
    // same rule as inventory.mjs projectEntry: / vs \, trailing slash, case only where the FS is case-insensitive
    for (const [k, v] of Object.entries(json.projects)) if (samePath(k, def.projectKey, platform)) add(v?.mcpServers, 'local');
  }
  return out;
}

/** WSL: Windows-side configs live under /mnt/c/Users/<user>; detected so they can be read (or a note says why not) */
function isWsl(env, platform, readFile) {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try { return /microsoft/i.test(String(readFile('/proc/version', 'utf8'))); } catch { return false; }
}

// ---------------------------------------------------------------- discovered config files (directory listings)
// Every listing is one readdir of a known directory (never a tree walk), capped, and never follows a symlink or
// junction; a config file found this way is refused when it is itself a link. Values stay inside the readers.
export const DISCOVERY_LIMITS = Object.freeze({ dirEntries: 2000, profiles: 50, msix: 3, plugins: 200, extensions: 100, wslUsers: 100 });
// Windows profile folders that are not a person's (WSL user lookup)
const WIN_NON_USERS = new Set(['public', 'default', 'default user', 'all users', 'defaultuser0', 'wdagutilityaccount', 'desktop.ini']);

function ioOf(fs) {
  return {
    exists: fs.exists ?? existsSync, readFile: fs.readFile ?? readFileSync, stat: fs.stat ?? statSync,
    lstat: fs.lstat ?? lstatSync, readdir: fs.readdir ?? ((d) => readdirSync(d)),
  };
}

/** real sub-directories of `dir` whose name passes `filter`: { dirs, more, linked } (links are counted, not followed) */
function subDirs(io, p, dir, max, filter = () => true) {
  let names;
  try { names = io.readdir(dir).map(String).sort(); } catch { return { dirs: [], more: false, linked: 0 }; }
  const dirs = []; let linked = 0; let more = names.length > DISCOVERY_LIMITS.dirEntries;
  for (const n of names.slice(0, DISCOVERY_LIMITS.dirEntries)) {
    if (!filter(n)) continue;
    let st; try { st = io.lstat(p.join(dir, n)); } catch { continue; }
    if (st.isSymbolicLink()) { linked++; continue; }
    if (!st.isDirectory()) continue;
    if (dirs.length >= max) { more = true; break; }
    dirs.push(n);
  }
  return { dirs, more, linked };
}

/** read one config: a file found by a listing (`found`) must not be a link; same { ok, value, error, missing } contract */
function readDef(def, io) {
  if (def.found) {
    try { if (io.lstat(def.file).isSymbolicLink()) return { ok: false, error: 'a link; not followed' }; } catch { return { ok: false, missing: true }; }
  }
  return def.format === 'codex-toml' ? readTomlConfig(def.file, io) : readConfig(def.file, io, { jsonc: def.jsonc });
}

/** VS Code profiles: <User>/profiles/<id>/mcp.json (per-profile resources sit beside the profile's settings.json) */
function profileDefs(h, io, p, notes) {
  const out = [];
  for (const u of h.profileRoots ?? []) {
    const root = p.join(u.dir, 'profiles');
    const { dirs, more } = subDirs(io, p, root, DISCOVERY_LIMITS.profiles);
    if (more) notes.push(`${h.label}: more than ${DISCOVERY_LIMITS.profiles} ${u.variant} profiles; the rest were not read`);
    for (const d of dirs) out.push({ file: p.join(root, d, 'mcp.json'), key: 'servers', scope: 'user', jsonc: true, optional: true, found: true, variant: `${u.variant} profile` });
  }
  return out;
}

/** Claude Desktop from the Microsoft Store: %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude */
function msixDefs(h, io, p) {
  if (!h.msixPackages) return [];
  const { dirs } = subDirs(io, p, h.msixPackages, DISCOVERY_LIMITS.msix, (n) => /^Claude_/i.test(n));
  return dirs.map((d) => ({ file: p.join(h.msixPackages, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), key: 'mcpServers', scope: 'user', optional: true, found: true, variant: 'Microsoft Store' }));
}

/** Gemini CLI extensions: ~/.gemini/extensions/<name>/gemini-extension.json, mcpServers */
function extensionDefs(h, io, p, notes) {
  if (!h.extensionsDir) return [];
  const { dirs, more, linked } = subDirs(io, p, h.extensionsDir, DISCOVERY_LIMITS.extensions);
  if (more) notes.push(`${h.label}: more than ${DISCOVERY_LIMITS.extensions} extensions; the rest were not read`);
  if (linked) notes.push(`${h.label}: ${linked} linked extension folder(s) were not followed`);
  return dirs.map((d) => ({ file: p.join(h.extensionsDir, d, 'gemini-extension.json'), key: 'mcpServers', scope: 'plugin', plugin: d, optional: true, found: true, urlKeys: GEMINI_URL_KEYS }));
}

/**
 * Claude Code plugin servers: plugins enabled in settings (enabledPlugins, user < project < local) and recorded in
 * <plugins root>/installed_plugins.json ({ plugins: { "<name>@<marketplace>": [{ scope, installPath, projectPath? }] } }).
 * Each plugin's .mcp.json and .claude-plugin/plugin.json mcpServers (inline map or a path inside the plugin).
 */
function pluginDefs(h, enabled, io, p, { cwd, platform, notes, short }) {
  if (!h.pluginRoot) return [];
  const recFile = p.join(h.pluginRoot, 'installed_plugins.json');
  const rec = readConfig(recFile, io);
  if (rec.missing) return [];
  if (!rec.ok) { notes.push(`${h.label}: ${short(recFile)}: ${rec.error}`); return []; }
  const plugins = isObject(rec.value?.plugins) ? rec.value.plugins : {};
  const ids = Object.keys(plugins).filter((id) => enabled.get(id) === true);
  if (ids.length > DISCOVERY_LIMITS.plugins) notes.push(`${h.label}: more than ${DISCOVERY_LIMITS.plugins} enabled plugins; the rest were not read`);
  const out = [];
  for (const id of ids.slice(0, DISCOVERY_LIMITS.plugins)) {
    const rows = (Array.isArray(plugins[id]) ? plugins[id] : [plugins[id]]).filter(isObject);
    // a project/local install counts only for the project it was installed in
    const row = rows.find((r) => typeof r.installPath === 'string' && p.isAbsolute(r.installPath)
      && (typeof r.projectPath !== 'string' || samePath(r.projectPath, cwd, platform)));
    if (!row) continue;
    out.push({ file: p.join(row.installPath, '.mcp.json'), key: 'mcpServers', flat: true, scope: 'plugin', plugin: id, optional: true, found: true });
    out.push({ file: p.join(row.installPath, '.claude-plugin', 'plugin.json'), key: 'mcpServers', scope: 'plugin', plugin: id, optional: true, found: true, manifestRoot: row.installPath });
  }
  return out;
}

/** plugin.json mcpServers may be a path (or a list of paths) to a JSON file inside the plugin: read those too */
function manifestRefs(def, json, p, platform) {
  const v = json?.[def.key];
  const refs = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string');
  return refs.map((r) => ({ ...def, manifestRoot: undefined, flat: true, file: p.resolve(def.manifestRoot, r.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}[\\/]?/, '')) }))
    .filter((d) => isInside(d.file, def.manifestRoot, platform)); // never a file outside the plugin
}

/**
 * WSL: the Windows user's folder under <mount>/Users. USERPROFILE (when WSLENV passes it) names it; otherwise the
 * one real folder whose name is $USER / $LOGNAME, or the only person folder there. Junctions ("All Users",
 * "Default User") are not followed. Returns { dir } or { reason }.
 */
function wslWindowsHome(io, env, mount) {
  const p = nodePath.posix;
  const users = p.join(mount, 'Users');
  const fromProfile = String(env.USERPROFILE ?? '').match(/^[A-Za-z]:[\\/]Users[\\/]([^\\/]+)[\\/]?$/);
  const { dirs, more } = subDirs(io, p, users, DISCOVERY_LIMITS.wslUsers, (n) => !WIN_NON_USERS.has(n.toLowerCase()));
  if (!dirs.length) return { reason: `${users} has no user folder that could be read` };
  const want = (fromProfile?.[1] ?? env.USER ?? env.LOGNAME ?? '').toLowerCase();
  const hit = dirs.find((d) => d.toLowerCase() === want);
  if (hit) return { dir: p.join(users, hit) };
  if (dirs.length === 1 && !more) return { dir: p.join(users, dirs[0]) };
  return { reason: `${dirs.length}${more ? '+' : ''} Windows user folders and none matches this user` };
}

/** Windows-side files of each host, seen from WSL (read-only; Windows paths inside them are not resolved) */
function wslDefs(winHome) {
  const p = nodePath.posix;
  const roaming = p.join(winHome, 'AppData', 'Roaming');
  const w = (file, key, extra = {}) => ({ file, key, scope: 'user', optional: true, side: 'windows', variant: 'Windows side (WSL)', ...extra });
  return {
    'claude-code': [w(p.join(winHome, '.claude.json'), 'mcpServers')],
    'claude-desktop': [w(p.join(roaming, 'Claude', 'claude_desktop_config.json'), 'mcpServers')],
    cursor: [w(p.join(winHome, '.cursor', 'mcp.json'), 'mcpServers', { jsonc: true })],
    vscode: ['Code', 'Code - Insiders', 'VSCodium'].map((v) => w(p.join(roaming, v, 'User', 'mcp.json'), 'servers', { jsonc: true })),
    windsurf: [w(p.join(winHome, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers')],
  };
}

/**
 * every host: present?, config files (also the expected ones that do not exist yet: `exists: false`, so a write
 * target is known; `optional` files such as managed-mcp.json, other VS Code builds, profiles and the Windows side
 * of WSL are listed only when they exist), servers (env key names + states), Claude Code settings env.
 * `short` shortens paths in notes. `managedFile` and `wslMount` replace system paths (tests).
 */
export function readHosts({ home, cwd, env = process.env, platform = process.platform, fs = {}, short = (p) => p, managedFile = null, wslMount = '/mnt/c' } = {}) {
  const io = ioOf(fs);
  const p = platform === 'win32' ? nodePath.win32 : nodePath.posix;
  const notes = [];
  // a project file that IS the user file (cwd = home) is read once, under its user scope
  const seen = new Set();
  const firstTime = (file) => { const k = canonicalFile(file, platform); if (seen.has(k)) return false; seen.add(k); return true; };
  let windows = {};
  if (isWsl(env, platform, io.readFile)) {
    const wh = wslWindowsHome(io, env, wslMount);
    if (wh.dir) { windows = wslDefs(wh.dir); notes.push(`WSL detected: Windows-side configs were also read (read-only) from ${wh.dir}; Windows paths inside them are not resolved`); }
    else notes.push(`WSL detected: only the Linux-side configs were read; Windows-side configs (Claude Desktop, VS Code, Cursor under ${wslMount}/Users/...) are not included: ${wh.reason}`);
  }
  const hosts = hostDefinitions({ home, cwd, env, platform, managedFile }).map((h) => {
    const files = [];
    const servers = [];
    for (const n of h.notes ?? []) notes.push(`${h.label}: ${n}`);
    // settings first: enabledPlugins decides which plugin servers are read
    const settingsEnv = [];
    const enabled = new Map();
    for (const s of h.settings ?? []) {
      if (!firstTime(s.file)) continue;
      const r = readConfig(s.file, io);
      if (r.missing) continue;
      if (r.ok) {
        settingsEnv.push(...envState(r.value?.env).map((e) => ({ ...e, scope: s.scope, file: s.file })));
        for (const [id, on] of Object.entries(isObject(r.value?.enabledPlugins) ? r.value.enabledPlugins : {})) enabled.set(id, on === true);
      } else notes.push(`${h.label}: ${short(s.file)}: ${r.error}`);
    }
    const queue = [...h.files, ...msixDefs(h, io, p), ...profileDefs(h, io, p, notes), ...(windows[h.id] ?? []),
      ...extensionDefs(h, io, p, notes), ...pluginDefs(h, enabled, io, p, { cwd, platform, notes, short })];
    for (let i = 0; i < queue.length; i++) {
      const def = queue[i];
      if (!firstTime(def.file)) continue;
      const toml = def.format === 'codex-toml';
      const r = readDef(def, io);
      const meta = { ...(def.variant ? { variant: def.variant } : {}), ...(def.plugin ? { plugin: def.plugin } : {}), ...(def.side ? { side: def.side } : {}) };
      if (r.missing) { if (!def.optional) files.push({ file: def.file, scope: def.scope, exists: false }); continue; }
      files.push({ file: def.file, scope: def.scope, exists: true, ok: r.ok, ...meta, ...(r.error ? { error: r.error } : {}) });
      if (r.ok) {
        servers.push(...(toml ? codexServersOf(r.value, def, notes, h.label, short) : serversOf(r.value, def, platform)).map((s) => ({ ...s, file: def.file })));
        if (def.manifestRoot) queue.push(...manifestRefs(def, r.value, p, platform));
      } else notes.push(`${h.label}: ${short(def.file)}: ${r.error}`);
    }
    const present = files.some((f) => f.exists && f.scope !== 'managed') || [h.appDir, ...(h.appDirs ?? [])].some((d) => !!d && io.exists(d));
    return { id: h.id, label: h.label, present, files, servers, settingsEnv };
  });
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
