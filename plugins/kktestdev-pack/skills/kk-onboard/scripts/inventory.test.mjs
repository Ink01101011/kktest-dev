// Tests for inventory.mjs. Stdlib only. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// Every fixture is a fake HOME under os.tmpdir(); the real ~/.claude* is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  run, redactText, redactUrl, redactArgs, splitShell, secretKey, inlineSecretKeys, isEnvRef, packageSpecOf, splitSpec,
  normalizeEndpoint, nameMatches, unwrapCommand, isUnderHome, shortPath, isLocalPath, tokenizeCommand,
  projectEntry, parseJsonOutput, parseMcpListLine, findBinDefault, validatePack, FINDING_CATEGORIES, LIMITS,
} from './inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'inventory.mjs');
const PACK = JSON.parse(readFileSync(join(HERE, '..', 'pack.json'), 'utf8'));
const posix = process.platform !== 'win32';

// ------------------------------------------------------------------ fixture helpers
function fakeHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'kk-inv-'));
  t.after(() => { try { spawnSync('chmod', ['-R', 'u+rwx', home]); rmSync(home, { recursive: true, force: true }); } catch {} });
  const cwd = join(home, 'proj');
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  return { home, cwd };
}
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
function stubClaude({ plugins = [], marketplaces = [], mcpList = '', fail = {} } = {}) {
  return async (args) => {
    const key = args.join(' ');
    if (fail[key]) return fail[key];
    if (key === 'plugin list --json') return { ok: true, stdout: typeof plugins === 'string' ? plugins : JSON.stringify(plugins) };
    if (key === 'plugin marketplace list --json') return { ok: true, stdout: typeof marketplaces === 'string' ? marketplaces : JSON.stringify(marketplaces) };
    if (key === 'mcp list') return { ok: true, stdout: mcpList };
    return { ok: false, error: 'unexpected' };
  };
}
const inv = (fx, argv = [], extra = {}) => run(argv, { home: fx.home, cwd: fx.cwd, env: {}, findBin: () => ({ found: true }), runClaude: stubClaude(), ...extra });
const cats = (out) => out.findings.map((f) => f.category);
const byCat = (out, c) => out.findings.filter((f) => f.category === c);
const item = (out, id) => out.pack.find((p) => p.id === id);

// ------------------------------------------------------------------ (a) secrets never reach stdout
const CANARIES = ['ARGTOK111', 'ARGKEY222', 'PW333', 'URLPASS999', 'QKEY000', 'QTOK001', 'HOOKSEC003', 'HOOKTOK789', 'sk-LEAKARG456xyz', 'DBPASS555', 'ENVLOW444', 'HDRKEY777', 'HEALTHTOK1', 'STDERRTOK2'];
function secretFixture(t) {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), {
    mcpServers: {
      a: { command: 'node', args: ['s.js', '--token=ARGTOK111', '--api-key', 'ARGKEY222', '--password=PW333', 'sk-LEAKARG456xyz'], env: { api_key: 'ENVLOW444', DATABASE_URL: 'postgres://u:DBPASS555@h/db' } },
      http1: { type: 'http', url: 'https://u:URLPASS999@x.example/mcp?key=QKEY000&token=QTOK001', headers: { 'X-Api-Key': 'HDRKEY777' } },
    },
  });
  write(join(fx.home, '.claude', 'settings.json'), { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: "curl -H 'Authorization: Bearer HOOKSEC003' https://h.example --token=HOOKTOK789" }] }] } });
  return fx;
}

test('G1-1/G2-1: no secret value from args, url, env, headers or hook commands appears in output (full mode)', async (t) => {
  const fx = secretFixture(t);
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ mcpList: 'srv: https://x.example/mcp?token=HEALTHTOK1 (HTTP) - ✗ Failed to connect\n', fail: { 'plugin marketplace list --json': { ok: false, code: 1, error: 'boom --token=STDERRTOK2' } } }) });
  const text = JSON.stringify(out);
  for (const c of CANARIES) assert.ok(!text.includes(c), `leaked ${c}`);
  assert.ok(out.installed.mcp.length >= 2, 'servers still listed');
  assert.ok(text.includes('x.example'), 'host is kept');
});

test('G1-1/G2-1: CLI end to end with a fake claude on PATH prints no canary', { skip: !posix }, (t) => {
  const fx = secretFixture(t);
  const bin = join(fx.home, 'bin');
  write(join(bin, 'claude'), '#!/bin/sh\ncase "$*" in\n  "mcp list") echo "a: node s.js --token=HEALTHTOK1 - ✓ Connected";;\n  *) echo "[]";;\nesac\n');
  chmodSync(join(bin, 'claude'), 0o755);
  for (const argv of [[], ['--full'], ['--fast', '--full']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: fx.cwd, encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: fx.home } });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    for (const c of CANARIES) assert.ok(!r.stdout.includes(c), `leaked ${c} with ${argv.join(' ')}`);
    assert.ok(Array.isArray(out.findings));
  }
});

