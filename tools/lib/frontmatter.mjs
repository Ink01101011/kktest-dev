// SKILL.md frontmatter: a deliberately small YAML subset parser + serializer.
//
// Supported (what the repo's 27 skills use): `key: plain`, `key: "double-quoted"` and
// `key: 'single-quoted'` (both may span lines; YAML line folding applies), block scalars
// `key: >`, `>-`, `|`, `|-`, and one level of nested map (`metadata:` + indented `k: v`).
// Anything else (lists, flow collections, anchors, deeper nesting) throws FrontmatterError
// rather than guessing.

export class FrontmatterError extends Error {}

// agentskills.io specification: https://agentskills.io/specification (see docs/providers.md).
export const SPEC_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
export const LIMITS = { name: 64, description: 1024, zipDescription: 200, compatibility: 500 };

export function splitFrontmatter(text, label = 'SKILL.md') {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) throw new FrontmatterError(`${label}: missing frontmatter (no leading ---)`);
  const end = src.indexOf('\n---', 3);
  if (end < 0) throw new FrontmatterError(`${label}: unterminated frontmatter`);
  const after = src.indexOf('\n', end + 4);
  const closeLine = src.slice(end + 1, after < 0 ? src.length : after);
  if (closeLine.trim() !== '---') throw new FrontmatterError(`${label}: bad frontmatter terminator`);
  return { yaml: src.slice(4, end + 1), body: after < 0 ? '' : src.slice(after + 1) };
}

function fold(lines) {
  // YAML flow-scalar folding: a single line break -> space, each empty line -> '\n'.
  let out = '';
  let pendingBreaks = 0;
  lines.forEach((ln, i) => {
    const t = i === 0 ? ln.replace(/\s+$/, '') : ln.trim();
    if (i > 0 && t === '') { pendingBreaks++; return; }
    if (i > 0) out += pendingBreaks ? '\n'.repeat(pendingBreaks) : ' ';
    pendingBreaks = 0;
    out += t;
  });
  return out;
}

const ESCAPES = { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', '0': '\0', ' ': ' ' };

function unescapeDouble(s, label) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, e) => {
    if (e[0] === 'u' || e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e in ESCAPES) return ESCAPES[e];
    throw new FrontmatterError(`${label}: unsupported escape ${m}`);
  });
}

