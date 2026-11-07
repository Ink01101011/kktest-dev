#!/usr/bin/env node
// kk-onboard inventory + audit. Read-only: it never installs, removes, or writes anything.
// Prints one JSON document on stdout, always (also on internal errors): the pack's status against
// what is installed/connected, audit findings (type redundancy | risk | info), and notes on
// anything that could not be checked.
//
// Secrets: env/header VALUES are never printed (key names only). URLs, MCP args, hook commands,
// health-check targets and CLI error text are passed through redact*() before output: URL userinfo
// and query values, values after --token/--api-key/--password style flags, KEY=value pairs with a
// secret-like key, Bearer/Basic credentials and well-known token prefixes become "***".
//
// usage: node inventory.mjs [--fast] [--full] [--pretty]
//   --fast    skip `claude mcp list` (the slow health check; claude.ai connectors are then not seen)
//   --full    also print the installed lists (plugins, marketplaces, mcp, skills, hooks)
//   --pretty  indent the JSON
//
// Single file, Node stdlib only. The pure helpers are exported for inventory.test.mjs.
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectProviders, readHosts } from './hosts.mjs';

export const LIMITS = {
  skillDepth: 3,          // nesting below a skills root
  dirBudget: 5000,        // directories visited per skills root
  scriptDepth: 3,         // nesting inside one skill dir when looking for scripts
  scriptHits: 10,         // stop counting scripts after this many
  evidence: 20,           // evidence lines per finding
  list: 200,              // entries per installed list in --full
  str: 300,               // characters per string in the output
  claudeJsonBytes: 50 * 1024 * 1024,
  redactChars: 20000,     // longer text is cut before redaction (keeps every regex pass bounded)
  cliTimeoutMs: 60000,
  mcpListTimeoutMs: 45000,
};

// ---------------------------------------------------------------- named patterns
// Key segments that make an env/header/flag/query name secret-like. Matched on whole segments of the
// snake_cased name, so AUTHOR_NAME does not match "auth" but OAUTH_TOKEN matches "token".
const SECRET_SEGMENTS = 'token|secret|password|passwd|pwd|pw|pass|api_?key|apikey|access_?key|private_?key|client_?secret|auth|authorization|bearer|cookie|credentials?|pat|signature|sig';
const SECRET_KEY = new RegExp(`(^|_)(${SECRET_SEGMENTS})(_|$)`);
// ${VAR}, ${VAR:-default}, $VAR, %VAR%: a reference to a variable, not a literal secret.
// Query parameter names that carry a credential even though the word alone is generic (?key=, ?sig=).
const QUERY_SECRET = /^(key|sig|code|access_token|apikey)$/i;
const ENV_REF = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%/g;
// Well-known credential prefixes (OpenAI/Anthropic sk-, Stripe, GitHub, GitLab, Slack, AWS, Google, JWT).
const TOKEN_PREFIX = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;
// URL_IN_TEXT and KEY_VALUE match a WHOLE run of key/scheme characters (the lookbehind allows one start per
// run, so a long run is scanned once: linear, G7-4), then the callback drops leading digits, dots and dashes
// to find the key or scheme the old unanchored forms found (G8-M3: `1api_key=`, `-https://`) with no length
// cap (G9-M-B/M-C: keys over 64 and schemes over 32 chars).
const URL_IN_TEXT = /(?<![a-z0-9+.-])([a-z0-9+.-]+)(:\/\/[^\s'"<>`]+)/gi;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)(\s+)([^\s'"]+)/gi;
const KEY_VALUE = /(?<![\w.-])([\w.-]+)(=|:[ \t]*)("[^"]*"|'[^']*'|[^\s'"&]+)/g;
const FLAG = /^--?[A-Za-z][\w.-]*$/;
// `-u user:password` / `--user user:password`: the part after the first colon is a password.
const USER_FLAG = /^(-u|--user|--proxy-user)$/;
// Commands whose -u takes user:password and whose short flags combine/glue (`-vu bob:pw`, `-ubob:pw`).
const CRED_U_CMDS = new Set(['curl', 'wget', 'lftp', 'aria2c', 'ftp', 'sftp', 'mongo', 'mongosh', 'mongodump', 'mongorestore', 'mongoexport', 'mongoimport', 'redis-cli', 'influx', 'rabbitmqadmin']);
// MySQL-family clients take the password glued to -p (`mysql -pSECRET`); a separate `-p X` is a prompt + db name.
const MYSQL_CMDS = new Set(['mysql', 'mariadb', 'mysqldump', 'mysqladmin', 'mysqlimport', 'mysqlshow']);

const uidPair = (user, pw) => /^\d+$/.test(user) && /^\d+$/.test(pw);

