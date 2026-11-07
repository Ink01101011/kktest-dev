// Tests for hosts.mjs and the shared helpers in common.mjs. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// Every fixture is a fake HOME under os.tmpdir(); the real config files are never read.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { test } from 'node:test';
import { detectProviders, hostDefinitions, readHosts, valueState } from './hosts.mjs';
import { isEnvRef, readJsonText, stripJsonc } from './common.mjs';
import { isEnvRef as inventoryIsEnvRef } from './inventory.mjs';

function fixture(t) {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'kkhosts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = nodePath.join(root, 'home'); const cwd = nodePath.join(root, 'proj');
  for (const d of [home, cwd]) mkdirSync(d, { recursive: true });
  const write = (p, v) => { mkdirSync(nodePath.dirname(p), { recursive: true }); writeFileSync(p, typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)); };
  return { root, home, cwd, write };
}
const host = (r, id) => r.hosts.find((h) => h.id === id);

test('valueState never needs the value: literal / ref / empty', () => {
  assert.equal(valueState('abc'), 'literal');
  assert.equal(valueState('${TOKEN}'), 'ref');
  assert.equal(valueState('%TOKEN%'), 'ref');
  assert.equal(valueState(''), 'empty');
  assert.equal(valueState('pre-${X}'), 'literal');
  assert.equal(valueState('token'), 'literal'); // an auth word alone is not a reference
});

test('O1-6/O3-M2/O2-12/C2: ${env:X}, ${input:x}, Bearer ${X} are references (one isEnvRef for every script)', () => {
  for (const v of ['${env:MY_KEY}', '${input:api-key}', 'Bearer ${TOKEN}', 'Basic ${env:CRED}', '  ${X}  ']) assert.equal(valueState(v), 'ref', v);
  assert.equal(valueState('Bearer abc'), 'literal');
  assert.equal(inventoryIsEnvRef, isEnvRef, 'inventory.mjs must re-export the shared isEnvRef, not keep a copy');
});