test('redaction helpers', () => {
  assert.equal(redactUrl('https://u:p@h.example/mcp?token=abc&x=').text, 'https://***@h.example/mcp?token=***&x=');
  assert.deepEqual(redactArgs(['--api-key', 'V', '--token=${TOK}', '--name', 'n']).args, ['--api-key', '***', '--token=${TOK}', '--name', 'n']);
  assert.match(redactText('curl -H "Authorization: Bearer abc.def"').text, /Bearer \*\*\*/);
  assert.equal(redactText('GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaa run').text, 'GITHUB_TOKEN=*** run');
  assert.equal(redactText('node /Users/me/x.js --verbose').text, 'node /Users/me/x.js --verbose');
});

// ------------------------------------------------------------------ G2-2 / G1-9: inline-secret detector
test('G2-2/G1-9: inline-secret covers args, url, DATABASE_URL and has no false positives on AUTHOR_NAME or Bearer ${VAR}', async (t) => {
  const fx = secretFixture(t);
  const cj = JSON.parse(readFileSync(join(fx.home, '.claude.json'), 'utf8'));
  cj.mcpServers.clean = { command: 'node', args: ['c.js'], env: { AUTHOR_NAME: 'bob', API_KEY: '${API_KEY}' }, headers: { Authorization: 'Bearer ${TOK}' } };
  write(join(fx.home, '.claude.json'), cj);
  const out = await inv(fx);
  const f = byCat(out, 'inline-secret');
  const a = f.find((x) => x.title.includes('"a"')).evidence.join(' | ');
  assert.match(a, /env: api_key, DATABASE_URL/);
  assert.match(a, /args: .*--token.*--api-key/);
  const h = f.find((x) => x.title.includes('"http1"')).evidence.join(' | ');
  assert.match(h, /headers: X-Api-Key/);
  assert.match(h, /url: url userinfo, url query "key", url query "token"/);
  assert.ok(!f.some((x) => x.title.includes('"clean"')), 'AUTHOR_NAME / ${VAR} refs are not secrets');
  assert.ok(secretKey('OAUTH_TOKEN') && secretKey('apiKey') && !secretKey('AUTHOR_NAME') && !secretKey('PATH'));
  assert.ok(isEnvRef('Bearer ${TOK}') && !isEnvRef('Bearer abc'));
  assert.deepEqual(inlineSecretKeys({ DATABASE_URL: 'postgres://u:pw@h/db', FOO: 'bar' }), ['DATABASE_URL']);
});

// ------------------------------------------------------------------ (b) never crash, always JSON
test('G2-4/G3-4/G2-5: unreadable dir, symlink to a file, symlink to / do not crash', async (t) => {
  const fx = fakeHome(t);
  const skills = join(fx.home, '.claude', 'skills');
  write(join(skills, 'ok', 'SKILL.md'), '---\nname: ok\n---\n');
  if (posix) {
    symlinkSync('/etc/hosts', join(skills, 'filelink'));
    symlinkSync('/', join(skills, 'rootlink'));
    mkdirSync(join(skills, 'locked'));
    chmodSync(join(skills, 'locked'), 0o000);
  }
  const out = await inv(fx, ['--full']);
  assert.ok(!out.error, JSON.stringify(out.notes));
  assert.ok(out.installed.skills.some((s) => s.name === 'ok'));
  if (posix) {
    assert.ok(out.notes.some((n) => /rootlink.*filesystem root/.test(n)), JSON.stringify(out.notes));
    if (process.getuid?.() !== 0) assert.ok(out.notes.some((n) => /locked.*EACCES/.test(n)), JSON.stringify(out.notes));
  }
});

test('G1-8/G2-6/G3-12: malformed shapes and non-JSON claude output give JSON with notes', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), { mcpServers: { x: null, y: 'str', z: { command: 'node', args: 'notalist', env: 'nope' } }, projects: 'bad' });
  write(join(fx.home, '.claude', 'settings.json'), { hooks: { PreToolUse: 'x', PostToolUse: [null, { hooks: 'y' }] }, permissions: { allow: 'Bash' } });
  write(join(fx.cwd, '.mcp.json'), '{bad');
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ plugins: 'Update available: 9.9\n[{"id":"p@m","enabled":true}]\n', marketplaces: 'Loading plugins...' }) });
  assert.ok(!out.error, JSON.stringify(out.notes));
  assert.deepEqual(out.installed.plugins.map((p) => p.id), ['p@m'], 'JSON array extracted after a banner line');
  assert.ok(out.notes.some((n) => /marketplace list.*no JSON/.test(n)));
  assert.ok(out.notes.some((n) => /not an MCP server config/.test(n)));
  assert.ok(out.notes.some((n) => /\.mcp\.json is not valid JSON/.test(n)));
  assert.ok(out.notes.some((n) => /hooks\.PreToolUse is not a list/.test(n)));
  assert.deepEqual(out.installed.mcp.map((s) => s.name), ['z']);
});

