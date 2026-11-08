// tools/run-tests.mjs (`npm test`): a suite killed by a signal must fail the run even when the later suites pass.
// The runner is copied into a temp tree with tiny stand-in suites; nothing in the repo is run by it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { python } from './helpers.mjs';

const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'run-tests.mjs');
const PASS = "import { test } from 'node:test';\ntest('ok', () => {});\n";

function tree(t, firstSuite) {
  const root = mkdtempSync(path.join(tmpdir(), 'kkrt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel, text) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  copyFileSync(RUNNER, path.join(root, 'run-tests.mjs'));
  put('tools/test/a.test.mjs', firstSuite);
  put('plugins/kktestdev-pack/skills/kk-onboard/scripts/b.test.mjs', PASS);
  put('plugins/infographic-diagram/skills/infographic-diagram/scripts/test_ok.py', 'import unittest\nclass T(unittest.TestCase):\n    def test_ok(self):\n        pass\n');
  return root;
}
const runIn = (root) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // the nested `node --test` must run as a top-level runner, not report to this one
  return spawnSync(process.execPath, ['run-tests.mjs'], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
};

test('run-tests: all stand-in suites pass -> exit 0 (control)', { skip: !python() && 'no python 3' }, (t) => {
  const r = runIn(tree(t, PASS));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('run-tests: the first suite killed by a signal fails npm test although the next suites pass', { skip: !python() && 'no python 3' }, (t) => {
  // the test file kills its parent `node --test` process: spawnSync gives status null, signal SIGKILL
  const r = runIn(tree(t, "process.kill(process.ppid, 'SIGKILL');\nawait new Promise((r) => setTimeout(r, 5000));\n"));
  assert.notEqual(r.status, 0, r.stdout + r.stderr);
});
