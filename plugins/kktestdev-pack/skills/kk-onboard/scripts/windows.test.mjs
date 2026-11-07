// Windows verification for kk-onboard (#20). Stdlib only. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// What runs where and why is in docs/windows.md. Every test here runs on every OS unless it says otherwise, so the
// Windows-shaped logic is exercised on macOS/Linux too; windows-latest CI is where the native paths are proven.
// Every fixture is a fake HOME under os.tmpdir(); the real ~/.claude* is never read. pack.json is read at run time:
// no item list is hardcoded here.
//
// KK_MCP_SMOKE=1 (set by the Windows CI step only) also launches each pack MCP server exactly as its `windows`
// step registers it (cmd /c ...) and completes an MCP initialize handshake. It needs the network (npx downloads)
// and runs `npm i -g` steps, so it is off by default. KK_MCP_SMOKE_ONLY=a,b limits it to those item ids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as inventoryRun, runCommand, tokenizeCommand } from './inventory.mjs';
import { locatePackage, run as optionsRun } from './options.mjs';

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const SCRIPT = nodePath.join(HERE, 'inventory.mjs');
const PACK = JSON.parse(readFileSync(nodePath.join(HERE, '..', 'pack.json'), 'utf8'));
const win = process.platform === 'win32';
const MCP_ITEMS = PACK.items.filter((it) => it.kind === 'mcp');

// ------------------------------------------------------------------ step parsing (pure)
const ADD = /^claude mcp add (.+?) -- (.+)$/;
/** `claude mcp add [opts] NAME -- CMD ARGS...` -> { name, scope, command, args } or null (prose / npm steps) */
export function parseMcpAdd(step) {
  const m = String(step).match(ADD);
  if (!m) return null;
  const head = tokenizeCommand(m[1]);
  const words = tokenizeCommand(m[2]);
  let scope = 'local'; let name = null;
  for (let i = 0; i < head.length; i++) {
    if (head[i] === '--scope' || head[i] === '-s') scope = head[++i];
    else if (head[i].startsWith('--scope=')) scope = head[i].slice(8);
    else if (head[i] === '--env' || head[i] === '-e' || head[i] === '--transport' || head[i] === '-t') i++;
    else if (!head[i].startsWith('-')) name = head[i];
  }
  return { name, scope, command: words[0], args: words.slice(1) };
}
/** the Windows form of a POSIX `claude mcp add` step: the launched command goes through cmd /c */
export const expectedWindowsStep = (step) => (ADD.test(step) ? step.replace(' -- ', ' -- cmd /c ') : step);

