// Windows verification for the CLI (#20). Every test runs on every OS: directory junctions need no admin rights on
// Windows and are plain directory symlinks elsewhere, so the link-safety rules the POSIX-only tests pin are also
// checked on windows-latest. The first test keeps docs/windows.md in step with every POSIX-only skip.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkTarget } from '../lib/safefs.mjs';
import { ROOT, runCli, tmpdir } from './helpers.mjs';

const read = (f) => fs.readFileSync(f, 'utf8');
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
const SECRET = 'FAKE-TOKEN-NOT-REAL';
const junction = (target, link) => fs.symlinkSync(path.resolve(target), link, 'junction'); // absolute target: junctions need one

// ------------------------------------------------------------------ every POSIX-only skip is documented
const TEST_DIRS = ['tools/test', 'plugins/kktestdev-pack/skills/kk-onboard/scripts'];
/** titles of tests skipped on Windows only (the skip mentions `posix` or `=== 'win32'`) */
export function osSkips(src) {
  const out = [];
  const re = /\btest\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*\{([^{}]*)\}/g;
  for (const m of src.matchAll(re)) {
    const skip = m[3].match(/\bskip\s*:\s*([^,]*(?:\([^)]*\)[^,]*)?)/);
    if (skip && /\bposix\b|===\s*['\"]win32['\"]/.test(skip[1])) out.push(m[2].replace(/\\(.)/g, '$1'));
  }
  return out;
}

test('osSkips finds Windows-only skips only', () => {
  const src = "test('a', { skip: !posix && 'modes' }, f);\ntest(\"b\", { skip: !posix || process.getuid?.() === 0 }, f);\ntest('c', { skip: !smoke }, f);\ntest('d', () => {});\ntest('e\\'s', { timeout: 1, skip: process.platform === 'win32' && 'bash' }, f);\ntest('w', { skip: !win && 'win32 only' }, f);";
  assert.deepEqual(osSkips(src), ['a', 'b', "e's"]);
});

test('#20: every Windows-only test skip is listed in docs/windows.md, and every listed one still exists', () => {
  const doc = read(path.join(ROOT, 'docs', 'windows.md'));
  const found = [];
  for (const dir of TEST_DIRS) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.test.mjs')).sort()) {
      if (dir === 'tools/test' && f === 'windows.test.mjs') continue; // this file's own fixtures
      for (const title of osSkips(read(path.join(ROOT, dir, f)))) found.push({ file: `${dir}/${f}`, title });
    }
  }
  assert.ok(found.length > 0, 'no OS-dependent skip found: the scan is broken');
  const missing = found.filter(({ file, title }) => !doc.includes(`\`${title}\``) || !doc.includes(file));
  assert.deepEqual(missing, [], 'document each skip in docs/windows.md (title in backticks, with its file)');
  // the skip table rows: | `file` | `title` | ... ; every row must still match a skipped test
  const rows = [...doc.matchAll(/^\|\s*`([^`]+\.test\.mjs)`\s*\|\s*`([^`]+)`\s*\|/gm)].map((m) => ({ file: m[1], title: m[2] }));
  const stale = rows.filter((r) => !found.some((f) => f.title === r.title && f.file.endsWith(r.file)));
  assert.deepEqual(stale, [], 'docs/windows.md lists a skip that no longer exists');
  assert.equal(rows.length, found.length, 'one table row per skip');
});

// ------------------------------------------------------------------ link safety with junctions (Windows equivalent)
test('G2-02 (all OSes; win32 = junction): project scope refuses a linked config folder; nothing is read into the repo', () => {
  const home = tmpdir();
  const secret = path.join(home, '.ssh', 'id_fake');
  fs.mkdirSync(path.dirname(secret));
  fs.writeFileSync(secret, `-----BEGIN FAKEKEYMATERIAL-----\n${SECRET}\n`);
  const cases = [
    ['codex', '.codex (folder)', (repo) => junction(path.dirname(secret), path.join(repo, '.codex'))],
    ['agents', '.agents/skills', (repo) => (fs.mkdirSync(path.join(repo, '.agents')), junction(path.dirname(secret), path.join(repo, '.agents', 'skills')))],
    ['cursor', '.cursor (folder)', (repo) => junction(path.dirname(secret), path.join(repo, '.cursor'))],
  ];
  for (const [target, label, plant] of cases) {
    const repo = tmpdir();
    plant(repo);
    for (const extra of [[], ['--apply', '--yes']]) {
      const r = runCli(['install', '--target', target, '--scope', 'project', ...extra], { home, cwd: repo });
      assert.equal(r.code, 2, `${label}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /REFUSED: .*is a symbolic link/, label);
      assert.ok(!r.stdout.includes(SECRET), label);
    }
    assert.deepEqual(ls(path.dirname(secret)), ['id_fake'], `${label}: something was written through the link`);
  }
});

test('checkTarget (all OSes; win32 = junction): a linked folder is never a project target or replaced; one leaving the root is refused', () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'real'));
  junction(path.join(root, 'real'), path.join(root, 'link'));
  assert.equal(checkTarget(path.join(root, 'link', 'f'), { root, scope: 'user' }).ok, true);
  assert.equal(checkTarget(path.join(root, 'link', 'f'), { root, scope: 'project' }).ok, false);
  assert.equal(checkTarget(path.join(root, 'link'), { root, scope: 'user', kind: 'dir' }).ok, false, 'never replace a linked folder');
  junction(tmpdir(), path.join(root, 'out'));
  assert.equal(checkTarget(path.join(root, 'out', 'f'), { root, scope: 'user' }).ok, false);
});
