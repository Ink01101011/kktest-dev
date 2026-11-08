#!/usr/bin/env node
// `npm test` on every OS: the Node suite, the kktestdev-pack kk-onboard suite (the same two Node
// steps CI runs), then the infographic Python suite with whichever Python 3 exists (python3,
// python, or the Windows launcher `py -3`) (G3-X8).
import { spawnSync } from 'node:child_process';

// status is null when the child is killed by a signal (OOM, CI cancel) or never starts (ENOENT): that is a failure,
// not a 0 that a later passing suite would leave in place (G1#2/G2-F2)
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).status ?? 1;

function findPython() {
  for (const [cmd, ...pre] of [['python3'], ['python'], ['py', '-3']]) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return [cmd, pre];
  }
  return null;
}

let code = run(process.execPath, ['--test', 'tools/test/*.test.mjs']);
// run it even when the first suite failed (`code ||= run(...)` would skip it), then keep the first failure
const packCode = run(process.execPath, ['--test', 'plugins/kktestdev-pack/skills/kk-onboard/scripts/*.test.mjs']);
code ||= packCode;
const py = findPython();
if (!py) {
  process.stderr.write('python 3 not found (tried python3, python, py -3): infographic tests not run\n');
  code ||= 1;
} else {
  const [cmd, pre] = py;
  const pyCode = run(cmd, [...pre, '-m', 'unittest', 'discover', '-s', 'plugins/infographic-diagram/skills/infographic-diagram/scripts', '-p', 'test_*.py']);
  code ||= pyCode;
}
process.exitCode = code ?? 1;
