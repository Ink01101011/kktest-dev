// Tests for hosts.mjs and the shared helpers in common.mjs. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// Every fixture is a fake HOME under os.tmpdir(); the real config files are never read.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { test } from 'node:test';
import { HOST_IDS, TOML_SCALAR, detectProviders, hostDefinitions, parseToml, readHosts, readTomlConfig, valueState } from './hosts.mjs';
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
