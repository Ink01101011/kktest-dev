// Small helpers shared by inventory.mjs, hosts.mjs and options.mjs (single source: a change to what counts as
// "a reference" or "the same path" is made here once). Node stdlib only, no I/O at import time.
import { realpathSync } from 'node:fs';
import nodePath from 'node:path';
import { pathToFileURL } from 'node:url';

export const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const asArray = (x) => (Array.isArray(x) ? x : []);

/** config files larger than this are skipped by every script (one limit, so no script reads what another skips) */
export const CONFIG_MAX_BYTES = 50 * 1024 * 1024;
/** keys allowed in pack.json items[].options (identity hints only; never an option list) */
export const OPTION_HINT_KEYS = Object.freeze(['package', 'bin', 'envPrefix']);

// ---------------------------------------------------------------- variable references
// ${VAR}, ${VAR:-default}, ${env:VAR} (Cursor, VS Code, Windsurf), ${input:id} (VS Code prompt), $VAR, %VAR%.
// A value made only of these (plus an auth scheme word: `Bearer ${TOKEN}`) is a reference, not a literal secret.
const REF = String.raw`\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}|\$\{env:[A-Za-z_][A-Za-z0-9_]*\}|\$\{input:[A-Za-z0-9_.-]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%`;
export const ENV_REF = new RegExp(REF, 'g');
const HAS_REF = new RegExp(REF);
const AUTH_WORD = /\b(bearer|basic|token)\b/gi;

/** true when the value is empty or only variable references (+ an auth scheme word): not a literal secret */
export function isEnvRef(v) {
  return String(v ?? '').replace(ENV_REF, '').replace(AUTH_WORD, '').trim() === '';
}

/** state of one env/header value without exposing it: empty | ref (only references) | literal */
export function valueState(v) {
  if (v == null || v === '') return 'empty';
  if (typeof v !== 'string') return 'literal';
  return HAS_REF.test(v) && isEnvRef(v) ? 'ref' : 'literal';
}

// ---------------------------------------------------------------- paths
export const caseInsensitive = (platform) => platform === 'win32' || platform === 'darwin';
const pathMod = (platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix);

/** same path after / vs \, trailing slashes and (on win32/darwin) case are normalised */
export function samePath(a, b, platform = process.platform) {
  const n = (p) => { const s = String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, ''); return caseInsensitive(platform) ? s.toLowerCase() : s; };
  return n(a) === n(b);
}

/** realpath when it exists, else the resolved path */
export function canonical(p, platform = process.platform) {
  try { return realpathSync.native(p); } catch { return pathMod(platform).resolve(String(p)); }
}

/** one key per file (dedupe): canonical path, case-folded where the file system usually is */
export function canonicalFile(file, platform = process.platform) {
  const f = canonical(file, platform);
  return caseInsensitive(platform) ? f.toLowerCase() : f;
}

/** child is the same as or below parent (boundary-checked, normalised as samePath does) */
export function isInside(child, parent, platform = process.platform) {
  const n = (p) => { const s = String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, ''); return caseInsensitive(platform) ? s.toLowerCase() : s; };
  const c = n(child); const p = n(parent);
  return !!p && (c === p || c.startsWith(p + '/'));
}

// ---------------------------------------------------------------- JSON / JSONC text
/** bytes or text -> string: UTF-8 (BOM stripped), UTF-16 LE/BE with BOM (PowerShell 5.1 `Out-File`) */
export function decodeText(input) {
  if (typeof input === 'string') return input.replace(/^﻿/, '');
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input ?? '');
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    const sw = Buffer.from(b.subarray(2));
    for (let i = 0; i + 1 < sw.length; i += 2) { const t = sw[i]; sw[i] = sw[i + 1]; sw[i + 1] = t; }
    return sw.toString('utf16le');
  }
  return b.toString('utf8').replace(/^﻿/, '');
}

/** JSONC -> JSON: drops line and block comments and trailing commas, outside strings only; one linear pass */
const JSONC_TOKEN = /"(?:[^"\\\n]|\\.)*"?|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|,|[}\]]|\s+|[^"/,}\]\s]+|\//g;
export function stripJsonc(text) {
  const out = [];
  let pendingComma = -1; // index in `out` of a comma that may turn out to be trailing
  for (const [t] of String(text ?? '').matchAll(JSONC_TOKEN)) {
    if (t.startsWith('//') || t.startsWith('/*')) continue;
    if (t === ',') { pendingComma = out.length; out.push(t); continue; }
    if ((t === '}' || t === ']') && pendingComma >= 0) out[pendingComma] = '';
    if (!/^\s+$/.test(t)) pendingComma = -1;
    out.push(t);
  }
  return out.join('');
}

/** parse config text (string or bytes): BOM / UTF-16 aware; JSONC (comments, trailing commas) when allowed */
export function readJsonText(input, { jsonc = false } = {}) {
  const text = decodeText(input);
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch (e) {
    if (!jsonc) throw e;
    return JSON.parse(stripJsonc(text));
  }
}

// ---------------------------------------------------------------- main detection
/** true when the module with this import.meta.url is the script node was started with */
export function isMain(importMetaUrl) {
  try { return !!process.argv[1] && importMetaUrl === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

/**
 * The injected process runners are opts.exec (any command) and opts.execClaude (the claude CLI); they were called
 * run / runClaude before issue #23. An old name would be ignored and the REAL command run, so it is refused.
 */
export function refuseOldRunnerNames(opts) {
  for (const [old, now] of [['run', 'exec'], ['runClaude', 'execClaude']]) {
    if (opts && Object.hasOwn(opts, old)) throw new TypeError(`opts.${old} was renamed to opts.${now}`);
  }
}
