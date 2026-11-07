import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { RefusedError, UsageError, normalizeServer, serverRuntimeDirs, loadCatalog } from '../lib/catalog.mjs';
import { codexTableState, codexToml, hasJsonComments, jsonEntry, jsonSnippet, tomlStr } from '../lib/mcp.mjs';
import { targetPaths } from '../lib/paths.mjs';
import { ROOT, python } from './helpers.mjs';

// Fixture covering every value kind: plugin path, env reference (a secret), plain literal.
const server = normalizeServer('demo', {
  command: 'python3',
  args: ['${CLAUDE_PLUGIN_ROOT}/server/main.py', '--verbose'],
  env: { API_TOKEN: '${API_TOKEN}', DATA_PATH: '${CLAUDE_PLUGIN_ROOT}/scripts/ctl.py', MODE: 'fast' },
});
const pathFor = (rel) => `/opt/kk/demo/${rel}`;

test('server model tags paths, references and literals', () => {
  assert.deepEqual(server.env.API_TOKEN, { kind: 'ref', name: 'API_TOKEN' });
  assert.deepEqual(server.env.DATA_PATH, { kind: 'path', rel: 'scripts/ctl.py' });
  assert.deepEqual(server.args[1], { kind: 'literal', value: '--verbose' });
  assert.deepEqual(serverRuntimeDirs(server), ['scripts', 'server']);
  assert.throws(() => normalizeServer('x', { command: 'a', env: { K: 'pre-${X}' } }), /mixed interpolation/);
  assert.throws(() => normalizeServer('x', { url: 'https://x' }), /only stdio/);
});

const GOLDEN = {
  cursor: {
    command: 'python3',
    args: ['/opt/kk/demo/server/main.py', '--verbose'],
    env: { API_TOKEN: '${env:API_TOKEN}', DATA_PATH: '/opt/kk/demo/scripts/ctl.py', MODE: 'fast' },
  },
  vscode: {
    type: 'stdio',
    command: 'python3',
    args: ['/opt/kk/demo/server/main.py', '--verbose'],
    env: { API_TOKEN: '${env:API_TOKEN}', DATA_PATH: '/opt/kk/demo/scripts/ctl.py', MODE: 'fast' },
  },
  gemini: {
    command: 'python3',
    args: ['/opt/kk/demo/server/main.py', '--verbose'],
    env: { API_TOKEN: '${API_TOKEN}', DATA_PATH: '/opt/kk/demo/scripts/ctl.py', MODE: 'fast' },
  },
  'claude-desktop': {
    command: 'python3',
    args: ['/opt/kk/demo/server/main.py', '--verbose'],
    env: { API_TOKEN: '<set API_TOKEN here>', DATA_PATH: '/opt/kk/demo/scripts/ctl.py', MODE: 'fast' },
  },
  windsurf: {
    command: 'python3',
    args: ['/opt/kk/demo/server/main.py', '--verbose'],
    env: { API_TOKEN: '<set API_TOKEN here>', DATA_PATH: '/opt/kk/demo/scripts/ctl.py', MODE: 'fast' },
  },
};

for (const [target, golden] of Object.entries(GOLDEN)) {
  test(`golden: ${target} JSON entry`, () => {
    const { entry, notes } = jsonEntry(target, server, pathFor);
    assert.deepEqual(entry, golden);
    if (target === 'claude-desktop' || target === 'windsurf') assert.match(notes.join('\n'), /API_TOKEN/);
    else assert.deepEqual(notes, []);
  });
}

test('golden: snippet top-level keys (vscode uses "servers")', () => {
  assert.deepEqual(Object.keys(JSON.parse(jsonSnippet('vscode', [server], pathFor).text)), ['servers']);
  for (const t of ['cursor', 'gemini', 'claude-desktop', 'windsurf']) assert.deepEqual(Object.keys(JSON.parse(jsonSnippet(t, [server], pathFor).text)), ['mcpServers']);
});