test('G3-6: settings.json with a UTF-8 BOM is read', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude', 'settings.json'), '\uFEFF' + JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'true' }] }] }, permissions: { allow: ['Bash'] } }));
  const out = await inv(fx);
  assert.ok(cats(out).includes('hook-every-tool'));
  assert.ok(cats(out).includes('broad-permission'));
});

test('G3-5: CRLF `claude mcp list` output is parsed', async (t) => {
  const fx = fakeHome(t);
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ mcpList: 'Checking MCP server health...\r\n\r\nfoo: npx foo - ✓ Connected\r\nbar: https://b.example/mcp (HTTP) - ! Needs authentication\r\n' }) });
  assert.equal(out.installed.mcpHealth.length, 2);
  assert.ok(byCat(out, 'mcp-unhealthy')[0].evidence[0].startsWith('bar: Needs authentication'));
  assert.deepEqual(parseMcpListLine('x: C:\\Users\\a\\npx.cmd y - ✓ Connected'), { name: 'x', target: 'C:\\Users\\a\\npx.cmd y', status: 'Connected' });
});

test('G3-13/G4-1: claude missing or mcp list timing out still yields JSON; plugin items read unknown', async (t) => {
  const fx = fakeHome(t);
  const enoent = { ok: false, code: 'ENOENT', error: 'spawn claude ENOENT' };
  const out = await inv(fx, [], { runClaude: stubClaude({ fail: { 'plugin list --json': enoent, 'plugin marketplace list --json': enoent, 'mcp list': enoent } }) });
  assert.match(out.notes[0], /claude was not found on PATH/);
  assert.equal(item(out, 'superpowers').status, 'unknown');
  assert.equal(item(out, 'playwright').status, 'missing');
  const out2 = await inv(fx, [], { runClaude: stubClaude({ fail: { 'mcp list': { ok: false, code: 'ETIMEDOUT', error: 'timed out' } } }) });
  assert.ok(out2.notes.some((n) => /did not finish within 45 s/.test(n)));
  assert.equal(LIMITS.mcpListTimeoutMs, 45000);
});

test('G4-3: script scan skips node_modules and stops counting at the cap', async (t) => {
  const fx = fakeHome(t);
  const sk = join(fx.home, '.claude', 'skills', 'big');
  write(join(sk, 'SKILL.md'), 'x');
  for (let i = 0; i < 30; i++) write(join(sk, 'node_modules', `m${i}`, 'i.js'), '');
  write(join(sk, 'scripts', 'a.sh'), '');
  const out = await inv(fx);
  const f = byCat(out, 'skill-with-scripts')[0];
  assert.match(f.evidence[0], /big \(1 scripts/);
});

// ------------------------------------------------------------------ (d) output size
test('G4-2/G2-7: compact by default, lists only with --full, evidence capped', async (t) => {
  const fx = fakeHome(t);
  const servers = {};
  for (let i = 0; i < 300; i++) servers[`s${i}`] = { type: 'http', url: 'https://same.example/mcp' };
  write(join(fx.home, '.claude.json'), { mcpServers: servers });
  const out = await inv(fx);
  assert.equal(out.mode, 'compact');
  assert.equal(out.installed, undefined);
  assert.equal(out.counts.mcp, 300);
  const f = byCat(out, 'same-endpoint')[0];
  assert.equal(f.evidence.length, LIMITS.evidence + 1);
  assert.ok(JSON.stringify(out).length < 20000, `compact output ${JSON.stringify(out).length} bytes`);
  const full = await inv(fx, ['--full']);
  assert.equal(full.installed.mcp.length, LIMITS.list);
  assert.ok(full.notes.some((n) => /showing 200 of 300/.test(n)));
  assert.ok(item(out, 'superpowers').what, 'what is kept for missing items');
});

// ------------------------------------------------------------------ (e) detector accuracy
test('G1-4: mcp-remote and pnpm dlx are grouped by what they run, not by the runner', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), { mcpServers: {
    ra: { command: 'npx', args: ['-y', 'mcp-remote', 'https://a.example/mcp'] },
    rb: { command: 'npx', args: ['-y', 'mcp-remote', 'https://b.example/mcp'] },
    rc: { type: 'http', url: 'https://a.example/mcp' },
    p1: { command: 'pnpm', args: ['dlx', 'foo'] },
    p2: { command: 'pnpm', args: ['dlx', 'bar'] },
    s1: { command: 'npx', args: ['-y', '@scope/pkg@latest'] },
    s2: { command: 'cmd', args: ['/c', 'npx', '-y', '@scope/pkg'] },
  } });
  const out = await inv(fx);
  const pk = byCat(out, 'same-package').map((f) => f.title);
  assert.deepEqual(pk, ['@scope/pkg is configured 2 times']);
  const ep = byCat(out, 'same-endpoint');
  assert.equal(ep.length, 1);
  assert.deepEqual(ep[0].evidence.map((e) => e.split(' — ')[0]).sort(), ['ra', 'rc']);
  assert.deepEqual(packageSpecOf('npx', ['--package', 'x@1', 'cmd']), { runner: 'npx', spec: 'x@1' });
  assert.deepEqual(packageSpecOf('uvx', ['--from', 'mcp-atlassian==1.0', 'mcp-atlassian']), { runner: 'uvx', spec: 'mcp-atlassian==1.0' });
  assert.equal(packageSpecOf('node', ['x.js']), null);
});

