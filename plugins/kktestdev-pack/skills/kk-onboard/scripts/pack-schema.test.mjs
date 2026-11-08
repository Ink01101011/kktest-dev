// pack.schema.json (JSON Schema draft 2020-12) checks pack.json, with a small stdlib-only validator (issue #23, G6).
// The validator covers exactly the keywords the schema uses; an unknown keyword fails the test instead of being
// ignored, so the schema cannot silently grow rules nothing checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTION_HINT_KEYS } from './common.mjs';
import { KNOWN_DETECT_KEYS, validatePack } from './inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', 'pack.schema.json'), 'utf8'));
const PACK = JSON.parse(readFileSync(join(HERE, '..', 'pack.json'), 'utf8'));
const clone = (x) => structuredClone(x);

const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'required', 'properties',
  'additionalProperties', 'minProperties', 'items', 'minItems', 'enum', 'const', 'minLength', 'pattern', 'allOf', 'if', 'then']);

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => typeOf(v) === t || (t === 'number' && typeOf(v) === 'integer');

/** errors of `value` against `schema` (root for $ref): [`path: message`] */
export function validate(value, schema, root = schema, path = '$') {
  const errs = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`validator does not implement "${k}" (at ${path})`);
  if (schema.$ref) {
    const m = /^#\/\$defs\/([^/]+)$/.exec(schema.$ref);
    if (!m || !root.$defs?.[m[1]]) throw new Error(`unresolved $ref ${schema.$ref}`);
    errs.push(...validate(value, root.$defs[m[1]], root, path));
  }
  if (schema.type && !isType(value, schema.type)) return [...errs, `${path}: expected ${schema.type}, got ${typeOf(value)}`];
  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) errs.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) errs.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === 'object') {
    for (const r of schema.required ?? []) if (!(r in value)) errs.push(`${path}: missing "${r}"`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) errs.push(`${path}: fewer than ${schema.minProperties} keys`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(v, sub, root, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: unknown key "${k}"`);
      else if (typeOf(schema.additionalProperties) === 'object') errs.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  for (const s of schema.allOf ?? []) errs.push(...validate(value, s, root, path));
  if (schema.if && validate(value, schema.if, root, path).length === 0 && schema.then) errs.push(...validate(value, schema.then, root, path));
  return errs;
}

test('pack.json is valid against pack.schema.json (draft 2020-12)', () => {
  assert.equal(SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(validate(PACK, SCHEMA), []);
});

test('the schema names the same detect keys and option hints the scripts accept', () => {
  assert.deepEqual(Object.keys(SCHEMA.$defs.matchKeys.properties).sort(), [...KNOWN_DETECT_KEYS].sort());
  assert.deepEqual(Object.keys(SCHEMA.$defs.item.properties.options.properties).sort(), [...OPTION_HINT_KEYS].sort());
});

// Each mutation breaks one rule. Where validatePack() checks the same rule at run time, both must reject it.
const item = (id) => (p) => p.items.find((i) => i.id === id);
const MUTATIONS = [
  ['unknown detect key', (p) => { item('superpowers')(p).detect.pluginz = ['x@']; }, true],
  ['unknown overlap match key', (p) => { p.overlapGroups[0].match.mcpNmae = ['x']; }, true],
  ['overlap "with" not an object', (p) => { const g = p.overlapGroups.find((x) => x.with); g.with = ['plugins']; }, true],
  ['unknown options key', (p) => { p.items.find((i) => i.options).options.port = '1'; }, true],
  ['unknown kind', (p) => { item('superpowers')(p).kind = 'skill'; }, true],
  ['plugin item without plugin', (p) => { delete item('superpowers')(p).plugin; }, true],
  ['mcp item without steps', (p) => { delete p.items.find((i) => i.kind === 'mcp').steps; }, true],
  ['docs item without doc', (p) => { delete p.items.find((i) => i.kind === 'docs').doc; }, true],
  ['item without id', (p) => { delete item('superpowers')(p).id; }, true],
  ['no items list', (p) => { delete p.items; }, true],
  ['unknown profile', (p) => { item('superpowers')(p).profile = 'experimental'; }, false],
  ['item missing what', (p) => { delete item('superpowers')(p).what; }, false],
  ['detect value not a list', (p) => { item('superpowers')(p).detect.plugins = 'superpowers@'; }, false],
  ['plugin id without marketplace', (p) => { item('superpowers')(p).plugin = 'superpowers'; }, false],
  ['bad envPrefix', (p) => { p.items.find((i) => i.options?.envPrefix).options.envPrefix = 'lower'; }, false],
  ['requires entry without install', (p) => { delete p.items.find((i) => i.requires).requires[0].install; }, false],
  ['unknown top-level key', (p) => { p.itmes = []; }, false],
  ['marketplace entry with an unknown key', (p) => { p.marketplaces['kktest-dev'].url = 'x'; }, false],
  ['overlap group without note', (p) => { delete p.overlapGroups[0].note; }, false],
];

for (const [name, mutate, runtime] of MUTATIONS) {
  test(`schema rejects: ${name}${runtime ? ' (validatePack too)' : ''}`, () => {
    const p = clone(PACK);
    mutate(p);
    assert.notDeepEqual(validate(p, SCHEMA), [], 'schema accepted it');
    if (runtime) assert.notDeepEqual(validatePack(p), [], 'validatePack accepted it');
  });
}

test('the validator fails loudly on a keyword it does not implement', () => {
  assert.throws(() => validate({}, { type: 'object', oneOf: [] }), /does not implement "oneOf"/);
});
