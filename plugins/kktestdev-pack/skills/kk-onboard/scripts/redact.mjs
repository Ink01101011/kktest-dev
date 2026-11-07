// kk-onboard secret redaction (pure, no I/O). Extracted from inventory.mjs (#19); inventory.mjs re-exports
// every name below for existing importers. Every regex here must stay linear in the input length:
// redact.test.mjs times each pass on long adversarial input.
import { asArray, isEnvRef, isObject } from './common.mjs';

/** text longer than this is cut (at whitespace) before redaction, which keeps every regex pass bounded */
export const REDACT_CHARS = 20000;

const asObject = (x) => (isObject(x) ? x : {});
const strArray = (x) => asArray(x).filter((a) => typeof a === 'string' || typeof a === 'number').map(String);

// ---------------------------------------------------------------- named patterns
// Key segments that make an env/header/flag/query name secret-like. Matched on whole segments of the
// snake_cased name, so AUTHOR_NAME does not match "auth" but OAUTH_TOKEN matches "token".
const SECRET_SEGMENTS = 'token|secret|password|passwd|pwd|pw|pass|api_?key|apikey|access_?key|private_?key|client_?secret|auth|authorization|bearer|cookie|credentials?|pat|signature|sig';
const SECRET_KEY = new RegExp(`(^|_)(${SECRET_SEGMENTS})(_|$)`);
// The long secret words also count glued to a prefix (#19: PGPASSWORD, DBPASSWD, CSRFTOKEN, APPSECRET), at
// the END of the name only: a glued word mid-name is too often a value (`-pXsecretY` is a flag + password).
const GLUED_SECRET = /(password|passwd|secret|token|apikey)$/;
// Query parameter names that carry a credential even though the word alone is generic (?key=, ?sig=).
const QUERY_SECRET = /^(key|sig|code|access_token|apikey)$/i;
// Well-known credential prefixes (OpenAI/Anthropic sk-, Stripe, GitHub, GitLab, Slack, AWS, Google, JWT).
const TOKEN_PREFIX = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;
// URL_IN_TEXT and KEY_RUN match a WHOLE run of key/scheme characters (the lookbehind allows one start per
// run, so a long run is scanned once: linear, G7-4), then the callback drops leading digits, dots and dashes
// to find the key or scheme the old unanchored forms found (G8-M3: `1api_key=`, `-https://`) with no length
// cap (G9-M-B/M-C: keys over 64 and schemes over 32 chars).
const URL_IN_TEXT = /(?<![a-z0-9+.-])([a-z0-9+.-]+)(:\/\/[^\s'"<>`]+)/gi;
// The credential never starts with = or : (`token : x` is a key/value pair, left to KEY_RUN, #19).
const AUTH_SCHEME = /\b(Bearer|Basic|Token)(\s+)([^\s'":=][^\s'"]*)/gi;
// key, then an optional closing quote (JSON/YAML/Python `"token": 1`, `'token': x`, escaped `\"token\":`),
// then = or : with optional blanks on both sides (`KEY = value`, #19). Blanks never cross a newline.
const KEY_RUN = /(?<![\w.-])([\w.-]+)(\\?["']?[ \t]*(?:=|:)[ \t]*)/g;
// escaped-quoted (\"x\"), double-, single-quoted, or a bare run
const PAIR_VALUE = /\\"(?:[^"\\]|\\(?!"))*\\"|"[^"]*"|'[^']*'|[^\s'"&]+/y;
const unquote = (v) => v.replace(/^\\?["']|\\?["']$/g, '');
// Schemeless userinfo `user:password@host.tld` (git remotes, DSNs without a scheme, #19). One start per run
// of user characters (lookbehind), the password stops at whitespace, `:`, `@` or `/`, so each `@` has one
// candidate start: linear. The host must have a dot or be localhost (`image:tag@sha256:..` is not a login).
// A start after `:` or `/` is allowed (`/bob:pw@h.com`, `x:bob:pw@h.com`): the password is the last field.
const USERINFO = /(?<![\w.+%-])([\w.+%-]+):([^\s@:/'"<>`]+)@((?:[\w-]+\.)+[\w-]+|localhost)\b/g;
const FLAG = /^--?[A-Za-z][\w.-]*$/;
// `-u user:password` / `--user user:password`: the part after the first colon is a password.
const USER_FLAG = /^(-u|--user|--proxy-user)$/;
// Commands whose -u takes user:password and whose short flags combine/glue (`-vu bob:pw`, `-ubob:pw`).
const CRED_U_CMDS = new Set(['curl', 'wget', 'lftp', 'aria2c', 'ftp', 'sftp', 'mongo', 'mongosh', 'mongodump', 'mongorestore', 'mongoexport', 'mongoimport', 'redis-cli', 'influx', 'rabbitmqadmin']);
// Commands whose -p takes a password, glued (`mysql -pSECRET`, `7z x -pSECRET`) or separate (`sshpass -p X`,
// `mongo -p X`). For MySQL a separate `-p X` is really a prompt + db name: X is masked anyway (fail-safe,
// display only, #19), the same trade as `docker run -u bob:staff`.
const MYSQL_CMDS = new Set(['mysql', 'mariadb', 'mysqldump', 'mysqladmin', 'mysqlimport', 'mysqlshow']);
const PASS_P_CMDS = new Set([...MYSQL_CMDS, 'sshpass', 'mongo', 'mongosh', 'mongodump', 'mongorestore', 'mongoexport', 'mongoimport', 'rabbitmqadmin', '7z', '7za', '7zr', 'rar', 'unrar']);
// A glued `-pX` in any other command is masked unless X has a shape -p commonly takes there: a port or port
// mapping (`-p8080`, `-p127.0.0.1:8080:80/udp`, `-p[::1]:80`), a short flag bundle (`mkdir -pv`, `cp -pr`),
// a path or a reference (`-p./dir`, `-p$PW`), compiler flags (`gcc -pthread -pedantic`), a pytest plugin
// switch (`-pno:cacheprovider`). Everything else is masked (fail-safe, display only, #19).
const BENIGN_GLUED_P = /^(?:\d+(?:[.:/-]\d+)*(?:\/(?:tcp|udp|sctp))?|[A-Za-z]{1,3}|[./~$%\\[].*|thread|edantic(?:-errors)?|no:[\w.-]+)$/;

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
// `(?<![\w-])` and `(?![\w-])` instead of \b: `7z` must not match inside `p7z`, and `-` is part of a name.
const PASS_P_WORD = new RegExp(`(?<![\\w-])(${[...PASS_P_CMDS].join('|')})(\\.exe)?(?![\\w-])`, 'i');
function credContext(words) {
  const text = words.map((w) => String(w ?? '')).join(' ');
  const credU = CRED_U_WORD.test(text);
  const mysql = MYSQL_WORD.test(text);
  return { credU: credU || mysql, mysql, passP: mysql || PASS_P_WORD.test(text) };
}
/** a glued -p value that must be masked: always in a password -p command, else unless it looks benign */
function gluedPSecret(val, ctx) {
  const v = unquote(val);
  if (val === '***' || v === '***' || isEnvRef(v)) return false;
  return ctx.passP || !BENIGN_GLUED_P.test(v);
}

// ---------------------------------------------------------------- detection + redaction
const snake = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
export const secretKey = (k) => { const s = snake(String(k).replace(/^-+/, '')); return SECRET_KEY.test(s) || GLUED_SECRET.test(s); };

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
  // glued -pX: every password -p command, and any other command unless X looks like a port/flags/path (#19)
  seg = seg.replace(/(^|\s)-p(?!\s)("[^"]*"|'[^']*'|[^\s'"]+)/g, (m, pre, val) => {
    if (!gluedPSecret(val, ctx)) return m;
    hits.push('"-p" password'); return `${pre}-p***`;
  });
  // separate -p X: only in a password -p command (elsewhere it is a port, a path, a project name, #19)
  if (ctx.passP) {
    seg = seg.replace(new RegExp(`(^|\\s)-p(\\s+)(?!-)${VALUE}`, 'g'), (m, pre, sp, val) => {
      if (val === '***' || isEnvRef(unquote(val))) return m;
      hits.push('"-p" password'); return `${pre}-p${sp}***`;
    });
  }
  return seg;
}

/**
 * KEY=value / key: value with a secret-like key. A match whose key is NOT secret must not swallow its value:
 * in `Example: TOKEN=abc` the value of `Example:` is `TOKEN=abc`, which is itself a pair to check.
 * Linear: KEY_RUN finds each maximal key run once (the lookbehind allows one start per run, and runs do not
 * overlap), so the key scan is O(n) in total. The value is matched (sticky, at the separator's end) only for a
 * secret key; a masked value is consumed and never scanned again, and after a non-secret key the scan simply
 * continues at the value's start without reading the value. Each character is therefore read a bounded number
 * of times. A quoted value with no closing quote reads to the end once per quote character at most (any later
 * opening quote would have closed it).
 */
export function replaceKeyValues(t, hits = []) {
  const re = new RegExp(KEY_RUN.source, 'g');
  const val = new RegExp(PAIR_VALUE.source, 'y');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(t)) !== null) {
    const [whole, run, sep] = m;
    const key = run.replace(/^[^A-Za-z_]+/, '');
    if (!key || !secretKey(key)) continue; // lastIndex is already at the value's start
    val.lastIndex = m.index + whole.length;
    const v = val.exec(t);
    // `"***"` was masked by an earlier pass; a value starting with = is a comparison (`token == x`), not a value
    if (!v || unquote(v[0]) === '***' || v[0][0] === '=' || isEnvRef(unquote(v[0]))) continue;
    hits.push(`"${run}"`);
    out += t.slice(last, m.index) + `${run}${sep}***`;
    last = val.lastIndex;
    re.lastIndex = last;
  }
  return out + t.slice(last);
}

/** drop the trailing non-whitespace run (same as .replace(/\S*$/, '') but one backwards pass: linear) */
export function cutAtWhitespace(s) {
  let i = s.length;
  while (i > 0 && !/\s/.test(s[i - 1])) i--;
  return s.slice(0, i);
}

/** redact free text (hook commands, args, CLI output); returns { text, hits } */
export function redactText(s) {
  let t = String(s ?? '');
  // cut at the last whitespace before the limit so no secret straddles the cut as a fragment (G9 minor)
  if (t.length > REDACT_CHARS) t = `${cutAtWhitespace(t.slice(0, REDACT_CHARS))}…[truncated]`;
  return redactPasses(t);
}

/** every redaction pass, with NO length cut: exported so redact.test.mjs can time each pass at 200k+ chars */
export function redactPasses(t) {
  const hits = [];
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
  // user:password@host.tld without a scheme (URLs with a scheme were handled above)
  t = t.replace(USERINFO, (m, user, pw, host) => {
    if (pw === '***' || isEnvRef(pw) || /^mailto$/i.test(user)) return m;
    hits.push('userinfo'); return `${user}:***@${host}`;
  });
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
    if (/^-p.+/.test(a) && (mysql || gluedPSecret(a.slice(2), ctx))) {
      if (isEnvRef(a.slice(2))) out.push(a); else { hits.push('"-p" password'); out.push('-p***'); }
      continue;
    }
    if (prev === '-p' && ctx.passP && !a.startsWith('-')) {
      if (isEnvRef(a)) out.push(a); else { hits.push('"-p" password'); out.push('***'); }
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
