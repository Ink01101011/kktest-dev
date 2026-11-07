// Tests for hosts.mjs and the shared helpers in common.mjs. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// Every fixture is a fake HOME under os.tmpdir(); the real config files are never read.
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { test } from 'node:test';
import { DISCOVERY_LIMITS, HOST_IDS, TOML_SCALAR, detectProviders, hostDefinitions, managedMcpPath, parseToml, readHosts, readTomlConfig, valueState } from './hosts.mjs';
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
// fixtures are host-native paths: tests that compare or classify those paths use the host's path semantics
const OS = process.platform === 'win32' ? 'win32' : 'linux';

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

// ---------------------------------------------------------------- I2: Codex CLI and Gemini CLI
// Paths and keys: .shiftwork/reports-xp/P0-providers.md sections 2 (Codex) and 3 (Gemini).
const CODEX_TOML = `# my Codex config
model = "o3"
[projects."/somewhere/repo"]
trust_level = 'trusted'

[mcp_servers.demo]
command = "npx"   # runner
args = [
  "-y",          # comment inside an array
  'demo-mcp@latest',
]
env = { DEMO_TOKEN = "CANAI2A", DEMO_EMPTY = "", DEMO_LOOKS_REF = "\${HOME_VAR}" }
env_vars = ["DEMO_FWD", { name = "DEMO_FWD2", source = "local" }]
startup_timeout_sec = 20
enabled = true

[mcp_servers.sub]
command = "sub-mcp"

[mcp_servers.sub.env]
SUB_KEY = "CANAI2B"
'SUB_LIT' = 'x'

[mcp_servers.web]
url = "https://example.invalid/mcp"
bearer_token_env_var = "WEB_TOKEN"
http_headers = { "X-Team" = "CANAI2C" }
env_http_headers = { "X-Key" = "WEB_KEY" }
`;

test('I2: HOST_IDS and hostDefinitions both list codex and gemini (additive: the first five are unchanged)', () => {
  assert.deepEqual(HOST_IDS.slice(0, 5), ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'windsurf']);
  const defs = hostDefinitions({ home: '/h', cwd: '/w', env: {}, platform: 'linux' });
  assert.deepEqual(defs.map((h) => h.id), [...HOST_IDS]);
  const codex = defs.find((h) => h.id === 'codex');
  assert.deepEqual(codex.files.map((f) => [f.file, f.scope]), [['/h/.codex/config.toml', 'user'], ['/w/.codex/config.toml', 'project']]);
  const gem = defs.find((h) => h.id === 'gemini');
  assert.deepEqual(gem.files.map((f) => [f.file, f.scope, f.key]), [['/h/.gemini/settings.json', 'user', 'mcpServers'], ['/w/.gemini/settings.json', 'project', 'mcpServers']]);
  const win = hostDefinitions({ home: 'C:\\Users\\a', cwd: 'C:\\w', env: { CODEX_HOME: 'D:\\cx' }, platform: 'win32' }).find((h) => h.id === 'codex');
  assert.equal(win.files[0].file, 'D:\\cx\\config.toml');
});