test('G1-5: endpoint normalisation keeps tenants apart and merges /mcp, /v1/mcp, /sse', () => {
  assert.notEqual(normalizeEndpoint('https://h.example/mcp/orgA'), normalizeEndpoint('https://h.example/mcp/orgB'));
  const k = normalizeEndpoint('https://h.example/mcp');
  for (const u of ['https://h.example/v1/mcp', 'HTTP://H.example/mcp/', 'https://h.example/sse']) assert.equal(normalizeEndpoint(u), k, u);
});

test('G1-7: plugin mcpServers as a path string or array, and flat .mcp.json non-server keys', async (t) => {
  const fx = fakeHome(t);
  const pa = join(fx.home, 'plugins', 'pa');
  write(join(pa, '.claude-plugin', 'plugin.json'), { name: 'pa', mcpServers: './servers.json' });
  write(join(pa, 'servers.json'), { mcpServers: { fromfile: { command: 'node', args: ['x'] } } });
  const pb = join(fx.home, 'plugins', 'pb');
  write(join(pb, '.claude-plugin', 'plugin.json'), { name: 'pb', mcpServers: ['./a.json', { inline: { type: 'http', url: 'https://i.example/mcp' } }] });
  write(join(pb, 'a.json'), { arr: { command: 'node' } });
  write(join(pb, '.mcp.json'), { srvx: { command: 'node' }, note: 'readme' });
  const plugins = [{ id: 'pa@m', enabled: true, installPath: pa, scope: 'user' }, { id: 'pb@m', enabled: true, installPath: pb, scope: 'user' }];
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ plugins }) });
  assert.deepEqual(out.installed.mcp.map((s) => s.name).sort(), ['arr', 'fromfile', 'inline', 'srvx']);
  assert.ok(out.notes.some((n) => /not an MCP server config \(note\)/.test(n)));
});

test('G1-6: a plugin enabled in two scopes is scanned once', async (t) => {
  const fx = fakeHome(t);
  const pa = join(fx.home, 'plugins', 'pa');
  write(join(pa, '.mcp.json'), { mcpServers: { srv: { type: 'http', url: 'https://dup.example/mcp' } } });
  write(join(pa, 'skills', 'sk', 'SKILL.md'), 'x');
  const plugins = [{ id: 'pa@m', enabled: true, installPath: pa, scope: 'user' }, { id: 'pa@m', enabled: true, installPath: pa, scope: 'project' },
    { id: 'fd@m', enabled: false, scope: 'user' }, { id: 'fd@m', enabled: false, scope: 'project' }];
  const out = await inv(fx, [], { runClaude: stubClaude({ plugins }) });
  assert.equal(out.counts.mcp, 1);
  assert.equal(out.counts.skills, 1);
  assert.ok(!cats(out).includes('same-endpoint'));
  assert.equal(byCat(out, 'disabled-installed').length, 1);
  assert.equal(byCat(out, 'disabled-installed')[0].evidence.length, 2);
});

test('G1-10: matcher "*" counts as every tool', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude', 'settings.json'), { hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'star' }] }, { matcher: '', hooks: [{ type: 'command', command: 'empty' }] }, { matcher: 'Bash', hooks: [{ type: 'command', command: 'bash-only' }] }] } });
  const out = await inv(fx);
  assert.deepEqual(byCat(out, 'hook-every-tool').map((f) => f.title.split(': ').pop()).sort(), ['empty', 'star']);
});

test('G1-11: pinned packages are not reported as "runs latest"', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), { mcpServers: { pinned: { command: 'npx', args: ['-y', 'foo@1.2.3'] }, latest: { command: 'npx', args: ['-y', 'bar@latest'] }, bare: { command: 'uvx', args: ['baz'] } } });
  const out = await inv(fx);
  assert.deepEqual(byCat(out, 'runs-latest-from-registry').map((f) => f.title.match(/"(\w+)"/)[1]).sort(), ['bare', 'latest']);
});

test('G1-12/G6-17: short names match whole tokens only', async (t) => {
  assert.ok(nameMatches('server-memory', 'memory') && !nameMatches('in-memory-cache', 'memory') && !nameMatches('browserstack', 'browser'));
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), { mcpServers: { 'memory-viewer-tool': { command: 'node' }, 'in-memory-cache': { command: 'node' }, browserstack: { command: 'node' }, 'my-shadcn-fork': { command: 'node', args: ['/x/not-shadcn-really/a.js'] } } });
  const out = await inv(fx);
  assert.ok(!cats(out).some((c) => c === 'overlap:memory' || c === 'overlap:browser'), cats(out).join());
  assert.equal(item(out, 'shadcn').status, 'missing');
});