test('host config paths follow the platform; a relative XDG_CONFIG_HOME is ignored', () => {
  const mac = hostDefinitions({ home: '/Users/a', cwd: '/w', env: {}, platform: 'darwin' });
  assert.equal(mac.find((h) => h.id === 'claude-desktop').files[0].file, '/Users/a/Library/Application Support/Claude/claude_desktop_config.json');
  const win = hostDefinitions({ home: 'C:\\Users\\a', cwd: 'C:\\w', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32' });
  assert.equal(win.find((h) => h.id === 'vscode').files[0].file, 'C:\\Users\\a\\AppData\\Roaming\\Code\\User\\mcp.json');
  const lin = hostDefinitions({ home: '/home/a', cwd: '/w', env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux' });
  assert.equal(lin.find((h) => h.id === 'claude-desktop').files[0].file, '/x/Claude/claude_desktop_config.json');
  assert.equal(lin.find((h) => h.id === 'vscode').files[0].key, 'servers');
  const rel = hostDefinitions({ home: '/home/a', cwd: '/w', env: { XDG_CONFIG_HOME: 'rel/cfg' }, platform: 'linux' });
  assert.equal(rel.find((h) => h.id === 'claude-desktop').files[0].file, '/home/a/.config/Claude/claude_desktop_config.json');
});

test('O1-5/O3-M1: ~/.claude.json follows CLAUDE_CONFIG_DIR, like inventory.mjs', (t) => {
  const fx = fixture(t);
  const cfg = nodePath.join(fx.home, 'cc');
  fx.write(nodePath.join(cfg, '.claude.json'), { mcpServers: { inCfgDir: { command: 'x' } } });
  fx.write(nodePath.join(fx.home, '.claude.json'), { mcpServers: { inHome: { command: 'x' } } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: { CLAUDE_CONFIG_DIR: cfg }, platform: 'linux' });
  assert.deepEqual(host(r, 'claude-code').servers.map((s) => s.name), ['inCfgDir']);
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.deepEqual(host(r2, 'claude-code').servers.map((s) => s.name), ['inHome']);
});

test('readHosts reports env names and states for every host, never the values', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.config', 'Claude', 'claude_desktop_config.json'), { mcpServers: { demo: { command: 'demo-mcp', env: { DEMO_TOKEN: 'CANAOPT3', DEMO_HOST: '${HOST}' } } } });
  fx.write(nodePath.join(fx.home, '.config', 'Code', 'User', 'mcp.json'), '\uFEFF' + JSON.stringify({ servers: { demo: { command: 'npx', args: ['demo-mcp'], env: { DEMO_LEVEL: 'debug' } } } }));
  fx.write(nodePath.join(fx.home, '.cursor', 'mcp.json'), '{ not json');
  fx.write(nodePath.join(fx.home, '.claude', 'settings.json'), { env: { DEMO_SECRET: 'CANAOPT4' } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  const txt = JSON.stringify(r);
  assert.ok(!/CANAOPT[34]/.test(txt), 'a value leaked');
  assert.deepEqual(host(r, 'claude-desktop').servers[0].env, [{ name: 'DEMO_TOKEN', state: 'literal' }, { name: 'DEMO_HOST', state: 'ref' }]);
  assert.equal(host(r, 'vscode').servers[0].env[0].name, 'DEMO_LEVEL'); // BOM + 'servers' key
  assert.ok(r.notes.some((n) => /cursor|\.cursor/i.test(n))); // bad JSON is a note, not a crash
  assert.equal(host(r, 'claude-code').settingsEnv[0].name, 'DEMO_SECRET');
});

test('O1-7/O3-m8: VS Code and Cursor files may be JSONC; Claude Desktop stays strict JSON', (t) => {
  const fx = fixture(t);
  const jsonc = '// my servers\n{\n  "servers": {\n    /* main */ "demo": { "command": "npx", "args": ["demo-mcp", "http://x//y"], "env": { "DEMO_A": "${env:A}", }, },\n  },\n}\n';
  fx.write(nodePath.join(fx.home, '.config', 'Code', 'User', 'mcp.json'), jsonc);
  fx.write(nodePath.join(fx.home, '.cursor', 'mcp.json'), jsonc.replace('"servers"', '"mcpServers"'));
  fx.write(nodePath.join(fx.home, '.config', 'Claude', 'claude_desktop_config.json'), jsonc.replace('"servers"', '"mcpServers"'));
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.deepEqual(host(r, 'vscode').servers[0].env, [{ name: 'DEMO_A', state: 'ref' }]);
  assert.deepEqual(host(r, 'vscode').servers[0].args, ['demo-mcp', 'http://x//y']); // "//" inside a string is not a comment
  assert.equal(host(r, 'cursor').servers.length, 1);
  assert.equal(host(r, 'claude-desktop').servers.length, 0);
  assert.ok(r.notes.some((n) => /Claude Desktop/.test(n)));
  assert.equal(stripJsonc('{"a":"/*x*/","b":[1,2,],}'), '{"a":"/*x*/","b":[1,2]}');
});

test('O3-m8: UTF-16 LE and BE config files (PowerShell Out-File) are read', (t) => {
  const fx = fixture(t);
  const json = JSON.stringify({ mcpServers: { u16: { command: 'x', env: { K: 'v' } } } });
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]);
  const be = Buffer.from(json, 'utf16le'); for (let i = 0; i < be.length; i += 2) { const x = be[i]; be[i] = be[i + 1]; be[i + 1] = x; }
  fx.write(nodePath.join(fx.home, '.cursor', 'mcp.json'), le);
  fx.write(nodePath.join(fx.home, '.codeium', 'windsurf', 'mcp_config.json'), Buffer.concat([Buffer.from([0xfe, 0xff]), be]));
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.equal(host(r, 'cursor').servers[0].name, 'u16');
  assert.equal(host(r, 'windsurf').servers[0].name, 'u16');
  assert.deepEqual(readJsonText(le), JSON.parse(json));
});

test('C4(d): hosts[].files also lists the expected files that do not exist yet (a write target)', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.cursor', 'mcp.json'), { mcpServers: {} });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  const cur = host(r, 'cursor');
  assert.deepEqual(cur.files.map((f) => [nodePath.relative(fx.root, f.file), f.exists]), [[nodePath.join('home', '.cursor', 'mcp.json'), true], [nodePath.join('proj', '.cursor', 'mcp.json'), false]]);
  assert.equal(cur.present, true);
  const vs = host(r, 'vscode');
  assert.ok(vs.files.length === 2 && vs.files.every((f) => f.exists === false));
  assert.equal(vs.present, false);
});

test('O3-n2: the projects[cwd] key matches case-sensitively on Linux, case-insensitively on win32', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.claude.json'), { projects: { [fx.cwd]: { mcpServers: { exact: { command: 'x' } } }, [fx.cwd.toUpperCase()]: { mcpServers: { upper: { command: 'x' } } }, [fx.cwd + '/']: { mcpServers: { slash: { command: 'x' } } } } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.deepEqual(host(r, 'claude-code').servers.map((s) => s.name).sort(), ['exact', 'slash']);
});

test('O3-m10: WSL is detected and noted; notes carry short paths (O6-M13)', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.cursor', 'mcp.json'), '{ broken');
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: { WSL_DISTRO_NAME: 'Ubuntu' }, platform: 'linux', short: (p) => p.replace(fx.home, '~') });
  assert.ok(r.notes.some((n) => /WSL detected/.test(n)));
  assert.ok(r.notes.some((n) => n.includes('~/.cursor/mcp.json')) && !r.notes.some((n) => n.includes(fx.home)));
});

test('readHosts reads a project file that is the user file only once (cwd = home)', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.claude', 'settings.json'), { env: { DEMO_A: '1' } });
  const r = readHosts({ home: fx.home, cwd: fx.home, env: { CLAUDE_CONFIG_DIR: nodePath.join(fx.home, '.claude') }, platform: 'linux' });
  assert.equal(host(r, 'claude-code').settingsEnv.length, 1);
});

test('detectProviders: env names from the shell and settings, local binaries; no values', () => {
  const hosts = [{ id: 'claude-code', settingsEnv: [{ name: 'CLAUDE_CODE_USE_BEDROCK', scope: 'user', state: 'literal' }] }];
  const p = detectProviders({ env: { OPENAI_API_KEY: 'CANAOPT5' }, hosts, findBin: (b) => ({ found: b === 'ollama' }) });
  const by = Object.fromEntries(p.map((x) => [x.id, x.signals]));
  assert.ok(by.openai[0].includes('OPENAI_API_KEY'));
  assert.ok(by.bedrock[0].includes('user settings'));
  assert.ok(by.ollama[0].includes('binary ollama'));
  assert.ok(!JSON.stringify(p).includes('CANAOPT5'));
});