test('I2: Codex config.toml (user + project): env literal/empty, env_vars and env_http_headers are refs, values never returned', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.codex', 'config.toml'), CODEX_TOML);
  fx.write(nodePath.join(fx.cwd, '.codex', 'config.toml'), '[mcp_servers.projsrv]\r\ncommand = "proj-mcp"\r\nenv_vars = ["PROJ_TOKEN"]\r\n');
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  const txt = JSON.stringify(r);
  for (const secret of ['CANAI2A', 'CANAI2B', 'CANAI2C', 'HOME_VAR']) assert.ok(!txt.includes(secret), `a value leaked: ${secret}`);
  const cx = host(r, 'codex');
  assert.equal(cx.present, true);
  assert.deepEqual(cx.files.map((f) => [f.scope, f.exists, f.ok]), [['user', true, true], ['project', true, true]]);
  const by = Object.fromEntries(cx.servers.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(by), ['demo', 'sub', 'web', 'projsrv']);
  assert.equal(by.demo.command, 'npx');
  assert.deepEqual(by.demo.args, ['-y', 'demo-mcp@latest']);
  assert.deepEqual(by.demo.env, [
    { name: 'DEMO_TOKEN', state: 'literal' }, { name: 'DEMO_EMPTY', state: 'empty' },
    // Codex does not expand ${VAR} (P0 section 2): the text is passed on as written, so it is a literal
    { name: 'DEMO_LOOKS_REF', state: 'literal' },
    { name: 'DEMO_FWD', state: 'ref' }, { name: 'DEMO_FWD2', state: 'ref' },
  ]);
  assert.ok(r.notes.some((n) => /DEMO_LOOKS_REF/.test(n) && /literal text/.test(n)));
  assert.deepEqual(by.sub.env, [{ name: 'SUB_KEY', state: 'literal' }, { name: 'SUB_LIT', state: 'literal' }]); // [mcp_servers.sub.env] sub-table
  assert.equal(by.web.url, 'https://example.invalid/mcp');
  assert.deepEqual(by.web.headers, [{ name: 'X-Team', state: 'literal' }, { name: 'X-Key', state: 'ref' }, { name: 'Authorization', state: 'ref' }]);
  assert.deepEqual([by.demo.scope, by.projsrv.scope], ['user', 'project']);
  assert.deepEqual(by.projsrv.env, [{ name: 'PROJ_TOKEN', state: 'ref' }]);
});

test('I2: CODEX_HOME is honoured when set and absolute; a relative one is not guessed', (t) => {
  const fx = fixture(t);
  const ch = nodePath.join(fx.root, 'codexhome');
  fx.write(nodePath.join(ch, 'config.toml'), '[mcp_servers.fromCodexHome]\ncommand = "x"\n');
  fx.write(nodePath.join(fx.home, '.codex', 'config.toml'), '[mcp_servers.fromDotCodex]\ncommand = "x"\n');
  const set = readHosts({ home: fx.home, cwd: fx.cwd, env: { CODEX_HOME: ch }, platform: OS });
  assert.deepEqual(host(set, 'codex').servers.map((s) => s.name), ['fromCodexHome']);
  assert.ok(set.notes.some((n) => /CODEX_HOME is set/.test(n)));
  const unset = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS });
  assert.deepEqual(host(unset, 'codex').servers.map((s) => s.name), ['fromDotCodex']);
  const rel = readHosts({ home: fx.home, cwd: fx.cwd, env: { CODEX_HOME: 'rel/codex' }, platform: OS });
  assert.deepEqual(host(rel, 'codex').servers, []);
  assert.deepEqual(host(rel, 'codex').files.map((f) => f.scope), ['project']);
  assert.ok(rel.notes.some((n) => /CODEX_HOME is not an absolute path/.test(n)));
});

test('I2: a config.toml the reader does not understand is reported (file ok: false + note), never thrown, never guessed', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.codex', 'config.toml'), '[mcp_servers.a]\ncommand = "x"\nwhen = 1979-05-27T07:32:00Z\n');
  fx.write(nodePath.join(fx.cwd, '.codex', 'config.toml'), '[mcp_servers.ok]\ncommand = "y"\n');
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS });
  const cx = host(r, 'codex');
  assert.deepEqual(cx.files[0], { file: nodePath.join(fx.home, '.codex', 'config.toml'), scope: 'user', exists: true, ok: false, error: 'TOML not understood (line 3)' });
  assert.deepEqual(cx.servers.map((s) => s.name), ['ok']); // nothing from the refused file, not even server "a"
  assert.ok(r.notes.some((n) => n.startsWith('Codex CLI: ') && n.endsWith('TOML not understood (line 3)')));
});

