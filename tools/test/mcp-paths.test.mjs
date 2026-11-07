import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer, serverRuntimeDirs, loadCatalog } from '../lib/catalog.mjs';
import { codexTableState, codexToml, hasJsonComments, jsonEntry, jsonSnippet } from '../lib/mcp.mjs';
import { targetPaths } from '../lib/paths.mjs';
import { ROOT } from './helpers.mjs';

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
  assert.throws(() => targetPaths('claude-desktop', { platform: 'win32', env: { USERPROFILE: 'C:\\u' } }), /APPDATA/);
  assert.throws(() => targetPaths('codex', { platform: 'linux', env: {} }), /HOME/);
});