test('G1-13: pack item present only as an unauthenticated or project-disabled server reads needs-attention / disabled', async (t) => {
  const fx = fakeHome(t);
  write(join(fx.home, '.claude.json'), { mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] } }, projects: { [fx.cwd]: { disabledMcpServers: ['playwright'] } } });
  const plugins = [{ id: 'figma@claude-plugins-official', enabled: true, scope: 'user' }];
  const out = await inv(fx, [], { runClaude: stubClaude({ plugins, mcpList: 'plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication\n' }) });
  assert.equal(item(out, 'figma').status, 'needs-attention');
  assert.match(item(out, 'figma').foundAs[0], /Needs authentication/);
  assert.equal(item(out, 'playwright').status, 'disabled');
});

test('G1-14: the pack\'s own marketplaces and all-pack overlap groups are marked packManaged', async (t) => {
  const fx = fakeHome(t);
  const marketplaces = [{ name: 'superpowers-dev', source: 'github', repo: 'obra/superpowers' }, { name: 'other', source: 'github', repo: 'x/y' }, { name: 'claude-plugins-official', source: 'github', repo: 'anthropics/claude-plugins-official' }];
  const out = await inv(fx, [], { runClaude: stubClaude({ marketplaces }) });
  const f = byCat(out, 'third-party-marketplace');
  assert.equal(f.length, 2);
  assert.equal(f.find((x) => x.title.includes('superpowers-dev')).packManaged, true);
  assert.equal(f.find((x) => x.title.includes('"other"')).packManaged, undefined);
});

test('G3-11: a project under a folder named "synced" is not labelled claude.ai synced', async (t) => {
  const fx = fakeHome(t);
  const cwd = join(fx.home, 'synced', 'p');
  write(join(cwd, '.claude', 'skills', 'mine', 'SKILL.md'), 'x');
  write(join(fx.home, '.claude', 'skills', 'synced', 'abc', 'syn', 'SKILL.md'), 'x');
  const out = await inv({ ...fx, cwd }, ['--full']);
  const src = Object.fromEntries(out.installed.skills.map((s) => [s.name, s.source]));
  assert.deepEqual(src, { mine: 'project (.claude/skills)', syn: 'claude.ai synced' });
});

// ------------------------------------------------------------------ (f) Windows / cross-OS (pure helpers, simulated)
test('G3-3: projects key lookup tolerates / vs \\ and case on win32', () => {
  const projects = { 'C:/Users/kk/proj': { mcpServers: { a: {} } } };
  assert.ok(projectEntry(projects, 'c:\\Users\\kk\\proj', 'win32'));
  assert.equal(projectEntry(projects, '/Users/kk/proj', 'linux'), null);
});

test('G3-8/G2-11/G1-26: home prefix is boundary-checked and case-insensitive on win32', () => {
  assert.ok(!isUnderHome('/Users/kktest2/x', '/Users/kktest', 'linux'));
  assert.equal(shortPath('/Users/kktest2/x', '/Users/kktest', 'linux'), '/Users/kktest2/x');
  assert.equal(shortPath('/Users/kktest/x', '/Users/kktest', 'linux'), '~/x');
  const H = 'C:\\Users\\kk';
  for (const p of ['c:\\users\\kk\\proj\\srv.js', 'C:/Users/kk/proj/srv.js', '/c/Users/kk/h.sh', '%USERPROFILE%\\h.cmd']) assert.ok(isLocalPath(p, H, 'win32'), p);
  assert.ok(!isLocalPath('C:\\Users\\kkim\\x.js', H, 'win32'));
});

test('G3-7: package-manager shims under HOME are not "local path" code', () => {
  const H = 'C:\\Users\\kk';
  for (const p of ['C:\\Users\\kk\\AppData\\Roaming\\npm\\bantamkit-mcp.cmd', 'C:\\Users\\kk\\AppData\\Local\\mise\\shims\\node.exe', 'C:\\Users\\kk\\AppData\\Roaming\\nvm\\v20\\node.exe', 'C:\\Users\\kk\\scoop\\shims\\uvx.exe']) assert.ok(!isLocalPath(p, H, 'win32'), p);
  for (const p of ['~/.npm-global/bin/x', '~/.local/bin/uvx', '~/.cargo/bin/x', '~/.bun/bin/x', '~/.fnm/node']) assert.ok(!isLocalPath(p, '/home/al', 'linux'), p);
  assert.ok(isLocalPath('~/code/mcp/server.js', '/home/al', 'linux'));
});

