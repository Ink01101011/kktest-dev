// node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { test } from 'node:test';
import { detectProviders, hostDefinitions, readHosts, valueState } from './hosts.mjs';
import { compareVersions, derivePrefix, diffItem, envMentions, helpFlags, run, sanitizePluginConfig, stateFile } from './options.mjs';

function fixture(t) {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'kkopt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = nodePath.join(root, 'home'); const cwd = nodePath.join(root, 'proj'); const npmRoot = nodePath.join(root, 'npmroot');
  for (const d of [home, cwd, npmRoot]) mkdirSync(d, { recursive: true });
  const write = (p, v) => { mkdirSync(nodePath.dirname(p), { recursive: true }); writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };
  return { root, home, cwd, npmRoot, write };
}

const PACK = {
  items: [
    { id: 'demo', kind: 'mcp', steps: ['x'], detect: { mcpName: ['demo'] }, options: { package: 'demo-mcp', bin: 'demo-mcp', envPrefix: 'DEMO_' } },
    { id: 'plug', kind: 'plugin', plugin: 'plug@m', detect: { plugins: ['plug@'] } },
    { id: 'off', kind: 'plugin', plugin: 'off@m', detect: { plugins: ['off@'] } },
  ],
};

function installDemo(fx, { readme, version = '1.2.3', bin = 'cli.js' } = {}) {
  const dir = nodePath.join(fx.npmRoot, 'demo-mcp');
  fx.write(nodePath.join(dir, 'package.json'), { name: 'demo-mcp', version, bin: { 'demo-mcp': bin } });
  fx.write(nodePath.join(dir, 'README.md'), readme ?? '| `DEMO_LEVEL` | log level: info or debug |\nSet DEMO_TOKEN to your token. Example: DEMO_TOKEN=CANAOPT1\n');
  fx.write(nodePath.join(dir, 'cli.js'), '');
  return dir;
}

function stubs(fx, calls = []) {
  const run = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'npm' && args[0] === 'root') return { ok: true, stdout: fx.npmRoot + '\n' };
    if (cmd === process.execPath && args[1] === '--help') return { ok: true, stdout: 'usage: demo-mcp [options]\n  --port PORT   listen port\n  -v, --verbose  more logs\nEnv: DEMO_HOST sets the host\n' };
    return { ok: false, code: 1, error: 'not stubbed' };
  };
  const runClaude = async (args) => {
    calls.push(['claude', ...args].join(' '));
    if (args[0] === 'plugin' && args[1] === 'list') return { ok: true, stdout: JSON.stringify([{ id: 'plug@m', enabled: true }, { id: 'off@m', enabled: false }]) };
    if (args[0] === 'plugin' && args[1] === 'configure') return { ok: true, stdout: JSON.stringify({ pluginId: 'plug@m', schema: { API_KEY: { type: 'string', description: 'key', sensitive: true, default: 'CANAOPT2' }, REGION: { type: 'string', description: 'region', default: 'eu' } }, choices: {}, configured: ['REGION'], unconfigured: ['API_KEY'] }) };
    return { ok: false, code: 1, error: 'not stubbed' };
  };
  return { run, runClaude };
}

const opt = (fx, extra = {}) => ({ home: fx.home, cwd: fx.cwd, env: { CLAUDE_CONFIG_DIR: nodePath.join(fx.home, '.claude') }, platform: 'linux', pack: PACK, findBin: () => ({ found: false }), ...stubs(fx), ...extra });

test('valueState never needs the value: literal / ref / empty', () => {
  assert.equal(valueState('abc'), 'literal');
  assert.equal(valueState('${TOKEN}'), 'ref');
  assert.equal(valueState('%TOKEN%'), 'ref');
  assert.equal(valueState(''), 'empty');
  assert.equal(valueState('pre-${X}'), 'literal');
});

