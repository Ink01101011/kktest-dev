import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = path.join(ROOT, 'tools', 'cli.mjs');

// One root per test process, removed on exit, so runs never leave kktest-dev-* folders behind (S14).
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kktest-dev-test-'));
process.on('exit', () => fs.rmSync(TMP_ROOT, { recursive: true, force: true }));

export function tmpdir(prefix = 't-') {
  return fs.mkdtempSync(path.join(TMP_ROOT, prefix));
}

/**
 * A fake HOME (and APPDATA / USERPROFILE) so nothing ever touches the real user configs.
 * Variables that would redirect the installer to a real folder (CODEX_HOME, XDG_CONFIG_HOME) or
 * change its notes (WSL) are cleared; a test that needs one passes it in `extra`.
 */
export function fakeEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming') };
  for (const k of ['CODEX_HOME', 'XDG_CONFIG_HOME', 'WSL_DISTRO_NAME', 'WSL_INTEROP']) delete env[k];
  return { ...env, ...extra };
}

export function runCli(args, { home, cwd, input, env, node = [], timeout = 60000 } = {}) {
  const h = home ?? tmpdir();
  const r = spawnSync(process.execPath, [...node, CLI, ...args], { cwd: cwd ?? h, env: fakeEnv(h, env), input: input ?? '', encoding: 'utf8', timeout });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, home: h };
}

let pythonCache;
export function python() {
  if (pythonCache !== undefined) return pythonCache;
  pythonCache = null;
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim() === '3') {
      pythonCache = cmd;
      break;
    }
  }
  return pythonCache;
}

export function treeHash(dir) {
  const out = [];
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) rec(f);
      else out.push(`${path.relative(dir, f)}:${fs.readFileSync(f).toString('base64')}`);
    }
  };
  rec(dir);
  return out.join('\n');
}