test('G3-9: hook commands are tokenised with quotes', () => {
  assert.deepEqual(tokenizeCommand('node "C:\\Users\\First Last\\hook.js" --x'), ['node', 'C:\\Users\\First Last\\hook.js', '--x']);
  assert.ok(isLocalPath(tokenizeCommand('node "C:\\Users\\First Last\\My Tools\\hook.js"')[1], 'C:\\Users\\First Last', 'win32'));
});

test('G3-1/G3-2: cmd /c wrappers are seen through', () => {
  assert.deepEqual(unwrapCommand('cmd', ['/c', 'npx', '-y', 'x']), { command: 'npx', args: ['-y', 'x'] });
  assert.deepEqual(packageSpecOf('C:\\Windows\\System32\\cmd.exe', ['/C', 'npx.cmd', '-y', 'chrome-devtools-mcp@latest']), { runner: 'npx', spec: 'chrome-devtools-mcp@latest' });
  for (const it of PACK.items.filter((i) => i.kind === 'mcp')) assert.ok(Array.isArray(it.windows) && it.windows.length === it.steps.length, `${it.id} has windows steps`);
});

test('G3-14/G4-6: binaries are found in-process, never in the current directory, with PATHEXT on win32', (t) => {
  const fx = fakeHome(t);
  const bin = join(fx.home, 'b');
  write(join(bin, 'tool'), '#!/bin/sh\n');
  chmodSync(join(bin, 'tool'), 0o755);
  write(join(bin, 'noexec'), '');
  assert.equal(findBinDefault('tool', { env: { PATH: `.:${bin}` }, platform: 'darwin' }).found, true);
  assert.equal(findBinDefault('noexec', { env: { PATH: bin }, platform: 'darwin' }).found, false);
  assert.equal(findBinDefault('nothere', { env: { PATH: '.' }, platform: 'darwin' }).found, false);
  write(join(bin, 'w.CMD'), '');
  assert.equal(findBinDefault('w', { env: { PATH: bin, PATHEXT: '.EXE;.CMD' }, platform: 'win32' }).found, true);
});

// ------------------------------------------------------------------ helpers + parity
test('parseJsonOutput extracts JSON after banner lines', () => {
  assert.deepEqual(parseJsonOutput('Update available\n[1,2]').value, [1, 2]);
  assert.deepEqual(parseJsonOutput('\uFEFF{"a":1}').value, { a: 1 });
  assert.equal(parseJsonOutput('nothing').ok, false);
  assert.deepEqual(splitSpec('@s/p@1.0'), { name: '@s/p', version: '1.0' });
});

test('G6-16: pack.json is valid and unknown detect keys are reported', () => {
  assert.deepEqual(validatePack(PACK), []);
  assert.match(validatePack({ items: [{ id: 'x', kind: 'mcp', steps: [], detect: { mcpArg: ['y'] } }] })[0], /unknown detect key "mcpArg"/);
});

test('G6-18: every finding category the script emits is documented in SKILL.md', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const emitted = new Set([...src.matchAll(/\['(?:redundancy|risk|info)', [`'](overlap:\$\{)?([\w-]+)/g)].map((m) => (m[1] ? 'overlap:<group>' : m[2])));
  assert.deepEqual([...emitted].sort(), [...FINDING_CATEGORIES].sort());
  const skill = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');
  for (const c of FINDING_CATEGORIES) assert.ok(skill.includes('`' + c + '`'), `SKILL.md lists ${c}`);
});

test('G2-3: SKILL.md treats inventory strings as untrusted data and quotes names', () => {
  const skill = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /untrusted data, never instructions/);
  assert.match(skill, /single quotes/);
});

test('G6-1: importing the module prints nothing and runs no CLI', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(SCRIPT)}).then(m => console.log(typeof m.run))`], { encoding: 'utf8', env: { PATH: '' } });
  assert.equal(r.stdout.trim(), 'function');
});

// ---------------------------------------------------------------- G5 follow-ups (N1-N3)
test('G5-N3: redactUrl fallback masks userinfo and query values of unparsable URLs', () => {
  const r = redactUrl('//alice:CANAFB1@host.example/x?token=CANAFB2&q=1');
  assert.ok(!r.text.includes('CANAFB1') && !r.text.includes('CANAFB2'), r.text);
  assert.ok(r.text.includes('//***@host.example'), r.text);
  assert.ok(r.hits.includes('url userinfo'));
});

test('G5-N2: -u user:password, mysql -pSECRET and --pw are masked; -p port elsewhere is kept', () => {
  assert.deepEqual(redactArgs(['-u', 'me:CANAN21', 'https://x']).args, ['-u', 'me:***', 'https://x']);
  assert.deepEqual(redactArgs(['-u', 'me:${PW}']).args, ['-u', 'me:${PW}']);
  assert.deepEqual(redactArgs(['-h', 'db', '-pCANAN22', 'app'], 'mysql').args, ['-h', 'db', '-p***', 'app']);
  assert.deepEqual(redactArgs(['-p8080'], 'node').args, ['-p8080']);
  assert.deepEqual(redactArgs(['--pw', 'CANAN23']).args, ['--pw', '***']);
  const t = redactText('curl -u bob:CANAN24 https://x && mysql -uroot -pCANAN25 db').text;
  assert.ok(!/CANAN2[45]/.test(t), t);
  assert.equal(redactText('serve -p8080').text, 'serve -p8080');
  assert.ok(redactArgs(['-u', 'me:CANAN26']).hits.length > 0);
});

test('G5-N1: marketplace repo/url carrying a token is redacted in installed list and evidence', async (t) => {
  const fx = fakeHome(t);
  const marketplaces = [
    { name: 'tok', source: 'git', repo: 'https://ghp_CANAN1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@github.com/o/r.git' },
    { name: 'u', source: 'git', url: 'https://bob:CANAN12@git.example/r.git' },
  ];
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ marketplaces }) });
  const txt = JSON.stringify(out);
  assert.ok(!txt.includes('CANAN1aaaa') && !txt.includes('CANAN12'), 'token leaked');
  const ev = byCat(out, 'third-party-marketplace').flatMap((f) => f.evidence).join('\n');
  assert.match(ev, /git: https:\/\/\*\*\*@git\.example\/r\.git/);
});