test('I2: parseToml refuses what it does not understand, with the line number', () => {
  const refused = [
    ['a = """x"""', 1], ["a = '''x'''", 1], ['a = 1979-05-27', 1], ['a = 07:32:00', 1], ['[a]\n[a]', 2], ['a = 1\na = 2', 2],
    ['a = "\\q"', 1], ['a = "\\x41"', 1], ['[[mcp_servers.x]]\ncommand = "y"', 1], ['a = { b = 1, }', 1], ['a = { b = 1,\n c = 2 }', 1],
    ['a = [1\n2]', 2], ['x = "s" junk', 1], ['a = "x"\n[a.b]', 2], ['a = 012', 1], ['a = bare', 1], ['a\n', 1], ['= 1', 1],
    ['a = "line\nbreak"', 1], ['[mcp_servers.s]\nenv = { K = "v" }\n[mcp_servers.s.env]\nL = "w"', 3], ['a = 1\r', 1],
    ['a = "\\uD800"', 1], ['x = ' + '['.repeat(40) + ']'.repeat(40), 1],
  ];
  for (const [text, line] of refused) assert.deepEqual(parseToml(text), { ok: false, error: `TOML not understood (line ${line})` }, JSON.stringify(text));
  const ok = parseToml([
    'a.b = "1"', 'a.c = [ ]',
    'n = [+1, -2.5e3, 0x1F, 0o7, 0b1, inf, -nan, true, 1_000]', 'e = "\\u00e9\\U0001F600\\t"', `"q k" = { "i.j" = 'lit\\' }`,
    '[[other]]', 'x = 1', '[[other]]', 'x = 2',
  ].join('\n'));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.value.a.b, '1');
  assert.equal(ok.value.other, undefined); // [[array of tables]] outside mcp_servers: checked, dropped
  assert.ok(ok.value.n.every((v) => v === TOML_SCALAR));
  assert.equal(ok.value.e, '\u00e9\u{1F600}\t');
  assert.equal(ok.value['q k']['i.j'], 'lit\\');
  assert.equal(parseToml('').ok, true);
});

test('I2: the TOML reader is linear: 48 KB of blank lines, spaces, comments or a long array read in under 1 s', () => {
  const texts = ['\n'.repeat(48 * 1024), ' '.repeat(48 * 1024) + '\n', '\r\n \t\n'.repeat(12 * 1024), `a = [${'"x",'.repeat(12 * 1024)}]`, `a = "${'\\\\'.repeat(24 * 1024)}"`, '#'.repeat(48 * 1024)];
  for (const text of texts) {
    const t0 = performance.now();
    const r = parseToml(text);
    const ms = performance.now() - t0;
    assert.equal(r.ok, true);
    assert.ok(ms < 1000, `${ms} ms`);
  }
  const t0 = performance.now();
  assert.equal(parseToml(' '.repeat(48 * 1024) + 'x').ok, false); // a refusal after a long run of spaces is fast too
  assert.ok(performance.now() - t0 < 1000);
});

test('I2: readTomlConfig keeps the JSON path contract: missing, size cap, read error; never throws', () => {
  assert.deepEqual(readTomlConfig('/nope', { exists: () => false }), { ok: false, missing: true });
  assert.deepEqual(readTomlConfig('/big', { exists: () => true, stat: () => ({ size: 51 * 1024 * 1024 }), readFile: () => assert.fail('read a file over the cap') }), { ok: false, error: 'over 50 MB, skipped' });
  assert.deepEqual(readTomlConfig('/x', { exists: () => true, stat: () => ({ size: 1 }), readFile: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } }), { ok: false, error: 'EACCES' });
  assert.equal(readTomlConfig('/x', { exists: () => true, stat: () => ({ size: 1 }), readFile: () => Buffer.from('\uFEFF[mcp_servers.b]\ncommand = "c"\n') }).ok, true);
});