/** split a command line on ; & | && || and newlines that are OUTSIDE quotes; linear. Returns [seg, sep, seg, ...] */
export function splitShell(t) {
  const out = []; let cur = ''; let q = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { cur += c; if (c === q) q = ''; else if (c === '\\' && q === '"' && i + 1 < t.length) cur += t[++i]; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < t.length) { cur += c + t[++i]; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n') {
      let sep = c; while (i + 1 < t.length && (t[i + 1] === '&' || t[i + 1] === '|') && sep.length < 2) sep += t[++i];
      out.push(cur, sep); cur = ''; continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** what a segment's commands imply for -u and -p: a credential client present, a MySQL client present */
// Word-boundary tests over the whole text: fail-safe (any mention counts, as the pre-gate code did), linear.
const CRED_U_WORD = new RegExp(`\\b(${[...CRED_U_CMDS].map((c) => c.replace(/-/g, '\\-')).join('|')})(\\.exe)?\\b`, 'i');
const MYSQL_WORD = new RegExp(`\\b(${[...MYSQL_CMDS].join('|')})(\\.exe)?\\b`, 'i');
function credContext(words) {
  const text = words.map((w) => String(w ?? '')).join(' ');
  const credU = CRED_U_WORD.test(text);
  const mysql = MYSQL_WORD.test(text);
  return { credU: credU || mysql, mysql };
}
// Directories under HOME that belong to a package manager or version manager (not "a local checkout").
const TOOLCHAIN_DIRS = /\/(node_modules|\.nvm|nvm|\.volta|\.asdf|\.fnm|\.bun\/bin|\.cargo\/bin|\.npm-global|\.npm\/_npx|\.local\/bin|\.local\/share\/(mise|pnpm|uv)|mise|homebrew|linuxbrew|\.claude\/plugins|appdata\/roaming\/npm|appdata\/local\/(mise|pnpm|volta)|scoop\/(shims|apps)|go\/bin|library\/pnpm)(\/|$)/;
const BROAD_PERMISSION = /^Bash(\(\*\))?$|^Bash\(\*|bypassPermissions|^mcp__[^_]+$|^\*$/;
// Commands that fetch a package from a registry and run it.
const DIRECT_RUNNERS = new Set(['npx', 'bunx', 'uvx', 'pipx']);
const SUB_RUNNERS = { npm: ['exec', 'x'], pnpm: ['dlx', 'exec'], yarn: ['dlx'], bun: ['x'], pipx: ['run'] };
const VALUE_FLAGS = new Set(['--package', '-p', '--from', '--registry', '--cache', '--python', '--with', '--index-url', '--spec']);
// Packages that only proxy a remote MCP URL: group them by the URL, not by the package name.
const REMOTE_PROXIES = new Set(['mcp-remote', 'supergateway', '@modelcontextprotocol/inspector']);
const EVERY_TOOL_MATCHERS = new Set(['', '*', '.*']);
const SKIP_DIRS = new Set(['node_modules', '.git']);
const SCRIPT_EXT = /\.(sh|bash|zsh|py|mjs|cjs|js|ts|cmd|bat|ps1|rb|pl)$/i;
const KNOWN_DETECT_KEYS = new Set(['plugins', 'mcpName', 'mcpNameExact', 'mcpUrl', 'mcpCommand', 'mcpArgs', 'skills']);
const RAW = Symbol('raw'); // raw config on server objects; Symbol keys never reach JSON.stringify

// ---------------------------------------------------------------- small pure helpers
const lower = (s) => String(s ?? '').toLowerCase();
export const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const asArray = (x) => (Array.isArray(x) ? x : []);
const asObject = (x) => (isObject(x) ? x : {});
const strArray = (x) => asArray(x).filter((a) => typeof a === 'string' || typeof a === 'number').map(String);
export const cap = (s, n = LIMITS.str) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
export function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); if (k == null || k === '') continue; if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
  return m;
}
export function capList(list, n = LIMITS.evidence) {
  return list.length > n ? [...list.slice(0, n), `… ${list.length - n} more`] : list;
}

// ---------------------------------------------------------------- secrets: detection + redaction
const snake = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const secretKey = (k) => SECRET_KEY.test(snake(String(k).replace(/^-+/, '')));
/** true when the value is empty or only variable references (+ an auth scheme word): not a literal secret */
export function isEnvRef(v) {
  const rest = String(v ?? '').replace(ENV_REF, '').replace(/\b(bearer|basic|token)\b/gi, '').trim();
  return rest === '';
}

/** redact one URL; returns { text, hits } where hits name what looked like a credential */
export function redactUrl(u) {
  const hits = [];
  let url;
  try { url = new URL(u); } catch { url = null; }
  if (!url || !url.host) {
    const text = String(u).replace(/\/\/[^/@\s]+@/, () => { hits.push('url userinfo'); return '//***@'; })
      .replace(/([?&][^=&#\s]+=)[^&#\s]*/g, '$1***');
    return { text, hits };
  }
  if (url.password || (url.username && new RegExp(TOKEN_PREFIX.source).test(decodeURIComponent(url.username)))) hits.push('url userinfo');
  let text = `${url.protocol}//${url.username || url.password ? '***@' : ''}${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  const keys = [];
  for (const [k, v] of url.searchParams) {
    keys.push(`${k}=${v === '' ? '' : '***'}`);
    if (v && (secretKey(k) || QUERY_SECRET.test(k)) && !isEnvRef(v)) hits.push(`url query "${k}"`);
  }
  if (keys.length) text += '?' + keys.join('&');
  text = text.replace(TOKEN_PREFIX, () => { hits.push('token in url'); return '***'; });
  return { text, hits };
}

/** mask the password half of user:password; returns null when it is not one (or must not be masked) */
function maskUserPass(value, ctx) {
  const q = /^["']/.test(value) ? value[0] : '';
  const inner = q ? value.slice(1, value.endsWith(q) ? -1 : undefined) : value;
  const i = inner.indexOf(':');
  if (i <= 0 || i === inner.length - 1) return null;
  const user = inner.slice(0, i); const pw = inner.slice(i + 1);
  // Fail-safe (G9-M-A): every -u x:y is masked except a numeric uid:gid. `docker run -u bob:staff` is
  // over-masked to bob:*** (display only) rather than letting `docker run img tool -u bob:pw` leak.
  if (pw === '***' || isEnvRef(pw) || uidPair(user, pw)) return null;
  return `${q}${user}:***${q}`;
}

/** -u/--user/--proxy-user user:password and mysql -pX inside ONE shell segment */
function redactSegment(seg, hits) {
  const ctx = credContext([seg]);
  const VALUE = `("[^"]*"|'[^']*'|[^\\s'"]+)`;
  // exact flags, spaced or with =: masked unless the segment's only commands give -u another meaning
  seg = seg.replace(new RegExp(`(^|\\s)(-u|--user|--proxy-user)(\\s+|=)${VALUE}`, 'g'), (m, pre, flag, sp, val) => {
    const masked = maskUserPass(val, ctx); if (!masked) return m;
    hits.push(`"${flag}" password`); return `${pre}${flag}${sp}${masked}`;
  });
  // combined (-vu bob:pw) and glued (-ubob:pw, -vubob:pw): only when a credential client is in the segment
  if (ctx.credU) {
    seg = seg.replace(new RegExp(`(^|\\s)(-[A-Za-z]*u)(\\s+|)${VALUE}`, 'g'), (m, pre, flag, sp, val) => {
      if (flag === '-u' && sp) return m; // already handled above
      const masked = maskUserPass(val, ctx); if (!masked) return m;
      hits.push(`"${flag}" password`); return `${pre}${flag}${sp}${masked}`;
    });
  }
  if (ctx.mysql) {
    seg = seg.replace(/(^|\s)-p(?!\s)("[^"]*"|'[^']*'|[^\s'"]+)/g, (m, pre, val) => {
      if (val === '***' || isEnvRef(val.replace(/^["']|["']$/g, ''))) return m;
      hits.push('"-p" password'); return `${pre}-p***`;
    });
  }
  return seg;
}

/**
 * KEY=value / key: value with a secret-like key. A match whose key is NOT secret must not swallow its value:
 * in `Example: TOKEN=abc` the value of `Example:` is `TOKEN=abc`, which is itself a pair to check. So the scan
 * resumes at the value's start after a non-secret key (each step still advances, so it stays linear).
 */
function replaceKeyValues(t, hits) {
  const re = new RegExp(KEY_VALUE.source, 'g');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(t)) !== null) {
    const [whole, run, sep, val] = m;
    const key = run.replace(/^[^A-Za-z_]+/, '');
    if (key && secretKey(key) && val !== '***' && !isEnvRef(val.replace(/^["']|["']$/g, ''))) {
      hits.push(`"${run}"`);
      out += t.slice(last, m.index) + `${run}${sep}***`;
      last = m.index + whole.length;
    } else {
      re.lastIndex = m.index + run.length + sep.length; // rescan the value
    }
  }
  return out + t.slice(last);
}

/** redact free text (hook commands, args, CLI output); returns { text, hits } */
export function redactText(s) {
  const hits = [];
  let t = String(s ?? '');
  // cut at the last whitespace before the limit so no secret straddles the cut as a fragment (G9 minor)
  if (t.length > LIMITS.redactChars) t = `${t.slice(0, LIMITS.redactChars).replace(/\S*$/, '')}…[truncated]`;
  t = t.replace(URL_IN_TEXT, (m, run, rest) => {
    const lead = run.match(/^[^a-z]*/i)[0];
    if (lead === run) return m;
    const r = redactUrl(run.slice(lead.length) + rest); hits.push(...r.hits); return lead + r.text;
  });
  t = t.replace(AUTH_SCHEME, (m, scheme, sp, val) => {
    if (val === '***' || isEnvRef(val)) return m;
    hits.push(`${scheme} credential`); return `${scheme}${sp}***`;
  });
  // "key": "value" (JSON / YAML-ish quoted pairs); the key length is capped so each match is bounded
  t = t.replace(/"([^"\\\n]{1,200})"(\s*:\s*)"((?:[^"\\\n]|\\.)*)"/g, (m, key, sep, val) => {
    if (!secretKey(key) || val === '***' || val === '' || isEnvRef(val)) return m;
    hits.push(`"${key}"`); return `"${key}"${sep}"***"`;
  });
  t = replaceKeyValues(t, hits);
  // --token VALUE (space separated) inside a command line
  t = t.replace(/(^|\s)(--?[A-Za-z][\w.-]*)(\s+)("[^"]*"|'[^']*'|[^\s'"-][^\s'"]*)/g, (m, pre, flag, sp, val) => {
    if (!secretKey(flag) || val === '***' || isEnvRef(val.replace(/^["']|["']$/g, ''))) return m;
    hits.push(`"${flag}"`); return `${pre}${flag}${sp}***`;
  });
  // -u user:password and mysql -pSECRET, judged per shell segment (split outside quotes) by its commands
  t = splitShell(t).map((seg, i) => (i % 2 ? seg : redactSegment(seg, hits))).join('');
  t = t.replace(TOKEN_PREFIX, () => { hits.push('token-like value'); return '***'; });
  return { text: t, hits };
}

/** redact an argv array: also masks the value that follows a secret-like flag */
export function redactArgs(args, command = '') {
  const hits = [];
  const out = [];
  const list = strArray(args);
  // commands anywhere in the command + argv count (npx x mysql, cmd /c mysql, docker exec db mysql, ssh h curl)
  const ctx = credContext([command, ...list]);
  const { mysql, credU } = ctx;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const prev = list[i - 1];
    const userPass = (flag, val, rebuild) => {
      const masked = maskUserPass(val, ctx); if (!masked) return false;
      hits.push(`"${flag}" password`); out.push(rebuild(masked)); return true;
    };
    if (prev !== undefined && (USER_FLAG.test(prev) || (credU && /^-[A-Za-z]*u$/.test(prev))) && userPass(prev, a, (m) => m)) continue;
    const eq = a.match(/^(-u|--user|--proxy-user)=(.+)$/);
    if (eq && userPass(eq[1], eq[2], (m) => `${eq[1]}=${m}`)) continue;
    const glued = credU && a.match(/^(-[A-Za-z]*u)([^\s-].*)$/);
    if (glued && userPass(glued[1], glued[2], (m) => `${glued[1]}${m}`)) continue;
    if (mysql && /^-p.+/.test(a)) {
      if (isEnvRef(a.slice(2))) out.push(a); else { hits.push('"-p" password'); out.push('-p***'); }
      continue;
    }
    if (prev !== undefined && FLAG.test(prev) && secretKey(prev) && !a.startsWith('-')) {
      if (isEnvRef(a)) out.push(a); else { hits.push(`"${prev}"`); out.push('***'); }
      continue;
    }
    const r = redactText(a);
    hits.push(...r.hits);
    out.push(r.text);
  }
  return { args: out, hits };
}

/** secret-like keys of an env/headers map whose value is a literal (or a URL carrying credentials) */
export function inlineSecretKeys(map) {
  const keys = [];
  for (const [k, v] of Object.entries(asObject(map))) {
    if (v == null || v === '' || typeof v === 'object') continue;
    const val = String(v);
    if (isEnvRef(val)) continue;
    if (secretKey(k) || /^(bearer|basic)\s/i.test(val) || redactText(val).hits.length) keys.push(k);
  }
  return keys;
}

// ---------------------------------------------------------------- paths (OS-aware, testable with platform/home)
const caseInsensitive = (platform) => platform === 'win32' || platform === 'darwin';
function normPath(p, home, platform) {
  let s = String(p ?? '').trim();
  if (!s) return '';
  s = s.replace(/^~(?=$|[\\/])/, home).replace(/^\$\{?HOME\}?(?=$|[\\/])/, home).replace(/^%USERPROFILE%(?=$|[\\/])/i, home);
  if (platform === 'win32') s = s.replace(/^\/([a-zA-Z])\//, '$1:/'); // Git Bash /c/Users/...
  s = s.replace(/\\/g, '/').replace(/\/+$/, '');
  return caseInsensitive(platform) ? s.toLowerCase() : s;
}
/** p is HOME or below it (boundary-checked: /Users/kk does not contain /Users/kktest) */
export function isUnderHome(p, home, platform = process.platform) {
  const h = normPath(home, home, platform);
  const s = normPath(p, home, platform);
  return !!h && (s === h || s.startsWith(h + '/'));
}
export function shortPath(p, home, platform = process.platform) {
  if (!p) return p;
  if (!isUnderHome(p, home, platform)) return String(p);
  const s = String(p).replace(/^~(?=$|[\\/])/, home).replace(/\\/g, '/');
  const h = String(home).replace(/\\/g, '/').replace(/\/+$/, '');
  return '~' + s.slice(h.length);
}
/** a path to code in a local checkout under HOME (not a package/version-manager directory) */
export function isLocalPath(str, home, platform = process.platform) {
  if (!str || /^[a-z][a-z0-9+.-]*:\/\//i.test(String(str))) return false;
  if (!isUnderHome(str, home, platform)) return false;
  return !TOOLCHAIN_DIRS.test(normPath(str, home, platform).toLowerCase());
}
export function samePath(a, b, platform = process.platform) {
  const n = (p) => { const s = String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, ''); return caseInsensitive(platform) ? s.toLowerCase() : s; };
  return n(a) === n(b);
}
/** split a shell command into words, keeping "quoted parts" together */
export function tokenizeCommand(cmd) {
  const out = [];
  for (const m of String(cmd ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
const binBase = (cmd) => lower(String(cmd ?? '').split(/[\\/]/).pop()).replace(/\.(exe|cmd|bat|ps1)$/, '');

// ---------------------------------------------------------------- MCP command parsing
/** strip a Windows `cmd /c` wrapper: returns the real { command, args } */
export function unwrapCommand(command, args) {
  let c = command; let a = strArray(args);
  for (let i = 0; i < 3 && binBase(c) === 'cmd' && /^\/c$/i.test(a[0] ?? ''); i++) { c = a[1] ?? null; a = a.slice(2); }
  return { command: c, args: a };
}
/** which package a registry runner (npx, uvx, pnpm dlx, ...) runs: { runner, spec } or null */
export function packageSpecOf(command, args) {
  const u = unwrapCommand(command, args);
  const base = binBase(u.command);
  let rest = u.args;
  if (SUB_RUNNERS[base]) {
    const i = rest.findIndex((a) => !a.startsWith('-'));
    if (i < 0 || !SUB_RUNNERS[base].includes(rest[i])) return null;
    rest = rest.slice(i + 1);
  } else if (!DIRECT_RUNNERS.has(base)) return null;
  let spec = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const eq = a.match(/^(--package|--from|--spec)=(.+)$/);
    if (eq) { spec ??= eq[2]; continue; }
    if (VALUE_FLAGS.has(a)) { if (['--package', '-p', '--from', '--spec'].includes(a)) spec ??= rest[i + 1] ?? null; i++; continue; }
    if (a.startsWith('-')) continue;
    spec ??= a;
    break;
  }
  if (!spec || !/^(@[\w.-]+\/)?[\w.-]+([@=<>~^!].*)?$/.test(spec)) return null;
  return { runner: base, spec };
}
/** split "pkg@1.2.3" / "@scope/pkg@latest" / "pkg==1.2" into { name, version } */
export function splitSpec(spec) {
  const s = String(spec);
  const py = s.match(/^([^=<>~!]+)(==|>=|<=|~=|!=)(.+)$/);
  if (py) return { name: py[1], version: py[3] };
  const i = s.indexOf('@', s.startsWith('@') ? 1 : 0);
  return i > 0 ? { name: s.slice(0, i), version: s.slice(i + 1) } : { name: s, version: null };
}
export const isUnpinned = (version) => version == null || version === '' || /^(latest|next|\*)$/i.test(version);

/** endpoint of a server for grouping: its url, or the URL an mcp-remote style proxy forwards to */
export function endpointOf(server) {
  const raw = server[RAW] ?? server;
  if (raw.url) return raw.url;
  const pkg = packageSpecOf(raw.command, raw.args);
  if (pkg && REMOTE_PROXIES.has(splitSpec(pkg.spec).name)) return strArray(raw.args).find((a) => /^https?:\/\//i.test(a)) ?? null;
  return null;
}
/** grouping key for an endpoint: host + path without a trailing /mcp, /v1/mcp or /sse, + query */
export function normalizeEndpoint(u) {
  let url;
  try { url = new URL(u); } catch { return lower(u).replace(/^https?:\/\//, '').replace(/\/+$/, ''); }
  const path = lower(url.pathname).replace(/\/+$/, '').replace(/\/(v\d+\/)?(mcp|sse)$/, '');
  const q = [...url.searchParams].map(([k, v]) => `${k}=${v}`).sort().join('&');
  return lower(url.host) + path + (q ? '?' + q : '');
}
const endpointLabel = (u) => { const { text } = redactUrl(u); return text.replace(/^[a-z]+:\/\//i, ''); };

// ---------------------------------------------------------------- matching (pack.json detect rules)
const baseServerName = (name) => lower(String(name ?? '').replace(/^claude\.ai /i, '').replace(/^plugin:[^:]+:/, '')).replace(/\s+/g, '-');
const tokens = (s) => lower(s).split(/[^a-z0-9]+/).filter(Boolean);
/** whole-token match at the start or end of a name ("memory" matches "memory" and "server-memory", not "in-memory-cache") */
export function nameMatches(name, x) {
  const n = tokens(name); const t = tokens(x);
  if (!t.length || t.length > n.length) return false;
  const eq = (off) => t.every((w, i) => n[off + i] === w);
  return eq(0) || eq(n.length - t.length);
}
function argMatches(arg, x) {
  const a = lower(arg); const v = lower(x);
  return a === v || a.startsWith(v + '@') || a.endsWith('/' + v) || a.endsWith('\\' + v) || a.includes('/' + v + '/') || a.includes('\\' + v + '\\')
    || a.includes('/' + v + '@') || splitSpec(a).name === v;
}
export function matches(detect, { plugin, server, skill } = {}) {
  const d = asObject(detect);
  if (plugin) return asArray(d.plugins).some((x) => lower(plugin.id).startsWith(lower(x)));
  if (server) {
    const raw = server[RAW] ?? server;
    const { command, args } = unwrapCommand(raw.command, raw.args);
    const base = baseServerName(server.name);
    const url = lower(endpointOf(server));
    return asArray(d.mcpNameExact).some((x) => base === lower(x))
      || asArray(d.mcpName).some((x) => nameMatches(base, x))
      || (url !== '' && asArray(d.mcpUrl).some((x) => url.includes(lower(x))))
      || asArray(d.mcpCommand).some((x) => binBase(command) === lower(x) || argMatches(command ?? '', x))
      || asArray(d.mcpArgs).some((x) => args.some((a) => argMatches(a, x)));
  }
  if (skill) return asArray(d.skills).some((x) => lower(skill.name) === lower(x));
  return false;
}

// ---------------------------------------------------------------- parsing CLI output and files
/** parse JSON from CLI stdout that may carry banner/warning lines before or after the JSON */
export function parseJsonOutput(text) {
  const s = String(text ?? '').replace(/^﻿/, '').trim();
  if (!s) return { ok: false, error: 'empty output' };
  try { return { ok: true, value: JSON.parse(s) }; } catch {}
  const lines = s.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*[[{]/.test(lines[i])) continue;
    for (let j = lines.length; j > i; j--) {
      try { return { ok: true, value: JSON.parse(lines.slice(i, j).join('\n')), skipped: true }; } catch {}
    }
  }
  return { ok: false, error: 'no JSON in output' };
}
/** one line of `claude mcp list`: "name: target - ✓ Connected" */
export function parseMcpListLine(line) {
  const m = String(line).replace(/\r$/, '').match(/^(.+?): (.*?) - (\S)\s*(.+)$/u);
  if (!m) return null;
  return { name: m[1], target: m[2].replace(/\s*\((HTTP|SSE|stdio)\)$/i, ''), status: m[4].trim() };
}
export const isConnected = (status) => /^connected$|✓|\bconnected\b/i.test(status) && !/not connected|disconnected|failed/i.test(status);

function readJsonFile(file, ctx, { maxBytes = LIMITS.claudeJsonBytes } = {}) {
  let st;
  try { st = statSync(file); } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') ctx.note(`cannot read ${ctx.short(file)}: ${e.code ?? e.message}`); return null; }
  if (!st.isFile()) { ctx.note(`${ctx.short(file)} is not a file; skipped`); return null; }
  if (st.size > maxBytes) { ctx.note(`${ctx.short(file)} is ${Math.round(st.size / 1048576)} MB; skipped (limit ${Math.round(maxBytes / 1048576)} MB)`); return null; }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { ctx.note(`cannot read ${ctx.short(file)}: ${e.code ?? e.message}`); return null; }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch (e) { ctx.note(`${ctx.short(file)} is not valid JSON (${cap(e.message, 80)}); treated as empty`); return null; }
}

// ---------------------------------------------------------------- I/O defaults (replaceable in tests)
/** run a command with fixed args (never user text through a shell); resolves { ok, stdout } or { ok:false, code, error } */
export function runCommand(cmd, args, timeoutMs, { shell = false, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let done = false;
    let child;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try {
      child = spawn(cmd, args, { shell, cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { resolve({ ok: false, code: e.code, error: e.message }); return; }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, code: 'ETIMEDOUT', error: `timed out after ${timeoutMs / 1000} s` }); }, timeoutMs);
    child.stdout.on('data', (d) => { if (stdout.length < 20e6) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1e5) stderr += d; });
    child.on('error', (e) => finish({ ok: false, code: e.code, error: e.message }));
    child.on('close', (code) => finish(code === 0 ? { ok: true, stdout } : { ok: false, code, error: stderr.trim() || `exit ${code}`, stdout }));
  });
}
// claude is a .cmd shim on Windows, so it needs the shell there; args are always fixed literals.
export const runClaudeDefault = (args, timeoutMs) => runCommand('claude', args, timeoutMs, { shell: process.platform === 'win32' });
/** find an executable on PATH in-process (no `which`/`where`; never the current directory) */
export function findBinDefault(bin, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter((d) => d && d !== '.');
  const exts = platform === 'win32' ? ['', ...String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  let windowsOnly = false;
  for (const dir of dirs) {
    for (const ext of exts) {
      const f = nodePath.join(dir, bin + ext);
      try {
        const st = statSync(f);
        if (!st.isFile()) continue;
        if (platform !== 'win32' && !(st.mode & 0o111)) continue;
        if (platform === 'linux' && /^\/mnt\/[a-z]\//.test(dir)) { windowsOnly = true; continue; } // WSL: Windows install
        return { found: true };
      } catch {}
    }
  }
  return { found: false, windowsOnly };
}

// ---------------------------------------------------------------- collect (all I/O)
function makeCtx(opts) {
  const notes = [];
  const home = opts.home;
  const platform = opts.platform ?? process.platform;
  return {
    home, cwd: opts.cwd, platform, notes,
    note: (n) => { const t = redactText(n).text; if (!notes.includes(t)) notes.push(cap(t, 400)); },
    short: (p) => shortPath(p, home, platform),
    /** replace HOME inside free text (hook commands) with ~ */
    shortText: (t) => String(t ?? '').split(home + nodePath.sep).join('~' + nodePath.sep).split(String(home).replace(/\\/g, '/') + '/').join('~/'),
  };
}
const canonical = (p) => { try { return realpathSync.native(p); } catch { return nodePath.resolve(p); } };

function makeServer(name, cfg, source) {
  const c = asObject(cfg);
  const url = typeof c.url === 'string' ? c.url : null;
  const command = typeof c.command === 'string' ? c.command : null;
  const args = strArray(c.args);
  const env = asObject(c.env); const headers = asObject(c.headers);
  return {
    name: String(name), source,
    type: typeof c.type === 'string' ? c.type : url ? 'http' : 'stdio',
    url: url ? redactUrl(url).text : null,
    command: command ? redactText(command).text : null,
    args: redactArgs(args, command).args,
    envKeys: Object.keys(env), headerKeys: Object.keys(headers),
    [RAW]: { url, command, args, env, headers },
  };
}
/** add servers from a map; skips entries that are not server configs (note names the file) */
function addServers(ctx, out, map, source) {
  if (map == null) return;
  if (!isObject(map)) { ctx.note(`${source}: mcpServers is not an object; skipped`); return; }
  const bad = [];
  for (const [name, cfg] of Object.entries(map)) {
    if (!isObject(cfg) || (typeof cfg.command !== 'string' && typeof cfg.url !== 'string')) { bad.push(name); continue; }
    out.push(makeServer(name, cfg, source));
  }
  if (bad.length) ctx.note(`${source}: ${bad.length} entr${bad.length > 1 ? 'ies are' : 'y is'} not an MCP server config (${cap(bad.slice(0, 5).join(', '), 120)}); skipped`);
}
/** .mcp.json has either { mcpServers: {...} } or the flat server map itself */
function serversOfMcpJson(json) {
  if (!isObject(json)) return null;
  return isObject(json.mcpServers) ? json.mcpServers : json;
}
/** plugin.json mcpServers: an inline map, a path to a JSON file, or an array of those */
function pluginManifestServers(ctx, installPath, value, source) {
  const out = [];
  const one = (v) => {
    if (typeof v === 'string') {
      const f = nodePath.resolve(installPath, v.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}[\\/]?/, ''));
      try { statSync(f); } catch { ctx.note(`${source}: plugin.json mcpServers points at ${cap(v, 80)}, which does not exist`); return; }
      out.push(serversOfMcpJson(readJsonFile(f, ctx)));
    } else if (isObject(v)) out.push(v);
    else if (v != null) ctx.note(`${source}: plugin.json mcpServers has an unsupported shape; skipped`);
  };
  if (Array.isArray(value)) value.forEach(one); else one(value);
  return out.filter(Boolean);
}

function listDir(ctx, dir) {
  try { return readdirSync(dir, { withFileTypes: true }); } catch (e) {
    if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') ctx.note(`cannot read ${ctx.short(dir)}: ${e.code ?? e.message}; skipped`);
    return [];
  }
}
function isDirEntry(ctx, full, entry, rootReal) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  let st;
  try { st = statSync(full); } catch { return false; } // dangling link
  if (!st.isDirectory()) return false;              // symlink to a file
  const rp = canonical(full);
  if (rp === nodePath.parse(rp).root || samePath(rp, canonical(ctx.home), ctx.platform) || samePath(rp, rootReal, ctx.platform)) {
    ctx.note(`${ctx.short(full)} links to ${rp === nodePath.parse(rp).root ? 'the filesystem root' : 'a parent directory'}; not followed`);
    return false;
  }
  return true;
}
/** count script files in a skill dir: bounded depth, skips node_modules/.git, does not follow links */
function scanScripts(ctx, dir) {
  const hits = [];
  const walk = (d, depth) => {
    for (const e of listDir(ctx, d)) {
      if (hits.length >= LIMITS.scriptHits) return;
      if (SKIP_DIRS.has(e.name)) continue;
      const full = nodePath.join(d, e.name);
      if (e.isDirectory() && depth < LIMITS.scriptDepth) walk(full, depth + 1);
      else if (e.isFile() && SCRIPT_EXT.test(e.name)) hits.push(nodePath.relative(dir, full));
    }
  };
  walk(dir, 0);
  return hits;
}
function walkSkills(ctx, data, root, source, { syncedSegment = false } = {}) {
  let rootReal;
  try { if (!statSync(root).isDirectory()) return; rootReal = canonical(root); } catch { return; }
  let budget = LIMITS.dirBudget;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    for (const e of listDir(ctx, dir)) {
      if (SKIP_DIRS.has(e.name)) continue;
      const full = nodePath.join(dir, e.name);
      if (!isDirEntry(ctx, full, e, rootReal)) continue;
      if (--budget < 0) { ctx.note(`${ctx.short(root)}: more than ${LIMITS.dirBudget} directories; skill scan stopped early`); return; }
      let hasSkill = false;
      try { hasSkill = statSync(nodePath.join(full, 'SKILL.md')).isFile(); } catch {}
      if (hasSkill) {
        const rp = canonical(full);
        if (data.seenSkillDirs.has(rp)) continue;
        data.seenSkillDirs.add(rp);
        const rel = nodePath.relative(root, full).split(/[\\/]/);
        const src = syncedSegment && rel[0] === 'synced' ? 'claude.ai synced' : source;
        data.skills.push({ name: e.name, source: src, path: ctx.short(full), scripts: scanScripts(ctx, full) });
      } else if (depth < LIMITS.skillDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }
}
/** hooks: { Event: [ { matcher, hooks: [ { type, command } ] } ] } */
function collectHooks(ctx, data, hooksObj, source) {
  if (hooksObj == null) return;
  if (!isObject(hooksObj)) { ctx.note(`${source}: "hooks" is not an object; skipped`); return; }
  for (const [event, groups] of Object.entries(hooksObj)) {
    if (!Array.isArray(groups)) { ctx.note(`${source}: hooks.${cap(event, 40)} is not a list; skipped`); continue; }
    for (const g of groups) {
      if (!isObject(g)) continue;
      for (const h of asArray(g.hooks)) {
        if (!isObject(h)) continue;
        const raw = typeof h.command === 'string' ? h.command : typeof h.type === 'string' ? `(${h.type} hook)` : '(hook)';
        data.hooks.push({ source, event, matcher: typeof g.matcher === 'string' ? g.matcher : null, command: redactText(raw).text, [RAW]: raw });
      }
    }
  }
}
function addSettings(ctx, data, file, source) {
  const rp = canonical(file);
  if (data.seenSettings.has(rp)) return;
  data.seenSettings.add(rp);
  const s = readJsonFile(file, ctx);
  if (!isObject(s)) return;
  collectHooks(ctx, data, s.hooks, source);
  const perms = asObject(s.permissions);
  for (const a of asArray(perms.allow)) if (typeof a === 'string') data.permissions.push({ source, rule: a });
  if (typeof perms.defaultMode === 'string') data.permissions.push({ source, rule: `defaultMode=${perms.defaultMode}` });
}
/** the ~/.claude.json projects entry for cwd: keys may use / or \ and differ in case on Windows */
export function projectEntry(projects, cwd, platform = process.platform) {
  const p = asObject(projects);
  if (isObject(p[cwd])) return p[cwd];
  const key = Object.keys(p).find((k) => samePath(k, cwd, platform));
  return key ? asObject(p[key]) : null;
}

export async function collect(opts) {
  const ctx = makeCtx(opts);
  const { home, cwd, platform } = ctx;
  const env = opts.env ?? process.env;
  const runClaude = opts.runClaude ?? runClaudeDefault;
  const data = {
    ctx, plugins: [], marketplaces: [], mcp: [], health: [], skills: [], hooks: [], permissions: [],
    seenSkillDirs: new Set(), seenSettings: new Set(), claudeAvailable: true, pluginListOk: true, healthChecked: !opts.fast,
  };
  const cliNote = (label, r) => {
    if (r.code === 'ENOENT') { data.claudeAvailable = false; ctx.note('claude was not found on PATH: plugins and marketplaces could not be listed, so plugin items read "unknown". If claude is a shell alias, run this from a shell where `claude` is an executable on PATH.'); return; }
    ctx.note(`${label} failed: ${cap(r.error, 200)}`);
  };
  // the three CLI calls run in parallel; mcp list (health check) is the slow one
  const [pl, ml, hl] = await Promise.all([
    runClaude(['plugin', 'list', '--json'], LIMITS.cliTimeoutMs),
    runClaude(['plugin', 'marketplace', 'list', '--json'], LIMITS.cliTimeoutMs),
    opts.fast ? Promise.resolve(null) : runClaude(['mcp', 'list'], LIMITS.mcpListTimeoutMs),
  ]);

  // plugins (one row per scope; the same installPath may appear twice)
  if (pl.ok) {
    const parsed = parseJsonOutput(pl.stdout);
    if (!parsed.ok || !Array.isArray(parsed.value)) { data.pluginListOk = false; ctx.note(`claude plugin list --json: ${parsed.ok ? 'not a list' : parsed.error}; plugins unknown`); }
    else {
      if (parsed.skipped) ctx.note('claude plugin list --json printed extra text around the JSON; ignored');
      for (const p of parsed.value) {
        if (!isObject(p) || typeof p.id !== 'string') continue;
        data.plugins.push({ id: p.id, enabled: !!p.enabled, scope: typeof p.scope === 'string' ? p.scope : null, version: p.version ?? null, installPath: typeof p.installPath === 'string' ? p.installPath : null });
      }
    }
  } else { data.pluginListOk = false; cliNote('claude plugin list --json', pl); }
  if (ml.ok) {
    const parsed = parseJsonOutput(ml.stdout);
    if (!parsed.ok || !Array.isArray(parsed.value)) ctx.note(`claude plugin marketplace list --json: ${parsed.ok ? 'not a list' : parsed.error}; marketplaces unknown`);
    else for (const m of parsed.value) {
      if (!isObject(m) || typeof m.name !== 'string') continue;
      data.marketplaces.push({ name: m.name, source: typeof m.source === 'string' ? redactText(m.source).text : null, repo: typeof m.repo === 'string' ? redactText(m.repo).text : null, url: typeof m.url === 'string' ? redactUrl(m.url).text : null, path: typeof m.path === 'string' ? ctx.short(m.path) : null });
    }
  } else if (data.claudeAvailable) cliNote('claude plugin marketplace list --json', ml);

  // active plugin install dirs, deduped (a plugin enabled in two scopes is scanned once)
  const byPath = groupBy(data.plugins.filter((p) => p.enabled && p.installPath), (p) => canonical(p.installPath));
  data.activePlugins = [...byPath.values()].map((list) => ({ ...list[0], scopes: list.map((p) => p.scope) }));

  // MCP servers (config view)
  const configDir = env.CLAUDE_CONFIG_DIR ? nodePath.resolve(env.CLAUDE_CONFIG_DIR) : nodePath.join(home, '.claude');
  if (env.CLAUDE_CONFIG_DIR) ctx.note(`CLAUDE_CONFIG_DIR is set: reading config from ${ctx.short(configDir)}`);
  const claudeJsonPath = env.CLAUDE_CONFIG_DIR ? nodePath.join(configDir, '.claude.json') : nodePath.join(home, '.claude.json');
  const claudeJson = asObject(readJsonFile(claudeJsonPath, ctx));
  addServers(ctx, data.mcp, claudeJson.mcpServers, 'user (~/.claude.json)');
  const proj = projectEntry(claudeJson.projects, cwd, platform);
  addServers(ctx, data.mcp, proj?.mcpServers, 'local (~/.claude.json, this project)');
  data.disabledHere = strArray(proj?.disabledMcpServers);
  addServers(ctx, data.mcp, serversOfMcpJson(readJsonFile(nodePath.join(cwd, '.mcp.json'), ctx)), 'project (.mcp.json)');
  for (const p of data.activePlugins) {
    const src = `plugin ${p.id}`;
    addServers(ctx, data.mcp, serversOfMcpJson(readJsonFile(nodePath.join(p.installPath, '.mcp.json'), ctx)), src);
    const manifest = asObject(readJsonFile(nodePath.join(p.installPath, '.claude-plugin', 'plugin.json'), ctx));
    for (const map of pluginManifestServers(ctx, p.installPath, manifest.mcpServers, src)) addServers(ctx, data.mcp, map, src);
  }

  // MCP health (+ claude.ai connectors, which only the CLI sees)
  if (hl) {
    if (hl.ok || hl.stdout) {
      const lines = String(hl.stdout ?? '').split(/\r?\n/).filter((l) => l.trim());
      for (const l of lines) { const h = parseMcpListLine(l); if (h) data.health.push({ ...h, target: redactText(h.target).text }); }
      if (lines.length && !data.health.length) ctx.note('claude mcp list printed output in an unknown format; health not parsed');
    }
    if (!hl.ok) {
      if (hl.code === 'ETIMEDOUT') ctx.note(`claude mcp list did not finish within ${LIMITS.mcpListTimeoutMs / 1000} s: health is partial or missing (rerun, or use --fast)`);
      else if (data.claudeAvailable) cliNote('claude mcp list', hl);
      data.healthChecked = data.health.length > 0;
    }
    for (const h of data.health.filter((x) => x.name.startsWith('claude.ai '))) {
      const isUrl = /^https?:\/\//i.test(h.target);
      data.mcp.push(makeServer(h.name, isUrl ? { url: h.target } : { command: h.target }, 'claude.ai connector'));
    }
  } else ctx.note('--fast: MCP health and claude.ai connectors were not checked');
  // join config entries with health and project disable state
  const healthByName = new Map(data.health.map((h) => [h.name, h.status]));
  for (const s of data.mcp) {
    const pluginName = s.source.startsWith('plugin ') ? s.source.slice(7).split('@')[0] : null;
    const hname = pluginName ? `plugin:${pluginName}:${s.name}` : s.name;
    if (healthByName.has(hname)) s.health = healthByName.get(hname);
    if (data.disabledHere.includes(hname) || data.disabledHere.includes(s.name)) s.disabledHere = true;
  }

  // skills
  walkSkills(ctx, data, nodePath.join(configDir, 'skills'), 'user (~/.claude/skills)', { syncedSegment: true });
  if (!samePath(canonical(cwd), canonical(home), platform)) walkSkills(ctx, data, nodePath.join(cwd, '.claude', 'skills'), 'project (.claude/skills)');
  const syncedPlugins = nodePath.join(configDir, 'plugins', 'synced');
  for (const p of data.activePlugins) {
    const synced = isUnderHome(p.installPath, syncedPlugins, platform);
    walkSkills(ctx, data, nodePath.join(p.installPath, 'skills'), synced ? 'claude.ai synced' : `plugin ${p.id}`);
  }

  // hooks + permissions
  addSettings(ctx, data, nodePath.join(configDir, 'settings.json'), 'user settings');
  addSettings(ctx, data, nodePath.join(cwd, '.claude', 'settings.json'), 'project settings');
  addSettings(ctx, data, nodePath.join(cwd, '.claude', 'settings.local.json'), 'local settings');
  for (const p of data.activePlugins) collectHooks(ctx, data, asObject(readJsonFile(nodePath.join(p.installPath, 'hooks', 'hooks.json'), ctx)).hooks, `plugin ${p.id}`);
  return data;
}

// ---------------------------------------------------------------- pack.json validation
export function validatePack(pack) {
  const problems = [];
  if (!isObject(pack) || !Array.isArray(pack.items)) return ['pack.json has no items list'];
  for (const it of pack.items) {
    if (!isObject(it) || typeof it.id !== 'string') { problems.push('pack.json: an item has no id'); continue; }
    for (const k of Object.keys(asObject(it.detect))) if (!KNOWN_DETECT_KEYS.has(k)) problems.push(`pack.json item ${it.id}: unknown detect key "${k}" (never matches)`);
    if (it.options !== undefined) {
      const o = asObject(it.options);
      for (const k of Object.keys(o)) if (!['package', 'bin', 'envPrefix'].includes(k)) problems.push(`pack.json item ${it.id}: unknown options key "${k}" (options holds identity hints only)`);
    }
    const need = { plugin: 'plugin', mcp: 'steps', docs: 'doc' }[it.kind];
    if (!need) problems.push(`pack.json item ${it.id}: unknown kind "${it.kind}"`);
    else if (it[need] == null) problems.push(`pack.json item ${it.id}: kind ${it.kind} needs "${need}"`);
  }
  for (const g of asArray(pack.overlapGroups)) for (const k of Object.keys(asObject(g?.match))) if (!KNOWN_DETECT_KEYS.has(k)) problems.push(`pack.json overlap group ${g.id}: unknown match key "${k}"`);
  return problems;
}

// ---------------------------------------------------------------- pack status
const pluginNameOf = (id) => String(id).split('@')[0];
/** health of the servers a plugin contributes: null (none seen) | true (one connected) | status text */
function pluginServerHealth(data, plugin) {
  const prefix = `plugin:${pluginNameOf(plugin.id)}:`;
  const list = data.health.filter((h) => h.name.startsWith(prefix));
  if (!list.length) return null;
  return list.some((h) => isConnected(h.status)) ? true : list[0].status;
}
export function packStatus(data, pack, findBin = findBinDefault) {
  return asArray(pack.items).map((it) => {
    const viaPlugins = [...groupBy(data.plugins.filter((p) => matches(it.detect, { plugin: p })), (p) => p.id).values()]
      .map((list) => ({ id: list[0].id, enabled: list.some((p) => p.enabled), scopes: list.map((p) => p.scope) }));
    const viaMcp = data.mcp.filter((s) => matches(it.detect, { server: s }));
    const locations = [
      ...viaPlugins.map((p) => {
        const h = p.enabled ? pluginServerHealth(data, p) : null;
        const state = !p.enabled ? 'disabled' : h === null || h === true ? 'ok' : 'attention';
        return { state, label: `plugin ${p.id}${p.enabled ? '' : ' (installed, DISABLED)'}${state === 'attention' ? ` (MCP: ${h})` : ''}` };
      }),
      ...viaMcp.map((s) => {
        const state = s.disabledHere ? 'disabled' : s.health && !isConnected(s.health) ? 'attention' : 'ok';
        return { state, label: `mcp "${s.name}" from ${s.source}${s.disabledHere ? ' (disabled in this project)' : ''}${state === 'attention' ? ` (${s.health})` : ''}` };
      }),
    ];
    let status;
    if (!locations.length) {
      const pluginOnly = asArray(it.detect?.plugins).length && !Object.keys(asObject(it.detect)).some((k) => k !== 'plugins');
      status = !data.pluginListOk && (pluginOnly || it.kind === 'plugin') ? 'unknown' : 'missing';
    } else if (locations.some((l) => l.state === 'ok')) status = 'present';
    else if (locations.every((l) => l.state === 'disabled')) status = 'disabled';
    else status = 'needs-attention';
    const missingBins = [];
    for (const r of asArray(it.requires)) {
      if (!isObject(r) || typeof r.bin !== 'string') continue;
      const f = findBin(r.bin);
      if (!f.found) missingBins.push({ bin: r.bin, install: r.install, ...(f.windowsOnly ? { note: 'found only on the Windows side of WSL; install it inside Linux' } : {}) });
    }
    const out = { id: it.id, profile: it.profile, kind: it.kind, status, foundAs: capList(locations.map((l) => l.label)), missingBins };
    if (status !== 'present') out.what = it.what;
    return out;
  });
}

// ---------------------------------------------------------------- audit (findings)
function isPackServer(pack, s) { return asArray(pack.items).some((it) => matches(it.detect, { server: s })); }
function isPackPlugin(pack, p) { return asArray(pack.items).some((it) => matches(it.detect, { plugin: p })); }
function isPackSkill(pack, data, sk) {
  const m = sk.source.match(/^plugin (.+)$/);
  return !!m && isPackPlugin(pack, { id: m[1] });
}
const serverLabel = (s) => `${s.name} — ${s.source}`;

const DETECTORS = {
  sameEndpoint(data) {
    const groups = groupBy(data.mcp, (s) => { const e = endpointOf(s); return e ? normalizeEndpoint(e) : null; });
    const out = [];
    for (const list of groups.values()) {
      const uniq = [...new Map(list.map((s) => [serverLabel(s), s])).values()];
      if (uniq.length > 1) out.push(['redundancy', 'same-endpoint', `${uniq.length} MCP entries point at ${endpointLabel(endpointOf(uniq[0]))}`, uniq.map(serverLabel)]);
    }
    return out;
  },
  samePackage(data) {
    const groups = groupBy(data.mcp, (s) => {
      const pkg = packageSpecOf(s[RAW].command, s[RAW].args);
      if (!pkg) return null;
      const name = splitSpec(pkg.spec).name;
      return REMOTE_PROXIES.has(name) ? null : lower(name); // proxies are grouped by endpoint instead
    });
    const out = [];
    for (const [k, list] of groups) {
      const uniq = [...new Map(list.map((s) => [serverLabel(s), s])).values()];
      if (uniq.length > 1) out.push(['redundancy', 'same-package', `${k} is configured ${uniq.length} times`, uniq.map(serverLabel)]);
    }
    return out;
  },
  sameSkillName(data) {
    const out = [];
    for (const [n, list] of groupBy(data.skills, (s) => s.name)) {
      if (new Set(list.map((s) => s.source)).size > 1) out.push(['redundancy', 'same-skill-name', `skill "${n}" exists in ${list.length} places`, list.map((s) => `${s.source}: ${s.path}`)]);
    }
    return out;
  },
  overlap(data, pack) {
    const out = [];
    for (const g of asArray(pack.overlapGroups)) {
      const members = [
        ...[...groupBy(data.plugins.filter((p) => p.enabled && matches(g.match, { plugin: p })), (p) => p.id).values()].map(([p]) => ({ label: `plugin ${p.id}`, pack: isPackPlugin(pack, p) })),
        ...data.mcp.filter((s) => matches(g.match, { server: s })).map((s) => ({ label: `mcp ${s.name} (${s.source})`, pack: isPackServer(pack, s) })),
        ...data.skills.filter((s) => matches(g.match, { skill: s })).map((s) => ({ label: `skill ${s.name} (${s.source})`, pack: isPackSkill(pack, data, s) })),
      ];
      if (members.length > 1) {
        const f = ['redundancy', `overlap:${g.id}`, `${g.label}: ${members.length} tools cover the same job`, [...members.map((m) => m.label + (m.pack ? ' [pack item]' : '')), `note: ${g.note}`]];
        if (members.every((m) => m.pack)) f.push({ packManaged: true });
        out.push(f);
      }
    }
    return out;
  },
  disabledInstalled(data) {
    const out = [];
    for (const [id, list] of groupBy(data.plugins.filter((p) => !p.enabled), (p) => p.id)) {
      if (data.plugins.some((p) => p.id === id && p.enabled)) continue; // enabled in another scope
      out.push(['redundancy', 'disabled-installed', `plugin ${id} is installed but disabled`, list.map((p) => `scope ${p.scope}, version ${p.version}`)]);
    }
    return out;
  },
  inlineSecret(data) {
    const out = [];
    for (const s of data.mcp) {
      const raw = s[RAW];
      const places = [];
      const envKeys = inlineSecretKeys(raw.env); if (envKeys.length) places.push(`env: ${envKeys.join(', ')}`);
      const hdrKeys = inlineSecretKeys(raw.headers); if (hdrKeys.length) places.push(`headers: ${hdrKeys.join(', ')}`);
      const argHits = [...new Set(redactArgs(raw.args, raw.command).hits)]; if (argHits.length) places.push(`args: ${argHits.join(', ')}`);
      const urlHits = raw.url ? [...new Set(redactUrl(raw.url).hits)] : []; if (urlHits.length) places.push(`url: ${urlHits.join(', ')}`);
      if (places.length) out.push(['risk', 'inline-secret', `MCP "${s.name}" stores a credential in plain text in its config`, [`source: ${s.source}`, ...places, 'values not shown']]);
    }
    return out;
  },
  localPath(data) {
    const { home, platform, short } = data.ctx;
    const out = [];
    for (const s of data.mcp) {
      const { command, args } = unwrapCommand(s[RAW].command, s[RAW].args);
      const p = [command, ...args].find((a) => isLocalPath(a, home, platform));
      if (p) out.push(['risk', 'local-path-mcp', `MCP "${s.name}" runs code from a local path`, [`source: ${s.source}`, `path: ${redactText(short(p)).text}`]]);
    }
    const byPath = groupBy(data.hooks.map((h) => ({ h, p: tokenizeCommand(h[RAW]).find((a) => isLocalPath(a, home, platform)) })).filter((x) => x.p), (x) => `${redactText(short(x.p)).text}\u0000${x.h.source}`);
    for (const [k, list] of byPath) {
      const [p, source] = k.split('\u0000');
      out.push(['risk', 'local-path-hook', `hooks run code from a local path: ${p}`, [`source: ${source}`, `events: ${[...new Set(list.map((x) => x.h.event))].join(', ')}`]]);
    }
    return out;
  },
  hookEveryTool(data) {
    const out = [];
    const every = data.hooks.filter((h) => /^(Pre|Post)ToolUse$/.test(h.event) && (h.matcher == null || EVERY_TOOL_MATCHERS.has(h.matcher.trim())));
    for (const [cmd, list] of groupBy(every, (h) => cap(data.ctx.shortText(h.command), 160))) {
      out.push(['risk', 'hook-every-tool', `a hook with no matcher (or "*") runs on every tool call: ${cmd}`, [...new Set(list.map((h) => `${h.event} (${h.source})`))]]);
    }
    return out;
  },
  runsLatest(data) {
    const out = [];
    for (const s of data.mcp) {
      const pkg = packageSpecOf(s[RAW].command, s[RAW].args);
      if (!pkg) continue;
      const { name, version } = splitSpec(pkg.spec);
      if (!isUnpinned(version)) continue; // pinned: it does not change on its own
      out.push(['info', 'runs-latest-from-registry', `MCP "${s.name}" runs ${name}${version ? '@' + version : ''} via ${pkg.runner}, resolved from the registry`, [`source: ${s.source}`, 'a new upstream release reaches you on the next start, good or bad']]);
    }
    return out;
  },
  unhealthy(data) {
    const sick = groupBy(data.health.filter((h) => !isConnected(h.status)), (h) => (h.name.startsWith('plugin:') ? `plugin ${h.name.split(':')[1]}` : h.name.startsWith('claude.ai ') ? 'claude.ai connectors' : 'configured servers'));
    return [...sick].map(([origin, list]) => ['risk', 'mcp-unhealthy', `${origin}: ${list.length} MCP server(s) not connected`,
      list.map((h) => `${h.name.replace(/^plugin:[^:]+:/, '')}: ${h.status}${data.disabledHere.includes(h.name) ? ', disabled here' : ''}`)]);
  },
  thirdPartyMarketplace(data, pack) {
    const packMarkets = asObject(pack.marketplaces);
    return data.marketplaces.filter((m) => !lower(m.repo).startsWith('anthropics/')).map((m) => {
      const managed = Object.prototype.hasOwnProperty.call(packMarkets, m.name);
      const f = ['risk', 'third-party-marketplace', `marketplace "${m.name}" is not from Anthropic`, [m.repo ? `github: ${m.repo}` : m.url ? `${m.source ?? 'url'}: ${m.url}` : `${m.source}: ${m.path ?? ''}`, ...(managed ? ['pack-managed: kktestdev-pack adds this marketplace'] : [])]];
      if (managed) f.push({ packManaged: true });
      return f;
    });
  },
  skillWithScripts(data) {
    const scripted = groupBy(data.skills.filter((s) => s.scripts.length && !s.source.startsWith('plugin ')), (s) => s.source);
    return [...scripted].map(([source, list]) => ['risk', 'skill-with-scripts', `${list.length} skill(s) from ${source} ship executable scripts`,
      list.map((s) => `${s.name} (${s.scripts.length}${s.scripts.length >= LIMITS.scriptHits ? '+' : ''} scripts, ${s.path})`)]);
  },
  broadPermission(data) {
    return data.permissions.filter((p) => BROAD_PERMISSION.test(p.rule)).map((p) => ['risk', 'broad-permission', `broad permission rule: ${cap(p.rule, 120)}`, [`source: ${p.source}`]]);
  },
};
export const FINDING_CATEGORIES = ['same-endpoint', 'same-package', 'same-skill-name', 'overlap:<group>', 'disabled-installed', 'inline-secret', 'local-path-mcp', 'local-path-hook', 'hook-every-tool', 'runs-latest-from-registry', 'mcp-unhealthy', 'third-party-marketplace', 'skill-with-scripts', 'broad-permission'];

export function audit(data, pack) {
  const findings = [];
  for (const [name, detector] of Object.entries(DETECTORS)) {
    try {
      for (const [type, category, title, evidence, extra] of detector(data, pack)) {
        findings.push({ type, category, title: cap(title), evidence: capList(evidence.map((e) => cap(e))), ...(extra ?? {}) });
      }
    } catch (e) { data.ctx.note(`audit check ${name} failed: ${cap(e.message, 120)}`); }
  }
  return findings;
}

// ---------------------------------------------------------------- output
function capped(ctx, label, list) {
  if (list.length > LIMITS.list) ctx.note(`installed.${label}: showing ${LIMITS.list} of ${list.length}`);
  return list.slice(0, LIMITS.list);
}
export function buildOutput(data, pack, findings, { full = false, now = new Date() } = {}) {
  const { ctx } = data;
  const out = {
    generatedAt: now.toISOString(), cwd: ctx.short(ctx.cwd), platform: ctx.platform, node: process.versions.node,
    mode: full ? 'full' : 'compact', healthChecked: data.healthChecked,
    counts: { plugins: data.plugins.length, marketplaces: data.marketplaces.length, mcp: data.mcp.length, mcpHealth: data.health.length, skills: data.skills.length, hooks: data.hooks.length },
    pack, findings,
  };
  if (full) {
    out.installed = {
      plugins: capped(ctx, 'plugins', data.plugins.map(({ installPath, ...p }) => p)),
      marketplaces: capped(ctx, 'marketplaces', data.marketplaces),
      mcp: capped(ctx, 'mcp', data.mcp.map((s) => ({ ...s, url: s.url && cap(s.url), command: s.command && cap(s.command), args: s.args.slice(0, 30).map((a) => cap(a, 120)) }))),
      mcpHealth: capped(ctx, 'mcpHealth', data.health.map((h) => ({ ...h, target: cap(h.target, 160) }))),
      skills: capped(ctx, 'skills', data.skills.map(({ scripts, ...s }) => ({ ...s, name: cap(s.name, 120) }))),
      hooks: capped(ctx, 'hooks', data.hooks.map((h) => ({ ...h, command: cap(ctx.shortText(h.command), 200) }))),
    };
  }
  out.notes = ctx.notes;
  return out;
}

export async function run(argv = [], opts = {}) {
  const full = argv.includes('--full') || argv.includes('--detail');
  const fast = argv.includes('--fast');
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const notes = [];
  try {
    const pack = opts.pack ?? JSON.parse(readFileSync(nodePath.join(here, '..', 'pack.json'), 'utf8'));
    const data = await collect({ home: opts.home ?? homedir(), cwd: opts.cwd ?? process.cwd(), platform: opts.platform, env: opts.env, runClaude: opts.runClaude, fast });
    for (const p of validatePack(pack)) data.ctx.note(p);
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) data.ctx.note(`Node ${process.versions.node}: some pack servers need Node 22.22+ (typescript-language-server) or 20.19+ (chrome-devtools-mcp, shadcn, bantamkit-mcp)`);
    const findBin = opts.findBin ?? ((b) => findBinDefault(b, { env: opts.env ?? process.env, platform: opts.platform ?? process.platform }));
    const pk = packStatus(data, pack, findBin);
    const out = buildOutput(data, pk, audit(data, pack), { full });
    // AI hosts and model-provider signals (names only) for the options step; options.mjs has the per-item detail
    const hostsInfo = readHosts({ home: data.ctx.home, cwd: data.ctx.cwd, env: opts.env ?? process.env, platform: data.ctx.platform });
    out.hosts = hostsInfo.hosts.map((h) => ({ id: h.id, label: h.label, present: h.present, mcpServers: h.servers.length, configFiles: h.files.map((f) => data.ctx.short(f.file)) }));
    out.providers = detectProviders({ env: opts.env ?? process.env, hosts: hostsInfo.hosts, findBin }).filter((p) => p.signals.length);
    for (const n of hostsInfo.notes) data.ctx.note(redactText(n).text);
    return out;
  } catch (e) {
    notes.push(`inventory failed: ${cap(redactText(e?.message ?? String(e)).text, 300)}`);
    return { generatedAt: new Date().toISOString(), error: true, pack: [], findings: [], notes };
  }
}

// ---------------------------------------------------------------- main (only when executed, not when imported)
const isMain = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const argv = process.argv.slice(2);
  run(argv).then(
    (out) => process.stdout.write(JSON.stringify(out, null, argv.includes('--pretty') ? 2 : 0) + '\n'),
    (e) => process.stdout.write(JSON.stringify({ error: true, notes: [`inventory failed: ${String(e?.message ?? e).slice(0, 200)}`] }) + '\n'),
  );
}