test('host config paths follow the platform', () => {
  const mac = hostDefinitions({ home: '/Users/a', cwd: '/w', env: {}, platform: 'darwin' });
  assert.equal(mac.find((h) => h.id === 'claude-desktop').files[0].file, '/Users/a/Library/Application Support/Claude/claude_desktop_config.json');
  const win = hostDefinitions({ home: 'C:\\Users\\a', cwd: 'C:\\w', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, platform: 'win32' });
  assert.equal(win.find((h) => h.id === 'vscode').files[0].file, 'C:\\Users\\a\\AppData\\Roaming\\Code\\User\\mcp.json');
  const lin = hostDefinitions({ home: '/home/a', cwd: '/w', env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux' });
  assert.equal(lin.find((h) => h.id === 'claude-desktop').files[0].file, '/x/Claude/claude_desktop_config.json');
  assert.equal(lin.find((h) => h.id === 'vscode').files[0].key, 'servers');
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
  const desk = r.hosts.find((h) => h.id === 'claude-desktop');
  assert.deepEqual(desk.servers[0].env, [{ name: 'DEMO_TOKEN', state: 'literal' }, { name: 'DEMO_HOST', state: 'ref' }]);
  assert.equal(r.hosts.find((h) => h.id === 'vscode').servers[0].env[0].name, 'DEMO_LEVEL'); // BOM + 'servers' key
  assert.ok(r.notes.some((n) => /cursor|\.cursor/i.test(n))); // bad JSON is a note, not a crash
  assert.equal(r.hosts.find((h) => h.id === 'claude-code').settingsEnv[0].name, 'DEMO_SECRET');
});

test('readHosts reads a project file that is the user file only once (cwd = home)', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.claude', 'settings.json'), { env: { DEMO_A: '1' } });
  const r = readHosts({ home: fx.home, cwd: fx.home, env: { CLAUDE_CONFIG_DIR: nodePath.join(fx.home, '.claude') }, platform: 'linux' });
  assert.equal(r.hosts.find((h) => h.id === 'claude-code').settingsEnv.length, 1);
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

test('envMentions keeps prefixed names with short, redacted context', () => {
  const m = envMentions('Use FOO_LEVEL=debug.\nFOO_TOKEN=sk-abcdefghijklmnop is required\nBAR_X ignored\nNOT_FOO_LEVEL here', 'FOO_');
  assert.deepEqual([...m.keys()].sort(), ['FOO_LEVEL', 'FOO_TOKEN']);
  assert.ok(!m.get('FOO_TOKEN')[0].includes('abcdefghijklmnop'));
});

test('helpFlags, derivePrefix and compareVersions', () => {
  assert.deepEqual(helpFlags('  -p, --port PORT  listen\n  --verbose  more\nnot a flag\n  --port again').map((f) => f.flag), ['--port', '--verbose']);
  assert.equal(derivePrefix('@playwright/mcp'), 'MCP_');
  assert.equal(derivePrefix('chrome-devtools-mcp'), 'CHROME_DEVTOOLS_MCP_');
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3-beta'), 0);
});

test('diffItem reports added, removed, changed options and flags', () => {
  const d = diffItem({ version: '1.0.0', options: [{ name: 'A', hash: '1' }, { name: 'B', hash: '2' }], flags: ['--x'] },
    { version: '1.1.0', options: [{ name: 'A', hash: '9' }, { name: 'C', hash: '3' }], flags: ['--x', '--y'] });
  assert.deepEqual([d.added, d.removed, d.changed, d.flagsAdded, d.flagsRemoved], [['C'], ['B'], ['A'], ['--y'], []]);
  assert.equal(diffItem(undefined, { options: [] }).firstSeen, true);
});

test('sanitizePluginConfig: names, descriptions, set state; never a sensitive default', () => {
  const s = sanitizePluginConfig({ schema: { API_KEY: { description: 'k', sensitive: true, default: 'CANAOPT6' }, REGION: { default: 'eu' } }, configured: ['REGION'] });
  assert.ok(!JSON.stringify(s).includes('CANAOPT6'));
  assert.deepEqual(s.options.map((o) => [o.name, o.sensitive, o.isSet]), [['API_KEY', true, false], ['REGION', false, true]]);
  assert.deepEqual(sanitizePluginConfig({ schema: {} }), { none: true });
});

test('run: options come from the installed version (README + --help), plugin schema, current env state', async (t) => {
  const fx = fixture(t);
  installDemo(fx);
  fx.write(nodePath.join(fx.home, '.claude', 'settings.json'), { env: { DEMO_OLD: 'CANAOPT7' } });
  const out = await run(['--item', 'demo', '--item', 'plug', '--item', 'off'], opt(fx));
  const demo = out.items.find((i) => i.id === 'demo');
  assert.equal(demo.version, '1.2.3');
  assert.deepEqual(demo.options.map((o) => o.name).sort(), ['DEMO_HOST', 'DEMO_LEVEL', 'DEMO_TOKEN']);
  assert.equal(demo.options.find((o) => o.name === 'DEMO_TOKEN').secretLike, true);
  assert.deepEqual(demo.flags.map((f) => f.flag), ['--port', '--verbose']);
  assert.deepEqual(demo.setButUndocumented, ['DEMO_OLD']);
  const plug = out.items.find((i) => i.id === 'plug');
  assert.deepEqual(plug.pluginConfig.options.map((o) => o.name), ['API_KEY', 'REGION']);
  assert.match(out.items.find((i) => i.id === 'off').notes[0], /disabled/);
  const txt = JSON.stringify(out);
  for (const c of ['CANAOPT1', 'CANAOPT2', 'CANAOPT7']) assert.ok(!txt.includes(c), `${c} leaked`);
});

test('run: compact by default, no registry call without --network', async (t) => {
  const fx = fixture(t);
  const calls = [];
  const out = await run([], opt(fx, stubs(fx, calls)));
  assert.match(out.mode, /^compact/);
  assert.ok(!calls.some((c) => /npm view/.test(c)));
  assert.match(out.items.find((i) => i.id === 'demo').notes.join(' '), /--network/);
  const calls2 = [];
  await run(['--network', '--item', 'demo'], opt(fx, stubs(fx, calls2)));
  assert.ok(calls2.some((c) => /npm view demo-mcp@latest/.test(c)));
});

test('run: a package bin pointing outside the package is not executed', async (t) => {
  const fx = fixture(t);
  installDemo(fx, { bin: '../../evil.js' });
  const calls = [];
  await run(['--item', 'demo'], opt(fx, stubs(fx, calls)));
  assert.ok(!calls.some((c) => c.startsWith(process.execPath)));
});

test('run: --record then --diff after an upgrade reports only what changed', async (t) => {
  const fx = fixture(t);
  installDemo(fx);
  const rec = await run(['--item', 'demo', '--record'], opt(fx));
  const file = stateFile({ home: fx.home, env: { CLAUDE_CONFIG_DIR: nodePath.join(fx.home, '.claude') } });
  assert.ok(existsSync(file) && rec.recorded.items.includes('demo'));
  assert.ok(!readFileSync(file, 'utf8').includes('CANAOPT1'));
  installDemo(fx, { version: '1.3.0', readme: '| `DEMO_LEVEL` | log level: info, debug or trace |\n`DEMO_CACHE` enables a cache\n' });
  const out = await run(['--item', 'demo', '--diff'], opt(fx));
  const d = out.diff.find((x) => x.id === 'demo');
  assert.deepEqual([d.versionBefore, d.versionNow], ['1.2.3', '1.3.0']);
  assert.deepEqual(d.added, ['DEMO_CACHE']);
  assert.deepEqual(d.removed, ['DEMO_TOKEN']);
  assert.deepEqual(d.changed, ['DEMO_LEVEL']);
});

test('run never throws: a broken pack becomes a note', async (t) => {
  const fx = fixture(t);
  const out = await run([], opt(fx, { pack: { get items() { throw new Error('boom'); } } }));
  assert.equal(out.error, true);
  assert.ok(out.notes.length);
});