test('I2: Gemini settings.json (user + project): ${VAR} / $VAR are refs, httpUrl is the url, values never returned', (t) => {
  const fx = fixture(t);
  fx.write(nodePath.join(fx.home, '.gemini', 'settings.json'), { theme: 'x', mcpServers: { gm: { command: 'gm-mcp', args: ['--x'], env: { GM_TOKEN: 'CANAI2D', GM_REF: '${GM_SECRET}', GM_DOLLAR: '$GM_SECRET', GM_EMPTY: '' } }, gh: { httpUrl: 'https://h.invalid/mcp', headers: { Authorization: 'Bearer CANAI2E' } } } });
  fx.write(nodePath.join(fx.cwd, '.gemini', 'settings.json'), { mcpServers: { sse: { url: 'https://s.invalid/sse' } } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.ok(!/CANAI2[DE]/.test(JSON.stringify(r)), 'a value leaked');
  const g = host(r, 'gemini');
  assert.equal(g.label, 'Gemini CLI');
  assert.deepEqual(g.servers.map((s) => [s.name, s.scope, s.url]), [['gm', 'user', null], ['gh', 'user', 'https://h.invalid/mcp'], ['sse', 'project', 'https://s.invalid/sse']]);
  assert.deepEqual(g.servers[0].env, [{ name: 'GM_TOKEN', state: 'literal' }, { name: 'GM_REF', state: 'ref' }, { name: 'GM_DOLLAR', state: 'ref' }, { name: 'GM_EMPTY', state: 'empty' }]);
  assert.deepEqual(g.servers[1].headers, [{ name: 'Authorization', state: 'literal' }]);
  // httpUrl is a Gemini key only: another host's httpUrl is not read as its url (Claude Code behaviour unchanged)
  fx.write(nodePath.join(fx.cwd, '.mcp.json'), { mcpServers: { cc: { httpUrl: 'https://x.invalid' } } });
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.equal(host(r2, 'claude-code').servers[0].url, null);
});

test('I2: Codex and Gemini are absent with no files; present via their app directory alone', (t) => {
  const fx = fixture(t);
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.equal(host(r, 'codex').present, false);
  assert.equal(host(r, 'gemini').present, false);
  assert.ok(host(r, 'codex').files.every((f) => f.exists === false));
  mkdirSync(nodePath.join(fx.home, '.codex')); mkdirSync(nodePath.join(fx.home, '.gemini'));
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.equal(host(r2, 'codex').present, true);
  assert.equal(host(r2, 'gemini').present, true);
});

// ------------------------------------------------------------------ #22 host coverage (I3)
const names = (h) => h.servers.map((s) => s.name).sort();
/** a directory link that needs no admin rights on Windows (junction); a plain symlink elsewhere */
const linkDir = (target, path) => { mkdirSync(nodePath.dirname(path), { recursive: true }); symlinkSync(target, path, 'junction'); };

test('#22: managed-mcp.json paths follow code.claude.com/docs/en/managed-mcp for each OS', () => {
  assert.equal(managedMcpPath({ platform: 'darwin', env: {} }), '/Library/Application Support/ClaudeCode/managed-mcp.json');
  assert.equal(managedMcpPath({ platform: 'linux', env: {} }), '/etc/claude-code/managed-mcp.json');
  assert.equal(managedMcpPath({ platform: 'win32', env: {} }), 'C:\\Program Files\\ClaudeCode\\managed-mcp.json');
  const cc = hostDefinitions({ home: '/home/a', cwd: '/w', env: {}, platform: 'linux' }).find((h) => h.id === 'claude-code');
  assert.ok(cc.files.some((f) => f.scope === 'managed' && f.file === '/etc/claude-code/managed-mcp.json'));
});

test('#22: managed-mcp.json servers are read under scope "managed"; a missing one is not listed as a write target', (t) => {
  const fx = fixture(t);
  const managedFile = nodePath.join(fx.root, 'sys', 'managed-mcp.json');
  const r0 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS, managedFile });
  assert.ok(!host(r0, 'claude-code').files.some((f) => f.scope === 'managed'));
  fx.write(managedFile, { mcpServers: { corp: { command: 'corp-mcp', env: { CORP_TOKEN: 'CANAI3M1' } } } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS, managedFile });
  const s = host(r, 'claude-code').servers.find((x) => x.name === 'corp');
  assert.equal(s.scope, 'managed');
  assert.deepEqual(s.env, [{ name: 'CORP_TOKEN', state: 'literal' }]);
  assert.ok(!JSON.stringify(r).includes('CANAI3M1'));
});