// Returns [value, nextLineIndex].
function readScalar(first, lines, i, indent, label) {
  const v = first.trim();
  if (v === '') return [null, i + 1];
  if (/^[>|]/.test(v)) {
    const m = v.match(/^([>|])([+-]?)\s*$/);
    if (!m) throw new FrontmatterError(`${label}: unsupported block scalar header "${v}"`);
    const block = [];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || indentOf(lines[j]) > indent)) block.push(lines[j++]);
    const ind = Math.min(...block.filter((l) => l.trim()).map(indentOf));
    const raw = block.map((l) => l.slice(Math.min(ind, indentOf(l) || ind)));
    let text;
    if (m[1] === '|') text = raw.join('\n');
    else text = fold(['', ...raw]).replace(/^ /, '');
    text = text.replace(/\n+$/, '');
    if (m[2] !== '-') text += '\n';
    return [text, j];
  }
  if (v[0] === '"' || v[0] === "'") {
    const q = v[0];
    const collected = [v.slice(1)];
    let j = i;
    const closed = (s) => (q === '"' ? /(^|[^\\])(\\\\)*"\s*$/.test(s) : /(^|[^'])('')*'\s*$/.test(s) && !/^''$/.test(s.trim()));
    while (!(closed(collected[collected.length - 1]) && !(collected.length === 1 && collected[0] === ''))) {
      j++;
      if (j >= lines.length) throw new FrontmatterError(`${label}: unterminated quoted string`);
      collected.push(lines[j]);
    }
    const last = collected.length - 1;
    collected[last] = collected[last].replace(/\s+$/, '').slice(0, -1);
    const folded = fold(collected);
    const value = q === '"' ? unescapeDouble(folded, label) : folded.replace(/''/g, "'");
    return [value, j + 1];
  }
  if (/^[[{&*!|>%@`]/.test(v) || v.startsWith('- ')) {
    throw new FrontmatterError(`${label}: unsupported YAML value "${v.slice(0, 20)}"`);
  }
  // Plain scalar; allow continuation lines that are more indented.
  const collected = [v.replace(/\s+#.*$/, '')];
  let j = i + 1;
  while (j < lines.length && lines[j].trim() !== '' && indentOf(lines[j]) > indent && !/^\s*[\w-]+:(\s|$)/.test(lines[j])) {
    collected.push(lines[j++]);
  }
  return [fold(collected), j];
}

function indentOf(line) {
  return line.match(/^ */)[0].length;
}

const KEY_RE = /^( *)([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:\s+(.*)|\s*)$/;

export function parseYamlSubset(yaml, label = 'SKILL.md') {
  const lines = yaml.split('\n');
  const data = {};
  const order = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) { i++; continue; }
    const m = line.match(KEY_RE);
    if (!m || m[1].length !== 0) throw new FrontmatterError(`${label}: cannot parse frontmatter line ${i + 1}: "${line}"`);
    const key = m[2];
    if (key in data) throw new FrontmatterError(`${label}: duplicate key "${key}"`);
    const [value, next] = readScalar(m[3] ?? '', lines, i, 0, label);
    if (value === null) {
      // nested map
      const map = {};
      let j = next;
      let childIndent = null;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') { j++; continue; }
        const ind = indentOf(l);
        if (ind === 0) break;
        if (childIndent === null) childIndent = ind;
        const cm = l.match(KEY_RE);
        if (!cm || ind !== childIndent) throw new FrontmatterError(`${label}: unsupported nesting under "${key}" at line ${j + 1}`);
        const [cv, cn] = readScalar(cm[3] ?? '', lines, j, ind, label);
        if (cv === null) throw new FrontmatterError(`${label}: nesting deeper than one level under "${key}"`);
        if (cm[2] in map) throw new FrontmatterError(`${label}: duplicate key "${key}.${cm[2]}"`);
        map[cm[2]] = cv;
        j = cn;
      }
      data[key] = map;
      i = j;
    } else {
      data[key] = value;
      i = next;
    }
    order.push(key);
  }
  return data;
}

export function parseFrontmatter(text, label) {
  const { yaml, body } = splitFrontmatter(text, label);
  return { data: parseYamlSubset(yaml, label), body };
}

const q = (s) => JSON.stringify(String(s)); // a JSON string is a valid YAML double-quoted scalar

export function serializeFrontmatter(data) {
  const lines = ['---'];
  const keys = Object.keys(data);
  const ordered = [...SPEC_KEYS.filter((k) => keys.includes(k)), ...keys.filter((k) => !SPEC_KEYS.includes(k))];
  for (const k of ordered) {
    const v = data[k];
    if (v && typeof v === 'object') {
      const sub = Object.keys(v);
      if (!sub.length) continue;
      lines.push(`${k}:`);
      for (const s of sub) lines.push(`  ${s}: ${q(v[s])}`);
    } else if (k === 'name') {
      lines.push(`${k}: ${v}`);
    } else {
      lines.push(`${k}: ${q(String(v).replace(/\n$/, ''))}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

export function cleanDescription(s) {
  return String(s ?? '').replace(/\s+$/, '');
}

/**
 * Turn source frontmatter into spec-shaped frontmatter for an export target.
 * - top-level non-spec keys (version, updated, ...) move under `metadata` (string values)
 * - zip targets (claude.ai / ChatGPT) need description <= 200: use metadata.short-description,
 *   never truncate; throw if no short form exists.
 */
export function transformFrontmatter(data, { skill, zip = false } = {}) {
  const label = skill ?? data.name ?? 'skill';
  const out = {};
  const metadata = { ...(data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'metadata') continue;
    if (SPEC_KEYS.includes(k)) out[k] = typeof v === 'string' ? cleanDescription(v) : v;
    else if (typeof v === 'object' && v !== null) throw new FrontmatterError(`${label}: non-spec map key "${k}" cannot move under metadata`);
    else {
      if (k in metadata) throw new FrontmatterError(`${label}: "${k}" exists both top-level and under metadata`);
      metadata[k] = String(v);
    }
  }
  if (!out.name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(out.name) || out.name.length > LIMITS.name) {
    throw new FrontmatterError(`${label}: invalid skill name "${out.name}"`);
  }
  if (!out.description) throw new FrontmatterError(`${label}: missing description`);
  const limit = zip ? LIMITS.zipDescription : LIMITS.description;
  if (out.description.length > limit) {
    const short = metadata['short-description'];
    if (!zip || !short) {
      throw new FrontmatterError(
        `${label}: description is ${out.description.length} chars (limit ${limit})` +
          (zip ? ' and no metadata.short-description is set in the source SKILL.md' : ''),
      );
    }
    if (short.length > limit) throw new FrontmatterError(`${label}: metadata.short-description is ${short.length} chars (limit ${limit})`);
    out.description = short;
  }
  if (Object.keys(metadata).length) out.metadata = metadata;
  return out;
}
