import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildSkill, pluginRootRefs, rewritePluginRoot } from '../lib/skills.mjs';
import { parseFrontmatter } from '../lib/frontmatter.mjs';
import { crc32, createZip, readZip } from '../lib/zip.mjs';
import { ROOT, python, tmpdir, treeHash } from './helpers.mjs';

const cat = loadCatalog(ROOT);
const find = (name) => {
  for (const p of cat.plugins) for (const s of p.skills) if (s.name === name) return { p, s };
  throw new Error(name);
};

test('${CLAUDE_PLUGIN_ROOT} references are found and rewritten skill-relative', () => {
  const t = 'run `${CLAUDE_PLUGIN_ROOT}/scripts/x.py` and see ${CLAUDE_PLUGIN_ROOT}/automation/. Never hardcode; use `${CLAUDE_PLUGIN_ROOT}`.';
  assert.deepEqual(pluginRootRefs(t), ['automation', 'scripts/x.py']);
  assert.equal(rewritePluginRoot(t), "run `scripts/x.py` and see automation/. Never hardcode; use `<this skill's folder>`.");
});

test('scripts outside the skill folder are bundled and paths rewritten (prompt-evolve, memory-maintenance)', () => {
  const { p, s } = find('prompt-evolve');
  const { files } = buildSkill(s, p, { root: ROOT });
  assert.ok(files.has('scripts/pevolve.py'));
  assert.deepEqual(files.get('scripts/pevolve.py'), fs.readFileSync(path.join(ROOT, 'plugins/prompt-evolve/scripts/pevolve.py')));
  const md = files.get('SKILL.md').toString();
  assert.ok(!md.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(md.includes('`scripts/pevolve.py`'));

  const mm = find('memory-maintenance');
  const built = buildSkill(mm.s, mm.p, { root: ROOT });
  for (const f of ['scripts/memctl.py', 'automation/pre-commit', 'automation/scheduled-task.md']) assert.ok(built.files.has(f), f);
  for (const [rel, buf] of built.files) if (/\.md$/.test(rel)) assert.ok(!buf.toString().includes('${CLAUDE_PLUGIN_ROOT}'), rel);
});

test('reflexion bundles memory-keeper memctl.py and the exported CLI runs', () => {
  const { p, s } = find('reflexion');
  const { files } = buildSkill(s, p, { root: ROOT });
  assert.ok(files.has('scripts/memctl.py') && files.has('scripts/reflexionctl.py'));
  const py = python();
  if (!py) return;
  const dir = tmpdir();
  for (const [rel, data] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  }
  const mem = tmpdir();
  const r = spawnSync(py, ['-I', '-B', path.join(dir, 'scripts', 'reflexionctl.py'), '--dir', mem, 'library'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('exported frontmatter is spec-shaped; tests and caches are not exported; source untouched', () => {
  const before = treeHash(path.join(ROOT, 'plugins'));
  const { p, s } = find('quality-loops');
  const { files } = buildSkill(s, p, { root: ROOT, zip: true });
  const { data } = parseFrontmatter(files.get('SKILL.md').toString(), 'x');
  assert.deepEqual(Object.keys(data).sort(), ['description', 'metadata', 'name']);
  assert.equal(data.metadata.version, '0.1.1');
  assert.equal(data.metadata.updated, '2026-07-02');
  assert.ok(data.description.length <= 200);

  const inf = find('infographic-diagram');
  const ib = buildSkill(inf.s, inf.p, { root: ROOT });
  assert.ok(ib.files.has('scripts/build.py'));
  for (const rel of ib.files.keys()) assert.ok(!/test_|__pycache__|\.pyc$/.test(rel), rel);
  assert.equal(treeHash(path.join(ROOT, 'plugins')), before);
});

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zip round-trips, is deterministic, and is readable by Python zipfile and unzip', () => {
  const big = Buffer.from('ไทย text\n'.repeat(500));
  const entries = [{ name: 'skill/' }, { name: 'skill/SKILL.md', data: '---\nname: skill\n---\n' }, { name: 'skill/scripts/' }, { name: 'skill/scripts/a.py', data: big }, { name: 'skill/empty.txt', data: '' }];
  const z1 = createZip(entries);
  const z2 = createZip([...entries].reverse());
  assert.ok(z1.equals(z2), 'entry order must not matter');
  const back = readZip(z1);
  assert.deepEqual(back.map((e) => e.name), ['skill/', 'skill/SKILL.md', 'skill/empty.txt', 'skill/scripts/', 'skill/scripts/a.py']);
  assert.ok(back.find((e) => e.name === 'skill/scripts/a.py').data.equals(big));
  assert.throws(() => createZip([{ name: '../evil', data: 'x' }]), /unsafe/);
  assert.throws(() => createZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), /duplicate/);

  const dir = tmpdir();
  const f = path.join(dir, 't.zip');
  fs.writeFileSync(f, z1);
  const py = python();
  if (py) {
    const r = spawnSync(
      py,
      ['-I', '-c', 'import sys,zipfile,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename:[len(z.read(i)),i.date_time[0]] for i in z.infolist()}))', f],
      { encoding: 'utf8' },
    );
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(r.stdout);
    assert.deepEqual(info['skill/scripts/a.py'], [big.length, 1980]);
    assert.deepEqual(info['skill/SKILL.md'], [20, 1980]);
  }
  const u = spawnSync('unzip', ['-l', f], { encoding: 'utf8' });
  if (!u.error) {
    assert.equal(u.status, 0, u.stderr);
    assert.match(u.stdout, /skill\/scripts\/a\.py/);
  }
});