test('#22: VS Code Insiders, VSCodium, Flatpak and Snap builds are read when present, with their variant; absent ones are not listed', (t) => {
  const fx = fixture(t);
  const cfg = nodePath.join(fx.home, '.config');
  fx.write(nodePath.join(cfg, 'Code - Insiders', 'User', 'mcp.json'), '{ "servers": { "ins": { "command": "x", }, } }');
  fx.write(nodePath.join(cfg, 'VSCodium', 'User', 'mcp.json'), { servers: { cod: { command: 'x' } } });
  fx.write(nodePath.join(fx.home, '.var', 'app', 'com.visualstudio.code', 'config', 'Code', 'User', 'mcp.json'), { servers: { flat: { command: 'x' } } });
  fx.write(nodePath.join(fx.home, 'snap', 'codium', 'current', '.config', 'VSCodium', 'User', 'mcp.json'), { servers: { snp: { command: 'x' } } });
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  const vs = host(r, 'vscode');
  assert.deepEqual(names(vs), ['cod', 'flat', 'ins', 'snp']);
  assert.deepEqual(vs.files.filter((f) => f.variant).map((f) => f.variant).sort(), ['VS Code (Flatpak)', 'VS Code Insiders', 'VSCodium', 'VSCodium (Snap)']);
  assert.equal(vs.files.filter((f) => !f.exists).length, 2, 'only the stable user file and the project file are write targets');
  assert.equal(vs.present, true);
  // Flatpak/Snap folders are Linux-only
  const mac = hostDefinitions({ home: '/Users/a', cwd: '/w', env: {}, platform: 'darwin' }).find((h) => h.id === 'vscode');
  assert.ok(!mac.files.some((f) => /\.var|snap/.test(f.file)));
});

test('#22: VS Code profiles (User/profiles/<id>/mcp.json) are read; a linked profile folder is not followed; the count is capped', (t) => {
  const fx = fixture(t);
  const user = nodePath.join(fx.home, '.config', 'Code', 'User');
  fx.write(nodePath.join(user, 'profiles', 'a1b2', 'mcp.json'), { servers: { prof: { command: 'x', env: { P_KEY: '${input:k}' } } } });
  fx.write(nodePath.join(fx.root, 'elsewhere', 'mcp.json'), { servers: { linked: { command: 'x' } } });
  linkDir(nodePath.join(fx.root, 'elsewhere'), nodePath.join(user, 'profiles', 'zz-link'));
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  const vs = host(r, 'vscode');
  assert.deepEqual(names(vs), ['prof']);
  assert.deepEqual(vs.servers[0].env, [{ name: 'P_KEY', state: 'ref' }]);
  assert.equal(vs.files.find((f) => f.exists).variant, 'VS Code profile');
  for (let i = 0; i <= DISCOVERY_LIMITS.profiles; i++) mkdirSync(nodePath.join(user, 'profiles', `p${String(i).padStart(3, '0')}`), { recursive: true });
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux' });
  assert.ok(r2.notes.some((n) => /more than 50 VS Code profiles/.test(n)));
});