test('golden: codex TOML', () => {
  assert.equal(
    codexToml(server, pathFor),
    [
      '[mcp_servers.demo]',
      'command = "python3"',
      'args = ["/opt/kk/demo/server/main.py", "--verbose"]',
      'env_vars = ["API_TOKEN"]',
      '',
      '[mcp_servers.demo.env]',
      'DATA_PATH = "/opt/kk/demo/scripts/ctl.py"',
      'MODE = "fast"',
      '',
    ].join('\n'),
  );
  const win = codexToml(server, (rel) => `C:\\kk\\${rel.replace(/\//g, '\\')}`);
  assert.match(win, /args = \["C:\\\\kk\\\\server\\\\main.py"/);
});

test('no emitted config ever contains a secret value, only references or placeholders', () => {
  const secret = normalizeServer('s', { command: 'node', args: [], env: { TOKEN: '${TOKEN}' } });
  for (const t of Object.keys(GOLDEN)) {
    const v = jsonEntry(t, secret, pathFor).entry.env.TOKEN;
    assert.ok(/TOKEN/.test(v) && (v.startsWith('${') || v.startsWith('<set')), `${t}: ${v}`);
  }
  assert.match(codexToml(secret, pathFor), /env_vars = \["TOKEN"\]/);
});

test('repo MCP servers normalize (loop-ledger, memory-keeper, reflexion)', () => {
  const names = loadCatalog(ROOT).plugins.flatMap((p) => p.mcpServers.map((s) => s.name));
  assert.deepEqual(names.sort(), ['loop-ledger', 'memory-keeper', 'reflexion']);
});

test('codex table detection is conservative', () => {
  assert.equal(codexTableState('', 'demo'), 'absent');
  assert.equal(codexTableState('[mcp_servers.other]\ncommand = "x"\n', 'demo'), 'absent');
  assert.equal(codexTableState('model = "o3"\n[mcp_servers.demo]\ncommand = "x"\n', 'demo'), 'present');
  assert.equal(codexTableState('[ mcp_servers . "demo" ]\n', 'demo'), 'present');
  assert.equal(codexTableState('[mcp_servers.demo.env]\nA = "1"\n', 'demo'), 'present');
  assert.equal(codexTableState('[mcp_servers.demo-two]\n', 'demo'), 'absent');
  assert.equal(codexTableState('[mcp_servers]\ndemo = { command = "x" }\n', 'demo'), 'unsure');
  assert.equal(codexTableState('mcp_servers.demo.command = "x"\n', 'demo'), 'unsure');
  assert.equal(codexTableState('mcp_servers = { demo = { command = "x" } }\n', 'demo'), 'unsure');
});

test('JSONC comment detection ignores // inside strings', () => {
  assert.equal(hasJsonComments('{"url": "https://x.y/z"}'), false);
  assert.equal(hasJsonComments('{"a": "\\"//"}'), false);
  assert.equal(hasJsonComments('{\n  // comment\n  "a": 1\n}'), true);
  assert.equal(hasJsonComments('{ /* c */ }'), true);
});

test('paths: macOS, Linux and Windows derivation (pure, injected platform)', () => {
  const mac = { platform: 'darwin', env: { HOME: '/Users/a' } };
  assert.equal(targetPaths('claude-desktop', mac).mcpConfig, '/Users/a/Library/Application Support/Claude/claude_desktop_config.json');
  assert.equal(targetPaths('codex', mac).mcpConfig, '/Users/a/.codex/config.toml');
  assert.equal(targetPaths('cursor', mac).skillsDir, '/Users/a/.agents/skills');
  assert.equal(targetPaths('gemini', { ...mac, scope: 'project', cwd: '/w' }).mcpConfig, '/w/.gemini/settings.json');
  assert.equal(targetPaths('codex', { ...mac, scope: 'project', cwd: '/w' }).skillsDir, '/w/.agents/skills');
  assert.equal(targetPaths('codex', { ...mac, scope: 'project', cwd: '/w' }).serversDir, '/Users/a/.kktest-dev/servers');

  const linux = { platform: 'linux', env: { HOME: '/home/a' } };
  assert.equal(targetPaths('claude-desktop', linux).mcpConfig, '/home/a/.config/Claude/claude_desktop_config.json');
  assert.equal(targetPaths('windsurf', linux).mcpConfig, '/home/a/.config/devin/mcp_config.json');
  assert.ok(targetPaths('windsurf', linux).unsupported);

  const win = { platform: 'win32', env: { USERPROFILE: 'C:\\Users\\a', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } };
  assert.equal(targetPaths('claude-desktop', win).mcpConfig, 'C:\\Users\\a\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  assert.equal(targetPaths('codex', win).mcpConfig, 'C:\\Users\\a\\.codex\\config.toml');
  assert.equal(targetPaths('cursor', win).mcpConfig, 'C:\\Users\\a\\.cursor\\mcp.json');
  assert.equal(targetPaths('agents', win).skillsDir, 'C:\\Users\\a\\.agents\\skills');
  assert.equal(targetPaths('cursor', win).serversDir, 'C:\\Users\\a\\.kktest-dev\\servers');
  assert.equal(targetPaths('vscode', { ...win, scope: 'project', cwd: 'D:\\w' }).mcpConfig, 'D:\\w\\.vscode\\mcp.json');
  assert.equal(targetPaths('vscode', win).mcpConfig, null);
  // APPDATA unset: same fallback as kktestdev-pack's hosts.mjs appDataDir() (S11)
  assert.equal(targetPaths('claude-desktop', { platform: 'win32', env: { USERPROFILE: 'C:\\u' } }).mcpConfig, 'C:\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
  assert.throws(() => targetPaths('codex', { platform: 'linux', env: {} }), (e) => e instanceof UsageError && /HOME/.test(e.message));
});

test('paths: XDG_CONFIG_HOME for Claude Desktop on Linux (absolute only)', () => {
  assert.equal(targetPaths('claude-desktop', { platform: 'linux', env: { HOME: '/home/a', XDG_CONFIG_HOME: '/x/cfg' } }).mcpConfig, '/x/cfg/Claude/claude_desktop_config.json');
  assert.equal(targetPaths('claude-desktop', { platform: 'linux', env: { HOME: '/home/a', XDG_CONFIG_HOME: 'rel' } }).mcpConfig, '/home/a/.config/Claude/claude_desktop_config.json');
});

test('paths: CODEX_HOME is honoured for user scope, set and unset (G1-05, G3-X3)', () => {
  const unset = targetPaths('codex', { platform: 'darwin', env: { HOME: '/Users/a' } });
  assert.equal(unset.mcpConfig, '/Users/a/.codex/config.toml');
  assert.deepEqual(unset.notes, []);
  const set = targetPaths('codex', { platform: 'darwin', env: { HOME: '/Users/a', CODEX_HOME: '/data/codex' } });
  assert.equal(set.mcpConfig, '/data/codex/config.toml');
  assert.equal(set.configRoot, '/data/codex');
  assert.match(set.notes.join(), /CODEX_HOME/);
  assert.equal(set.skillsDir, '/Users/a/.agents/skills');
  const win = targetPaths('codex', { platform: 'win32', env: { USERPROFILE: 'C:\\u', CODEX_HOME: 'D:\\codex' } });
  assert.equal(win.mcpConfig, 'D:\\codex\\config.toml');
  assert.equal(targetPaths('codex', { platform: 'darwin', env: { HOME: '/Users/a', CODEX_HOME: '/data/codex' }, scope: 'project', cwd: '/w' }).mcpConfig, '/w/.codex/config.toml');
  assert.throws(() => targetPaths('codex', { platform: 'darwin', env: { HOME: '/Users/a', CODEX_HOME: 'rel' } }), UsageError);
});

test('TOML strings escape control characters and DEL; lone surrogates are refused (G2-08, G3-N3)', () => {
  assert.equal(tomlStr('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(tomlStr('x\x7fy\x01\tz\n'), '"x\\u007Fy\\u0001\\tz\\n"');
  assert.equal(tomlStr('Zoë Ü 🙂'), '"Zoë Ü 🙂"');
  assert.throws(() => tomlStr('x\ud800y'), RefusedError);
  const py = python();
  if (!py) return;
  const tbl = codexToml(normalizeServer('t', { command: 'node', args: ['/h/a\x7fb/\x01c', 'C:\\x\\y', 'q"\'', 'Zoë'] }), pathFor);
  const r = spawnSync(py, ['-I', '-c', 'import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.stdin.read())))'], { input: tbl, encoding: 'utf8' });
  if (r.status !== 0 && /tomllib/.test(r.stderr)) return; // Python < 3.11
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).mcp_servers.t.args, ['/h/a\x7fb/\x01c', 'C:\\x\\y', 'q"\'', 'Zoë']);
});

test('codex table detection is linear: 48 KB of blank lines in well under a second (G4-M1)', () => {
  for (const blank of ['\n', ' \n', '\r\n']) {
    const text = blank.repeat(Math.floor(48 * 1024 / blank.length)) + '[mcp_servers.demo]\n';
    const t0 = performance.now();
    assert.equal(codexTableState(text, 'demo'), 'present');
    assert.equal(codexTableState(text, 'loop-ledger'), 'absent');
    assert.ok(performance.now() - t0 < 1000, `${JSON.stringify(blank)}: ${performance.now() - t0} ms`);
  }
  assert.equal(codexTableState('\uFEFF[mcp_servers.demo]\r\ncommand = "x"\r\n', 'demo'), 'present', 'BOM + CRLF');
  assert.equal(codexTableState('[mcp_servers]\r\ndemo = {}\r\n', 'demo'), 'unsure');
});
