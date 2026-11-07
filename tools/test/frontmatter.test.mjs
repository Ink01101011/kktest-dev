import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { FrontmatterError, parseFrontmatter, parseYamlSubset, serializeFrontmatter, transformFrontmatter } from '../lib/frontmatter.mjs';
import { loadCatalog } from '../lib/catalog.mjs';
import { ROOT, python } from './helpers.mjs';

test('parses the YAML forms the repo uses', () => {
  const d = parseYamlSubset(
    [
      'name: plain-name',
      'description: "a quoted',
      '  multi-line \\"value\\"',
      '',
      '  after blank"',
      "single: 'it''s'",
      'folded: >',
      '  one',
      '  two',
      '',
      '  three',
      'strip: >-',
      '  x',
      'literal: |',
      '  a',
      '  b',
      'metadata:',
      '  version: "0.1.0"',
      '  author: Ink',
      'version: "1"',
    ].join('\n'),
  );
  assert.equal(d.name, 'plain-name');
  assert.equal(d.description, 'a quoted multi-line "value"\nafter blank');
  assert.equal(d.single, "it's");
  assert.equal(d.folded, 'one two\nthree\n');
  assert.equal(d.strip, 'x');
  assert.equal(d.literal, 'a\nb\n');
  assert.deepEqual(d.metadata, { version: '0.1.0', author: 'Ink' });
  assert.equal(d.version, '1');
});

test('rejects YAML it does not understand instead of guessing', () => {
  for (const bad of ['tags:\n  - a\n  - b', 'x: [a, b]', 'x: {a: 1}', 'meta:\n  deep:\n    k: v', 'a: 1\na: 2', 'x: "unterminated', '  indented: 1']) {
    assert.throws(() => parseYamlSubset(bad, 'fixture'), FrontmatterError, bad);
  }
});

test('every SKILL.md in the repo parses, names match folders, and PyYAML agrees when available', async () => {
  const cat = loadCatalog(ROOT);
  const skills = cat.plugins.flatMap((p) => p.skills);
  assert.ok(skills.length >= 27);
  for (const s of skills) {
    assert.equal(s.name, s.dirName);
    assert.ok(String(s.data.description).trim().length <= 1024, s.name);
  }
  const py = python();
  const hasYaml = py && spawnSync(py, ['-I', '-c', 'import yaml'], { encoding: 'utf8' }).status === 0;
  if (!hasYaml) return;
  const files = skills.map((s) => path.join(s.dir, 'SKILL.md'));
  const r = spawnSync(
    py,
    ['-I', '-c', 'import sys,yaml,json\nout=[yaml.safe_load(open(f,encoding="utf-8").read().split("---\\n",2)[1]) for f in sys.argv[1:]]\nprint(json.dumps(out,default=str))', ...files],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(skills.map((s) => s.data), JSON.parse(r.stdout));
});

test('export transform: non-spec keys move under metadata, spec keys stay', () => {
  const fm = transformFrontmatter({ name: 'x-y', description: 'short', version: '0.1.0', updated: '2026-07-02', metadata: { author: 'Ink' } });
  assert.deepEqual(fm, { name: 'x-y', description: 'short', metadata: { author: 'Ink', version: '0.1.0', updated: '2026-07-02' } });
  assert.throws(() => transformFrontmatter({ name: 'a', description: 'd', version: '1', metadata: { version: '2' } }), /both top-level and under metadata/);
  assert.throws(() => transformFrontmatter({ name: 'Bad_Name', description: 'd' }), /invalid skill name/);
});

test('description limits: zip targets use metadata.short-description, never truncate', () => {
  const long = 'word '.repeat(60).trim(); // 299 chars
  const ok = transformFrontmatter({ name: 'a', description: long, metadata: { 'short-description': 'Short form.' } }, { zip: true });
  assert.equal(ok.description, 'Short form.');
  // folder targets keep the full description
  assert.equal(transformFrontmatter({ name: 'a', description: long }).description, long);
  assert.throws(() => transformFrontmatter({ name: 'long-skill', description: long }, { zip: true }), (e) => e instanceof FrontmatterError && /long-skill/.test(e.message) && /short-description/.test(e.message));
  assert.throws(() => transformFrontmatter({ name: 'a', description: long, metadata: { 'short-description': long } }, { zip: true }), /short-description is 299/);
  assert.throws(() => transformFrontmatter({ name: 'a', description: 'x'.repeat(1025) }), /1025 chars \(limit 1024\)/);
});

test('every repo skill over 200 chars has a short description of at most 200', () => {
  for (const p of loadCatalog(ROOT).plugins) {
    for (const s of p.skills) {
      const fm = transformFrontmatter(s.data, { skill: s.name, zip: true });
      assert.ok(fm.description.length <= 200, s.name);
    }
  }
});

test('serialize -> parse round-trips', () => {
  const data = { name: 'a-b', description: 'He said "hi"\nand: left', metadata: { 'short-description': 'é ไทย', version: '0.1' } };
  const text = serializeFrontmatter(data) + 'body\n';
  const back = parseFrontmatter(text, 't');
  assert.deepEqual(back.data, data);
  assert.equal(back.body, 'body\n');
});

test('source SKILL.md files keep their Claude Code frontmatter (version/updated stay top-level)', () => {
  const t = fs.readFileSync(`${ROOT}/plugins/agent-loops/skills/quality-loops/SKILL.md`, 'utf8');
  const { data } = parseFrontmatter(t, 'q');
  assert.equal(data.version, '0.1.1');
  assert.ok(data.metadata['short-description']);
});
