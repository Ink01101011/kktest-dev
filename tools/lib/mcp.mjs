// MCP config emitters, one per tool, each in that tool's documented syntax (docs/providers.md).
// Env values that are references (secrets, user settings) are emitted as references, never values.
import { RefusedError } from './catalog.mjs';

const PLACEHOLDER = (name) => `<set ${name} here>`;

// How each target spells "read this from the environment".
const REF_SYNTAX = {
  cursor: (n) => `\${env:${n}}`, // cursor.com/docs/mcp
  vscode: (n) => `\${env:${n}}`, // code.visualstudio.com/docs/agents/reference/mcp-configuration
  gemini: (n) => `\${${n}}`, // geminicli.com/docs/tools/mcp-server ($VAR / ${VAR})
  'claude-desktop': null, // no reference support documented
  windsurf: null, // unverified
};

export const CONFIG_KEY = { cursor: 'mcpServers', vscode: 'servers', gemini: 'mcpServers', 'claude-desktop': 'mcpServers', windsurf: 'mcpServers' };

function value(v, target, pathFor, notes, serverName) {
  if (v.kind === 'literal') return v.value;
  if (v.kind === 'path') return pathFor(v.rel);
  const ref = REF_SYNTAX[target];
  if (ref) return ref(v.name);
  notes.push(`${serverName}: ${target} does not support env references; replace the placeholder for ${v.name} in the config by hand (the value is never written by kktest-dev)`);
  return PLACEHOLDER(v.name);
}

/** JSON entry for one server. @returns {{entry: object, notes: string[]}} */
export function jsonEntry(target, server, pathFor) {
  if (!(target in REF_SYNTAX)) throw new RefusedError(`no JSON emitter for ${target}`);
  const notes = [];
  const entry = {};
  if (target === 'vscode') entry.type = 'stdio';
  entry.command = server.command;
  entry.args = server.args.map((a) => {
    if (a.kind === 'ref') throw new RefusedError(`${server.name}: env references in args are not supported`);
    return value(a, target, pathFor, notes, server.name);
  });
  const env = {};
  for (const [k, v] of Object.entries(server.env)) env[k] = value(v, target, pathFor, notes, server.name);
  if (Object.keys(env).length) entry.env = env;
  return { entry, notes };
}

export function jsonSnippet(target, servers, pathFor) {
  const notes = [];
  const block = {};
  for (const s of servers) {
    const r = jsonEntry(target, s, pathFor);
    block[s.name] = r.entry;
    notes.push(...r.notes);
  }
  return { text: JSON.stringify({ [CONFIG_KEY[target]]: block }, null, 2) + '\n', notes };
}

const TOML_ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };

/** TOML basic string (toml.io v1.0.0): escape quotes, backslashes, U+0000-001F and U+007F; no lone surrogates. */
export function tomlStr(value) {
  const s = String(value);
  if (!s.isWellFormed()) throw new RefusedError(`cannot write ${JSON.stringify(s)} to TOML: it contains a lone surrogate`);
  return `"${s.replace(/["\\\u0000-\u001f\u007f]/g, (c) => TOML_ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)}"`;
}
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlStr(k));

/** Codex `[mcp_servers.<name>]` table (learn.chatgpt.com/docs/extend/mcp?surface=cli). */
export function codexToml(server, pathFor) {
  const lines = [`[mcp_servers.${tomlKey(server.name)}]`, `command = ${tomlStr(server.command)}`];
  const args = server.args.map((a) => {
    if (a.kind === 'ref') throw new RefusedError(`${server.name}: env references in args are not supported`);
    return a.kind === 'path' ? pathFor(a.rel) : a.value;
  });
  lines.push(`args = [${args.map(tomlStr).join(', ')}]`);
  const refs = Object.entries(server.env).filter(([, v]) => v.kind === 'ref');
  // Codex has no ${VAR} interpolation; env_vars forwards variables from the parent environment.
  if (refs.length) lines.push(`env_vars = [${refs.map(([, v]) => tomlStr(v.name)).join(', ')}]`);
  const fixed = Object.entries(server.env).filter(([, v]) => v.kind !== 'ref');
  for (const [k, v] of refs) if (k !== v.name) throw new RefusedError(`${server.name}: Codex env_vars cannot rename ${v.name} to ${k}`);
  if (fixed.length) {
    lines.push('', `[mcp_servers.${tomlKey(server.name)}.env]`);
    for (const [k, v] of fixed) lines.push(`${tomlKey(k)} = ${tomlStr(v.kind === 'path' ? pathFor(v.rel) : v.value)}`);
  }
  return lines.join('\n') + '\n';
}

/** Escape a string for use inside a RegExp. */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Conservative check of an existing config.toml for a server table.
 * @returns {'absent'|'present'|'unsure'}
 */
export function codexTableState(text, name) {
  const toml = text.replace(/^\uFEFF/, '');
  const n = reEscape(name);
  const key = `(?:${n}|"${n}"|'${n}')`;
  // [ \t]* (not \s*): \s crosses newlines, which made a file of blank lines O(n^2) (G4-M1).
  if (new RegExp(`^[ \\t]*\\[[ \\t]*mcp_servers[ \\t]*\\.[ \\t]*${key}[ \\t]*[\\].]`, 'm').test(toml)) return 'present';
  // Forms we do not parse: [mcp_servers] tables, dotted keys, inline tables, the name anywhere else.
  if (/^[ \t]*\[[ \t]*mcp_servers[ \t]*\]/m.test(toml)) return 'unsure';
  if (/^[ \t]*mcp_servers[ \t]*[.=]/m.test(toml)) return 'unsure';
  if (new RegExp(`mcp_servers[^\\n]*(?<![A-Za-z0-9_-])${n}(?![A-Za-z0-9_-])`).test(toml)) return 'unsure';
  return 'absent';
}

/** True when a JSON-with-comments file actually contains comments (outside strings). */
export function hasJsonComments(text) {
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) return true;
  }
  return false;
}