/** in-memory file system with win32 paths (MSIX layout cannot be built with real paths off Windows) */
function memFs(files, dirs) {
  const norm = (p) => String(p).toLowerCase();
  const F = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const D = new Set(dirs.map(norm));
  const st = (p) => {
    const k = norm(p);
    if (F.has(k)) return { size: Buffer.byteLength(F.get(k)), isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
    if (D.has(k)) return { size: 0, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  return {
    exists: (p) => F.has(norm(p)) || D.has(norm(p)), stat: st, lstat: st,
    readFile: (p) => { const k = norm(p); if (!F.has(k)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return F.get(k); },
    readdir: (d) => {
      const pre = norm(d) + '\\';
      const out = new Set();
      for (const k of [...F.keys(), ...D]) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('\\')[0]);
      if (!out.size && !D.has(norm(d))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return [...out];
    },
  };
}

test('#22: Claude Desktop from the Microsoft Store (MSIX) is read from %LOCALAPPDATA%\\Packages\\Claude_*', () => {
  const pkg = 'C:\\Users\\a\\AppData\\Local\\Packages';
  const file = `${pkg}\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json`;
  const fs = memFs({ [file]: JSON.stringify({ mcpServers: { store: { command: 'x', env: { S_TOKEN: 'CANAI3M2' } } } }) },
    [pkg, `${pkg}\\Claude_pzs8sxrjxfjjc`, `${pkg}\\Microsoft.Other_123`]);
  const r = readHosts({ home: 'C:\\Users\\a', cwd: 'C:\\w', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, platform: 'win32', fs });
  const cd = host(r, 'claude-desktop');
  assert.deepEqual(names(cd), ['store']);
  assert.equal(cd.files.find((f) => f.exists).variant, 'Microsoft Store');
  assert.equal(cd.present, true);
  assert.ok(!JSON.stringify(r).includes('CANAI3M2'));
  // not looked for on other OSes
  assert.equal(hostDefinitions({ home: '/Users/a', cwd: '/w', env: {}, platform: 'darwin' }).find((h) => h.id === 'claude-desktop').msixPackages, undefined);
});

/** a Claude Code plugin install in a fake HOME (installed_plugins.json + enabledPlugins) */
function pluginFixture(fx, plugins, enabledPlugins) {
  const root = nodePath.join(fx.home, '.claude', 'plugins');
  const rec = {};
  for (const [id, p] of Object.entries(plugins)) {
    const installPath = nodePath.join(root, 'cache', id.replace('@', '-'));
    rec[id] = [{ scope: p.scope ?? 'user', installPath, version: '1.0.0', ...(p.projectPath ? { projectPath: p.projectPath } : {}) }];
    if (p.mcp) fx.write(nodePath.join(installPath, '.mcp.json'), p.mcp);
    if (p.manifest) fx.write(nodePath.join(installPath, '.claude-plugin', 'plugin.json'), p.manifest);
    for (const [rel, v] of Object.entries(p.files ?? {})) fx.write(nodePath.join(installPath, rel), v);
  }
  fx.write(nodePath.join(root, 'installed_plugins.json'), { version: 2, plugins: rec });
  fx.write(nodePath.join(fx.home, '.claude', 'settings.json'), { enabledPlugins });
  return root;
}

test('#22: MCP servers of enabled Claude Code plugins are read (scope "plugin"); disabled and other-project plugins are not', (t) => {
  const fx = fixture(t);
  pluginFixture(fx, {
    'flat@m': { mcp: { flatsrv: { command: 'x', env: { F_TOKEN: 'CANAI3M3' } } } },
    'wrapped@m': { mcp: { mcpServers: { wrapsrv: { url: 'https://e.example/mcp' } } } },
    'inline@m': { manifest: { name: 'inline', mcpServers: { inl: { command: 'x' } } } },
    'pathref@m': { manifest: { name: 'pathref', mcpServers: ['./servers.json', '../../../../escape.json'] }, files: { 'servers.json': { mcpServers: { viapath: { command: 'x' } } } } },
    'off@m': { mcp: { offsrv: { command: 'x' } } },
    'other@m': { scope: 'project', projectPath: nodePath.join(fx.root, 'another'), mcp: { othersrv: { command: 'x' } } },
    'here@m': { scope: 'local', projectPath: fx.cwd, mcp: { heresrv: { command: 'x' } } },
  }, { 'flat@m': true, 'wrapped@m': true, 'inline@m': true, 'pathref@m': true, 'off@m': false, 'other@m': true, 'here@m': true });
  fx.write(nodePath.join(fx.home, 'escape.json'), { mcpServers: { escaped: { command: 'x' } } }); // ../../../../ from the install path
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS });
  const cc = host(r, 'claude-code');
  const plug = cc.servers.filter((s) => s.scope === 'plugin');
  assert.deepEqual(plug.map((s) => s.name).sort(), ['flatsrv', 'heresrv', 'inl', 'viapath', 'wrapsrv']);
  assert.equal(plug.find((s) => s.name === 'flatsrv').plugin, 'flat@m');
  assert.deepEqual(plug.find((s) => s.name === 'flatsrv').env, [{ name: 'F_TOKEN', state: 'literal' }]);
  assert.equal(plug.find((s) => s.name === 'wrapsrv').url, 'https://e.example/mcp');
  assert.ok(!JSON.stringify(r).includes('CANAI3M3'));
  // a project's local settings can turn a user plugin off
  fx.write(nodePath.join(fx.cwd, '.claude', 'settings.local.json'), { enabledPlugins: { 'flat@m': false } });
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS });
  assert.ok(!host(r2, 'claude-code').servers.some((s) => s.name === 'flatsrv'));
});

test('#22: a plugin config file that is a link is refused, not followed', (t) => {
  const fx = fixture(t);
  pluginFixture(fx, { 'lnk@m': { mcp: { linked: { command: 'x' } } } }, { 'lnk@m': true });
  const target = nodePath.join(fx.home, '.claude', 'plugins', 'cache', 'lnk-m', '.mcp.json');
  // the link is simulated through lstat (file symlinks need admin rights on Windows)
  const fs = { lstat: (p) => (p === target ? { isSymbolicLink: () => true, isDirectory: () => false } : lstatSync(p)) };
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS, fs });
  const cc = host(r, 'claude-code');
  assert.ok(!cc.servers.some((s) => s.name === 'linked'));
  assert.ok(cc.files.some((f) => f.file === target && f.ok === false && /link/.test(f.error)));
});