// ---------------------------------------------------------------- G7 follow-ups
test('G7-1: glued, combined and quoted -u user:password forms are masked for credential commands', () => {
  for (const [s, want] of [
    ['curl -ubob:CANAG1 https://x', 'curl -ubob:*** https://x'],
    ['curl -vu bob:CANAG2 https://x', 'curl -vu bob:*** https://x'],
    ['curl -vubob:CANAG3 x', 'curl -vubob:*** x'],
    ['curl -u "bob:pa CANAG4" x', 'curl -u "bob:***" x'],
    ['curl --user=bob:CANAG5 x', 'curl --user=bob:*** x'],
  ]) assert.equal(redactText(s).text, want);
  assert.deepEqual(redactArgs(['-ubob:CANAG6', 'x'], 'curl').args, ['-ubob:***', 'x']);
  assert.deepEqual(redactArgs(['-vu', 'bob:CANAG7'], 'curl').args, ['-vu', 'bob:***']);
  assert.deepEqual(redactArgs(['--user=bob:CANAG8'], 'tool').args, ['--user=bob:***']);
});

test('G7-2 / G9-M-A: only a numeric uid:gid after -u is left alone; anything else is masked (fail-safe)', () => {
  assert.equal(redactText('docker run -u 1000:1000 img').text, 'docker run -u 1000:1000 img');
  assert.equal(redactText('tool -u 1000:1000').text, 'tool -u 1000:1000');
  assert.deepEqual(redactArgs(['-u', '1000:1000'], 'docker').args, ['-u', '1000:1000']);
  assert.equal(redactText('docker run -u bob:staff img').text, 'docker run -u bob:*** img'); // over-masked, display only
  assert.ok(!redactText('docker run img mytool -u bob:CANAI1').text.includes('CANAI1'));
  assert.ok(!redactArgs(['run', 'img', 'mytool', '-u', 'bob:CANAI1'], 'docker').args.join(' ').includes('CANAI1'));
  assert.equal(redactText('tool -ubob:keep').text, 'tool -ubob:keep'); // glued form only for known credential commands
});

test('G7-3: the MySQL -p rule applies per shell segment', () => {
  assert.equal(redactText('ssh -p2222 host && mysql -uroot -pCANAG9 db').text, 'ssh -p2222 host && mysql -uroot -p*** db');
  assert.equal(redactText('mysql -pCANAG10; ssh -p22 h').text, 'mysql -p***; ssh -p22 h');
  assert.equal(redactText('FOO=1 mysql -pCANAG11').text, 'FOO=1 mysql -p***');
  assert.equal(redactArgs(['-pCANAI2'], 'C:\\Tools\\MySQL\\bin\\mysql.exe').args[0], '-p***');
});

test('G7-4: redactText stays linear on long adversarial input (below the cut)', () => {
  // 19,999 chars stays under LIMITS.redactChars, so this times the regexes, not the truncation.
  // Linear runs take ~1 ms here; the old unanchored KEY_VALUE took ~170 ms at this length.
  for (const s of ['a'.repeat(19999), 'a.'.repeat(9999), 'a='.repeat(9999), 'x:'.repeat(9999), '-u '.repeat(6666)]) {
    const t0 = process.hrtime.bigint();
    redactText(s);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 60, `${s.slice(0, 4)}… took ${ms} ms`);
  }
});

test('G7-4: text over LIMITS.redactChars is cut before redaction and a secret past the cut is dropped', () => {
  const out = redactText('x'.repeat(30000) + ' --token CANAG12').text;
  assert.ok(out.length <= 20000 + 20, `length ${out.length}`);
  assert.ok(out.endsWith('[truncated]'));
  assert.ok(!out.includes('CANAG12'));
});

