#!/usr/bin/env node
// `npm test` on every OS: the Node suite, then the infographic Python suite with whichever
// Python 3 exists (python3, python, or the Windows launcher `py -3`) (G3-X8).
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }).status;

function findPython() {
  for (const [cmd, ...pre] of [['python3'], ['python'], ['py', '-3']]) {
    const r = spawnSync(cmd, [...pre, '-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') return [cmd, pre];
  }
  return null;
}

let code = run(process.execPath, ['--test', 'tools/test/*.test.mjs']);
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