test('#22: Gemini CLI extensions (~/.gemini/extensions/<name>/gemini-extension.json) give plugin servers; linked folders are not followed', (t) => {
  const fx = fixture(t);
  const ext = nodePath.join(fx.home, '.gemini', 'extensions');
  fx.write(nodePath.join(ext, 'kit', 'gemini-extension.json'), { name: 'kit', mcpServers: { kitsrv: { httpUrl: 'https://k.example/mcp', headers: { Authorization: 'Bearer $KIT' } } } });
  fx.write(nodePath.join(fx.root, 'linked-ext', 'gemini-extension.json'), { mcpServers: { linksrv: { command: 'x' } } });
  linkDir(nodePath.join(fx.root, 'linked-ext'), nodePath.join(ext, 'zlinked'));
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: OS });
  const g = host(r, 'gemini');
  assert.deepEqual(names(g), ['kitsrv']);
  assert.equal(g.servers[0].plugin, 'kit');
  assert.equal(g.servers[0].url, 'https://k.example/mcp');
  assert.deepEqual(g.servers[0].headers, [{ name: 'Authorization', state: 'ref' }]);
  assert.ok(r.notes.some((n) => /1 linked extension folder/.test(n)));
});

test('#22: under WSL the Windows-side configs of the matching Windows user are read (read-only); junctions are skipped', (t) => {
  const fx = fixture(t);
  const mount = nodePath.join(fx.root, 'mnt-c');
  const win = nodePath.join(mount, 'Users', 'KK');
  mkdirSync(nodePath.join(mount, 'Users', 'Public'), { recursive: true });
  linkDir(win, nodePath.join(mount, 'Users', 'All Users'));
  fx.write(nodePath.join(win, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), { mcpServers: { windesk: { command: 'C:\\x.exe', env: { W_TOKEN: 'CANAI3M4' } } } });
  fx.write(nodePath.join(win, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'), { servers: { winvs: { command: 'x' } } });
  fx.write(nodePath.join(win, '.cursor', 'mcp.json'), { mcpServers: { wincur: { command: 'x' } } });
  fx.write(nodePath.join(win, '.claude.json'), { mcpServers: { wincc: { command: 'x' } } });
  const env = { WSL_DISTRO_NAME: 'Ubuntu', USER: 'kk' };
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env, platform: 'linux', wslMount: mount });
  assert.deepEqual(names(host(r, 'claude-desktop')), ['windesk']);
  assert.deepEqual(names(host(r, 'vscode')), ['winvs']);
  assert.deepEqual(names(host(r, 'cursor')), ['wincur']);
  assert.deepEqual(names(host(r, 'claude-code')), ['wincc']);
  assert.ok(host(r, 'claude-desktop').files.every((f) => !f.exists || f.side === 'windows'));
  assert.ok(r.notes.some((n) => /WSL detected: Windows-side configs were also read/.test(n)));
  assert.ok(!JSON.stringify(r).includes('CANAI3M4'));
  // not WSL: nothing from the mount
  const r0 = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: 'linux', wslMount: mount });
  assert.equal(host(r0, 'claude-desktop').servers.length, 0);
  // two person folders and no name match: not guessed
  mkdirSync(nodePath.join(mount, 'Users', 'Other'), { recursive: true });
  const r2 = readHosts({ home: fx.home, cwd: fx.cwd, env: { WSL_DISTRO_NAME: 'Ubuntu', USER: 'nobody' }, platform: 'linux', wslMount: mount });
  assert.equal(host(r2, 'claude-desktop').servers.length, 0);
  assert.ok(r2.notes.some((n) => /not included: 2 Windows user folders/.test(n)));
  // USERPROFILE passed through WSLENV names the folder
  const r3 = readHosts({ home: fx.home, cwd: fx.cwd, env: { WSL_INTEROP: '/run/x', USERPROFILE: 'C:\\Users\\KK' }, platform: 'linux', wslMount: mount });
  assert.deepEqual(names(host(r3, 'claude-desktop')), ['windesk']);
});