test('parseMcpAdd reads name, scope and the launched argv', () => {
  assert.deepEqual(parseMcpAdd('claude mcp add --scope user pw -- cmd /c npx -y @playwright/mcp@latest --headless'),
    { name: 'pw', scope: 'user', command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@latest', '--headless'] });
  assert.deepEqual(parseMcpAdd('claude mcp add -s project -e K=V x -- node s.js'), { name: 'x', scope: 'project', command: 'node', args: ['s.js'] });
  assert.equal(parseMcpAdd('npm i -g bantamkit-mcp@latest'), null);
});

// ------------------------------------------------------------------ (1) cmd /c step shapes, from pack.json
test('#20: every MCP item has a windows variant that is its POSIX steps with cmd /c in front of the launched command', () => {
  assert.ok(MCP_ITEMS.length > 0, 'pack.json has no mcp items');
  let adds = 0;
  for (const it of MCP_ITEMS) {
    assert.ok(Array.isArray(it.steps) && Array.isArray(it.windows), `${it.id}: steps and windows are arrays`);
    assert.equal(it.windows.length, it.steps.length, `${it.id}: one windows step per step`);
    it.steps.forEach((step, i) => {
      const w = it.windows[i];
      if (ADD.test(step)) {
        adds++;
        assert.equal(w, expectedWindowsStep(step), `${it.id} step ${i}`);
        const p = parseMcpAdd(w);
        assert.equal(p.command, 'cmd', `${it.id}: launched through cmd`);
        assert.equal(p.args[0], '/c', `${it.id}: cmd /c`);
        assert.notEqual(p.args[1], 'cmd', `${it.id}: cmd /c is not doubled`);
        assert.equal(parseMcpAdd(step).name, p.name, `${it.id}: same server name on both OSes`);
      } else if (it.scope === 'project') {
        // project-scope prose steps (the tool writes .mcp.json itself): the Windows text must say how to wrap it
        assert.ok(w.startsWith(step.replace(/\.$/, '')), `${it.id} step ${i}: the windows text extends the POSIX one`);
        assert.match(w, /\bcmd\b/, `${it.id} step ${i}: says cmd`);
        assert.match(w, /"\/c"/, `${it.id} step ${i}: says /c`);
      } else assert.equal(w, step, `${it.id} step ${i}: a non-registration step is the same on Windows`);
    });
  }
  assert.ok(adds > 0, 'no claude mcp add step was checked');
});

// ------------------------------------------------------------------ fixtures
function fakeHome(t) {
  // canonical (long, real) path: process.cwd() in a child reports it this way on macOS (/private/var) and Windows (8.3)
  const root = realpathSync.native(mkdtempSync(nodePath.join(tmpdir(), 'kk-win-')));
  t.after(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });
  const home = nodePath.join(root, 'home');
  const cwd = nodePath.join(home, 'proj');
  mkdirSync(nodePath.join(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { root, home, cwd };
}
const write = (file, data) => { mkdirSync(nodePath.dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
/** user-scope registrations exactly as each item's windows step writes them; neutral names so detection must go through the command */
function windowsRegistrations() {
  const servers = {}; const ids = {};
  MCP_ITEMS.forEach((it, n) => {
    for (const step of it.windows) {
      const p = parseMcpAdd(step);
      if (p && p.scope === 'user') { servers[`srv${n}`] = { type: 'stdio', command: p.command, args: p.args, env: {} }; ids[it.id] = `srv${n}`; }
    }
  });
  return { servers, ids };
}
/** a fake `claude` on PATH: claude.cmd on Windows (a .cmd shim, like the real npm install), a sh script elsewhere */
function fakeClaude(dir, mcpListText) {
  const js = nodePath.join(dir, 'claude-fake.cjs');
  write(js, `const a = process.argv.slice(2).join(' ');\nprocess.stdout.write(a === 'mcp list' ? ${JSON.stringify(mcpListText)} : '[]\\n');\n`);
  if (win) write(nodePath.join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0claude-fake.cjs" %*\r\n`);
  else { write(nodePath.join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`); chmodSync(nodePath.join(dir, 'claude'), 0o755); }
}
/** a minimal environment for the child, as a fresh Windows/POSIX login would have it, with HOME/USERPROFILE faked */
function childEnv(fx, bin) {
  if (!win) return { PATH: `${bin}:/usr/bin:/bin`, HOME: fx.home };
  const sys = process.env.SystemRoot || 'C:\\Windows';
  return {
    PATH: `${bin};${sys}\\System32`, PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD', SystemRoot: sys, ComSpec: process.env.ComSpec || `${sys}\\System32\\cmd.exe`,
    USERPROFILE: fx.home, HOME: fx.home, APPDATA: nodePath.join(fx.home, 'AppData', 'Roaming'), LOCALAPPDATA: nodePath.join(fx.home, 'AppData', 'Local'),
    TEMP: process.env.TEMP, TMP: process.env.TMP,
  };
}
/** the projects[] key as another tool would write it: forward slashes, other drive-letter case, trailing slash (G3-3) */
const otherForm = (p) => (win ? p.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, d) => (d === d.toLowerCase() ? d.toUpperCase() : d.toLowerCase()) + ':') + '/' : p);

// ------------------------------------------------------------------ (2) inventory end to end on a fake HOME
test('#20/G3-3: inventory.mjs CLI on a fake HOME sees cmd /c registrations and the projects[cwd] key in another path form', (t) => {
  const fx = fakeHome(t);
  const { servers, ids } = windowsRegistrations();
  assert.ok(Object.keys(ids).length > 0, 'no user-scope windows registration in pack.json');
  const canary = 'WINCANARY777';
  write(nodePath.join(fx.home, '.claude.json'), {
    mcpServers: servers,
    projects: { [otherForm(fx.cwd)]: { mcpServers: { projsrv: { command: 'node', args: ['x.js', `--token=${canary}`] } } } },
  });
  const bin = nodePath.join(fx.root, 'bin');
  fakeClaude(bin, Object.keys(servers).map((n) => `${n}: cmd /c npx x - ✓ Connected\n`).join('') + `projsrv: node x.js --token=${canary} - ✓ Connected\n`);
  const r = spawnSync(process.execPath, [SCRIPT, '--full'], { cwd: fx.cwd, encoding: 'utf8', env: childEnv(fx, bin), timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(!out.error, JSON.stringify(out.notes));
  assert.ok(!r.stdout.includes(canary), 'secret leaked');
  assert.equal(out.claudeAvailable ?? true, true, 'the fake claude shim was not run');
  assert.ok(!out.notes?.some((n) => /claude was not found/.test(n)), JSON.stringify(out.notes));
  for (const [id, name] of Object.entries(ids)) {
    const p = out.pack.find((x) => x.id === id);
    assert.equal(p?.status, 'present', `${id} registered as ${name} via cmd /c: ${JSON.stringify(p)}`);
  }
  const names = out.installed.mcp.map((s) => s.name);
  assert.ok(names.includes('projsrv'), `projects[cwd] key in another form was not matched: ${names.join(', ')}`);
});

test('#20/G3-20/G3-14a: CLAUDE_CONFIG_DIR under APPDATA is honoured; a binary that sits only in the current directory is not "installed"', (t) => {
  const fx = fakeHome(t);
  const { servers, ids } = windowsRegistrations();
  const cfg = nodePath.join(fx.home, 'AppData', 'Roaming', 'claude-cfg');
  write(nodePath.join(cfg, '.claude.json'), { mcpServers: servers });
  write(nodePath.join(fx.home, '.claude.json'), { mcpServers: {} }); // the default location must NOT be read
  const lsp = PACK.items.find((it) => Array.isArray(it.requires) && it.requires.some((r) => r?.bin));
  const binName = lsp?.requires.find((r) => r?.bin).bin;
  if (binName) { // planted in cwd (cmd.exe and `where` would find it there): the inventory must not count it
    write(nodePath.join(fx.cwd, win ? `${binName}.cmd` : binName), win ? '@echo off\r\n' : '#!/bin/sh\n');
    if (!win) chmodSync(nodePath.join(fx.cwd, binName), 0o755);
  }
  const bin = nodePath.join(fx.root, 'bin');
  fakeClaude(bin, '');
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: fx.cwd, encoding: 'utf8', env: { ...childEnv(fx, bin), CLAUDE_CONFIG_DIR: cfg }, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(out.notes.some((n) => /CLAUDE_CONFIG_DIR is set/.test(n)), JSON.stringify(out.notes));
  for (const id of Object.keys(ids)) assert.equal(out.pack.find((x) => x.id === id)?.status, 'present', `${id} not read from CLAUDE_CONFIG_DIR`);
  if (binName) assert.ok(out.pack.find((x) => x.id === lsp.id).missingBins.some((m) => m.bin === binName), `${binName} in cwd counted as installed`);
});

test('#20/G3-14b: under WSL (platform linux + WSL_DISTRO_NAME) the inventory says Windows-side configs were not read', async (t) => {
  const fx = fakeHome(t);
  const out = await inventoryRun([], { home: fx.home, cwd: fx.cwd, platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu' }, findBin: () => ({ found: true }), runClaude: async () => ({ ok: true, stdout: '[]' }) });
  assert.ok(!out.error, JSON.stringify(out.notes));
  assert.ok(out.notes.some((n) => /WSL detected/.test(n)), JSON.stringify(out.notes));
});

// ------------------------------------------------------------------ (3) Windows equivalents of POSIX-only security tests
test('O2-3 (all OSes; win32 = taskkill /T): a timed-out child is killed with its whole process tree', async (t) => {
  const fx = fakeHome(t);
  const pidFile = nodePath.join(fx.root, 'grandchild.pid');
  const grand = nodePath.join(fx.root, 'grand.cjs');
  const script = nodePath.join(fx.root, 'hang.cjs');
  writeFileSync(grand, `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`);
  writeFileSync(script, `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`);
  const r = await runCommand(process.execPath, [script], 2500, { killTree: true });
  assert.equal(r.code, 'ETIMEDOUT');
  assert.ok(existsSync(pidFile), 'the grandchild never started');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) { try { process.kill(pid, 0); await new Promise((s) => setTimeout(s, 50)); } catch { alive = false; } }
  if (alive) try { process.kill(pid, 'SIGKILL'); } catch {}
  assert.equal(alive, false, 'the grandchild survived the timeout');
});

test('O2-8 (all OSes; win32 = directory junction, no admin needed): a linked docs/ folder is not followed', async (t) => {
  const fx = fakeHome(t);
  const npmRoot = nodePath.join(fx.root, 'npmroot');
  const dir = nodePath.join(npmRoot, 'demo-mcp');
  write(nodePath.join(dir, 'package.json'), { name: 'demo-mcp', version: '1.2.3', bin: { 'demo-mcp': 'cli.js' } });
  write(nodePath.join(dir, 'README.md'), 'Set DEMO_LEVEL to debug.\n');
  write(nodePath.join(dir, 'cli.js'), '');
  const outside = nodePath.join(fx.root, 'outside');
  write(nodePath.join(outside, 'x.md'), 'DEMO_OUTSIDE private');
  symlinkSync(outside, nodePath.join(dir, 'docs'), 'junction'); // 'junction' is ignored off Windows (a dir symlink)
  const pack = { items: [{ id: 'demo', kind: 'mcp', steps: ['x'], windows: ['x'], detect: { mcpName: ['demo'] }, options: { package: 'demo-mcp', bin: 'demo-mcp', envPrefix: 'DEMO_' } }] };
  const runStub = async (cmd, args) => (cmd === 'npm' && args[0] === 'root' ? { ok: true, stdout: npmRoot + '\n' } : { ok: false, code: 1, error: 'not stubbed' });
  const out = await optionsRun(['--item', 'demo'], {
    home: fx.home, cwd: fx.cwd, env: { CLAUDE_CONFIG_DIR: nodePath.join(fx.home, '.claude') }, platform: process.platform === 'win32' ? 'win32' : 'linux',
    pack, findBin: () => ({ found: false }), run: runStub, runClaude: async () => ({ ok: false, code: 1, error: 'not stubbed' }),
  });
  const demo = out.items.find((i) => i.id === 'demo');
  assert.ok(demo, JSON.stringify(out));
  assert.ok(demo.options.some((o) => o.name === 'DEMO_LEVEL'), 'README was read');
  assert.ok(!JSON.stringify(out).includes('DEMO_OUTSIDE'), 'followed the linked docs/');
});

test('O2-1 (all OSes, host path rules): a copy inside the project is untrusted even from a user config, with cwd in another path form', (t) => {
  const fx = fakeHome(t);
  const inside = nodePath.join(fx.cwd, 'vendor', 'demo-mcp');
  write(nodePath.join(inside, 'package.json'), { name: 'demo-mcp', version: '5.0.0', bin: { 'demo-mcp': 'cli.js' } });
  write(nodePath.join(inside, 'cli.js'), '');
  write(nodePath.join(fx.cwd, 'package.json'), '{}'); // project marker
  const cwd = win ? otherForm(fx.cwd).replace(/\/$/, '').replace(/\//g, '\\') : fx.cwd;
  const loc = locatePackage('demo-mcp', { home: fx.home, cwd, env: {}, platform: process.platform, configPaths: [{ path: nodePath.join(inside, 'cli.js'), trusted: true, where: 'Claude Code user' }] });
  assert.equal(loc.chosen, null, 'a copy inside the project was trusted');
  assert.equal(loc.candidates[0]?.trusted, false);
});

// ------------------------------------------------------------------ (4) live smoke: launch each server as registered
/** spawn argv exactly as Claude Code does (no shell) and complete an MCP initialize; resolves serverInfo */
function mcpInitialize(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { reject(e); return; }
    let buf = ''; let err = ''; let done = false;
    const end = (fn, v) => {
      if (done) return; done = true; clearTimeout(timer);
      if (win && child.pid) spawnSync(nodePath.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
      else try { child.kill('SIGKILL'); } catch {}
      fn(v);
    };
    const timer = setTimeout(() => end(reject, new Error(`no initialize result in ${timeoutMs / 1000} s; stderr: ${err.slice(-800)}`)), timeoutMs);
    child.on('error', (e) => end(reject, e));
    child.on('exit', (code) => setTimeout(() => end(reject, new Error(`exited ${code} before answering; stderr: ${err.slice(-800)}`)), 200));
    child.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        try { const m = JSON.parse(line); if (m.id === 1) return m.result?.serverInfo ? end(resolve, m.result.serverInfo) : end(reject, new Error(JSON.stringify(m).slice(0, 400))); } catch {}
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'kktest-dev-ci', version: '0' } } }) + '\n');
  });
}

const smoke = process.env.KK_MCP_SMOKE === '1';
const only = String(process.env.KK_MCP_SMOKE_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SMOKE_ITEMS = MCP_ITEMS.filter((it) => !only.length || only.includes(it.id))
  .filter((it) => (win ? it.windows : it.steps).some((s) => parseMcpAdd(s)?.scope === 'user'));

test('#20 smoke: on win32 a bare npx cannot be spawned without a shell (why the steps say cmd /c)', { skip: (!win || !smoke) && 'win32 + KK_MCP_SMOKE=1 only' }, () => {
  const r = spawnSync('npx', ['--version'], { shell: false, windowsHide: true });
  assert.ok(r.error, 'npx (a .cmd shim) spawned without cmd /c; the cmd /c variants may be unnecessary');
  const c = spawnSync('cmd', ['/c', 'npx', '--version'], { shell: false, windowsHide: true, encoding: 'utf8' });
  assert.equal(c.status, 0, c.stderr);
});

for (const it of SMOKE_ITEMS) {
  test(`#20 smoke: ${it.id} starts from its ${win ? 'windows' : 'POSIX'} step and answers MCP initialize`, { skip: !smoke && 'set KK_MCP_SMOKE=1 (network)', timeout: 600000 }, async () => {
    const steps = win ? it.windows : it.steps;
    for (const s of steps) {
      const add = parseMcpAdd(s);
      if (!add) {
        // setup steps (npm i -g ...) are run as written, through the platform shell, like a person pasting them
        const r = spawnSync(s, { shell: true, encoding: 'utf8', windowsHide: true, timeout: 300000 });
        assert.equal(r.status, 0, `${it.id}: "${s}" failed: ${r.stderr}`);
        continue;
      }
      if (add.scope !== 'user') continue;
      const info = await mcpInitialize(add.command, add.args, 240000);
      assert.equal(typeof info.name, 'string', `${it.id}: serverInfo ${JSON.stringify(info)}`);
    }
  });
}