test('G7-5: marketplace source is redacted too', async (t) => {
  const fx = fakeHome(t);
  const out = await inv(fx, ['--full'], { runClaude: stubClaude({ marketplaces: [{ name: 's', source: 'https://bob:CANAG13@git.example/r.git' }] }) });
  assert.ok(!JSON.stringify(out).includes('CANAG13'));
});

// ---------------------------------------------------------------- G8 regressions (F4)
test('G8-M1: credential commands behind wrappers are still masked', () => {
  for (const s of ['docker exec db mysql -uroot -pCANAH1', 'kubectl exec p -- mysql -pCANAH1', 'ssh host mysql -pCANAH1', 'sudo mysql -pCANAH1',
    'time mysql -pCANAH1', 'timeout 5 mysql -pCANAH1', 'nohup mysql -pCANAH1', "bash -c 'mysql -pCANAH1'", '$(mysql -pCANAH1)', '`mysql -pCANAH1`',
    '(mysql -pCANAH1)', '{ mysql -pCANAH1; }', '! mysql -pCANAH1', 'sudo curl -ubob:CANAH1 h', 'docker exec c curl -u bob:CANAH1 h', 'ssh h curl -vu bob:CANAH1 h']) {
    assert.ok(!redactText(s).text.includes('CANAH1'), s + ' => ' + redactText(s).text);
  }
  for (const [args, cmd] of [[['exec', 'db', 'mysql', '-pCANAH2'], 'docker'], [['host', 'mysql', '-pCANAH2'], 'ssh'], [['x', 'mysql', '-pCANAH2'], 'npx'], [['/c', 'mysql', '-pCANAH2'], 'cmd'], [['run', 'img', 'curl', '-u', 'bob:CANAH2'], 'docker']]) {
    assert.ok(!redactArgs(args, cmd).args.join(' ').includes('CANAH2'), `${cmd} ${args.join(' ')}`);
  }
});

test('G8-M2: shell separators inside quotes do not split a password', () => {
  assert.deepEqual(splitShell('a "b;c" && d'), ['a "b;c" ', '&&', ' d']);
  for (const s of ['curl -u "bob:pa;CANAH3" h', "curl -u 'bob:pa|CANAH3' h", 'mysql -p"ab;CANAH3"', 'mysql -p"ab&&CANAH3" db']) {
    assert.ok(!redactText(s).text.includes('CANAH3'), s + ' => ' + redactText(s).text);
  }
});

test('G8-M3: keys and URLs after digits, dots and dashes are still matched', () => {
  for (const s of ['1api_key=CANAH4', '.password=CANAH4', '9DB_PASSWORD=CANAH4', '---token=CANAH4', '-https://u:CANAH4@h/x', '.https://h/x?key=CANAH4', 'x--token=CANAH4']) {
    assert.ok(!redactText(s).text.includes('CANAH4'), s + ' => ' + redactText(s).text);
  }
});

test('G8-m1/m2: separators and whitespace stay linear; node/python/ssh do not veto -u masking', () => {
  for (const s of [' '.repeat(19999), ' ; '.repeat(6666), '&'.repeat(19999), 'a1'.repeat(9999), 'a.'.repeat(9999)]) {
    const t0 = process.hrtime.bigint(); redactText(s); redactArgs(Array(50).fill(s.slice(0, 2000)));
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 200);
  }
  for (const s of ['node cli.js -u u:CANAH5', 'python3 x.py --user u:CANAH5', 'ssh -u u:CANAH5 h']) assert.ok(!redactText(s).text.includes('CANAH5'), s);
  assert.equal(redactText('docker run -u 1000:1000 img').text, 'docker run -u 1000:1000 img');
});

test('G9-M-B/M-C: long keys and long URL schemes are matched with no length cap, still linear', () => {
  for (const s of [`SECRET_${'x'.repeat(70)}=CANAI3`, `token${'_x'.repeat(40)}=CANAI3`, `--token-${'x'.repeat(70)} CANAI3`,
    `${'s'.repeat(40)}://bob:CANAI3@h`, `9https://bob:CANAI3@h`, `1api_key=CANAI3`, `-https://bob:CANAI3@h`]) {
    assert.ok(!redactText(s).text.includes('CANAI3'), s.slice(0, 30) + ' => ' + redactText(s).text.slice(0, 60));
  }
  for (const s of ['a'.repeat(19999), 'a1'.repeat(9999), 'a.'.repeat(9999), '-'.repeat(19999), 'a://'.repeat(4999), '--a '.repeat(4999)]) {
    const t0 = process.hrtime.bigint(); redactText(s);
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 60, s.slice(0, 4));
  }
});

test('G9 minor: the 20k cut happens at whitespace, so no token fragment is left', () => {
  const s = 'x '.repeat(9997) + 'sk-' + 'Z'.repeat(40);
  const out = redactText(s).text;
  assert.ok(!/sk-Z/.test(out), out.slice(-40));
});
