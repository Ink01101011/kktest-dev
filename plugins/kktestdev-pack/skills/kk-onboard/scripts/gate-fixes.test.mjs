// Regression pins for the 1.1.0 release gate (G1 review + G2 pentest) fixes. Stdlib only; every fixture is a fake
// HOME under os.tmpdir(); no real java is ever run (exec is a stub that records its calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { globalPackageDirs, javaForBin, releaseJavaVersion } from './inventory.mjs';

function fakeHome(t) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'kk-f1-')));
  t.after(() => { try { rmSync(home, { recursive: true, force: true }); } catch {} });
  const cwd = join(home, 'proj');
  mkdirSync(join(cwd, '.git'), { recursive: true }); // a project marker: the cwd is a cloned repo
  return { home, cwd };
}
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
const javaOf = (h) => join(h, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
function recExec(version = '17.0.1') {
  const calls = [];
  const fn = async (cmd, args) => { calls.push([cmd, ...args]); return { ok: true, stdout: '', stderr: `openjdk version "${version}"\n` }; };
  fn.calls = calls;
  return fn;
}

// ------------------------------------------------------------------ G1-B1: Windows paths need win32 rules
test('F1 B1: a Windows absolute PNPM_HOME counts under win32 rules and is ignored under posix rules', () => {
  const isDirStat = { isDirectory: () => true, isSymbolicLink: () => false };
  const fs = { lstat: () => isDirStat, readdir: (d) => (/[\\/]global$/.test(d) ? ['5'] : []) };
  const env = { PNPM_HOME: 'D:\\a\\kk\\pn' };
  const win = globalPackageDirs({ home: 'C:\\Users\\u', env, platform: 'win32', fs }).find((d) => d.manager === 'pnpm');
  assert.ok(win.modules.some((m) => m.startsWith('D:\\a\\kk\\pn\\global')), 'win32: PNPM_HOME used');
  const lin = globalPackageDirs({ home: 'C:\\Users\\u', env, platform: 'linux', fs }).find((d) => d.manager === 'pnpm');
  assert.ok(!lin.modules.some((m) => m.startsWith('D:\\a\\kk\\pn')), 'posix: a D:\\ path is relative, so it is not used');
});

// ------------------------------------------------------------------ G1-M1 / G2-L4: the Java probe never runs project code
test('F1 M1: a relative $JAVA_HOME is never run (nor read)', async (t) => {
  const fx = fakeHome(t);
  const exec = recExec();
  const reads = [];
  const r = await javaForBin('/x/jdtls', { env: { JAVA_HOME: '.' }, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: (f) => { reads.push(f); return ''; }, exists: () => true });
  assert.equal(r.version, null);
  assert.match(r.error, /not an absolute path/);
  assert.deepEqual(exec.calls, []);
  assert.deepEqual(reads, [], 'not even its release file');
});

test('F1 M1: an absolute $JAVA_HOME inside the current project (or below the cwd) is not run', async (t) => {
  const fx = fakeHome(t);
  const inRepo = join(fx.cwd, 'jdk');
  write(javaOf(inRepo), '');
  const exec = recExec();
  const r = await javaForBin('/x/jdtls', { env: { JAVA_HOME: inRepo }, cwd: join(fx.cwd, 'sub'), home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => '' });
  assert.equal(r.version, null);
  assert.match(r.error, /inside the current project, so it was not run/);
  assert.deepEqual(exec.calls, []);
  // a path that only resolves into the project counts as inside (resolved paths are compared)
  const r2 = await javaForBin('/x/jdtls', { env: { JAVA_HOME: inRepo + '/../jdk' }, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => '' });
  assert.match(r2.error, /inside the current project/);
  // a HOME that sits inside a repo turns the project guard off; the cwd guard still holds
  // a link outside the project that points into it counts as inside (real paths are compared)
  symlinkSync(inRepo, join(fx.home, 'jdk-link'), 'junction');
  const rl = await javaForBin('/x/jdtls', { env: { JAVA_HOME: join(fx.home, 'jdk-link') }, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => '' });
  assert.match(rl.error, /inside the current project/);
  // (the G1 PoC shape: HOME and the project are siblings inside an outer repo)
  mkdirSync(join(fx.home, '.git'), { recursive: true });
  const r3 = await javaForBin('/x/jdtls', { env: { JAVA_HOME: inRepo }, cwd: fx.cwd, home: join(fx.home, 'h'), exec, findBin: () => ({ found: false }), readHead: () => '' });
  assert.match(r3.error, /inside the current project/);
  assert.deepEqual(exec.calls, []);
});

test('F1 M1: the wrapper default and java on PATH get the same checks', async (t) => {
  const fx = fakeHome(t);
  const exec = recExec();
  const rel = await javaForBin('/x/jdtls', { env: {}, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => 'JAVA_HOME="${JAVA_HOME:-.jdk}" exec x' });
  assert.match(rel.error, /wrapper script \(\.jdk\) is not an absolute path/);
  const inRepo = join(fx.cwd, '.jdk');
  write(javaOf(inRepo), '');
  const abs = await javaForBin('/x/jdtls', { env: {}, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => `JAVA_HOME="\${JAVA_HOME:-${inRepo}}" exec x` });
  assert.match(abs.error, /inside the current project/);
  const relPath = await javaForBin(null, { env: {}, platform: 'linux', cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: true, path: 'bin/java' }), readHead: () => '' });
  assert.match(relPath.error, /not an absolute path, so it was not run/);
  const onPath = await javaForBin(null, { env: {}, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: true, path: javaOf(inRepo) }), readHead: () => '' });
  assert.match(onPath.error, /inside the current project/);
  assert.deepEqual(exec.calls, []);
});

test('F1 M1: a JDK outside the project is still probed; the cwd being HOME does not refuse JDKs under HOME', async (t) => {
  const fx = fakeHome(t);
  const jh = join(fx.home, '.sdkman', 'java', '21');
  write(javaOf(jh), '');
  const exec = recExec('21.0.4');
  const r = await javaForBin('/x/jdtls', { env: { JAVA_HOME: jh }, cwd: fx.home, home: fx.home, exec, findBin: () => ({ found: false }), readHead: () => '' });
  assert.equal(r.version, 21);
  assert.deepEqual(exec.calls, [[javaOf(jh), '-version']]);
});

test('F1 M1: the version comes from <JDK>/release without starting any process', async (t) => {
  const fx = fakeHome(t);
  const jh = join(fx.home, 'jdks', 'temurin-25');
  write(javaOf(jh), '');
  write(join(jh, 'release'), 'IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="25.0.1"\nJAVA_VERSION_DATE="2025-10-21"\n');
  const exec = recExec('17'); // would say 17 if it ran
  const head = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  const r = await javaForBin('/x/jdtls', { env: { JAVA_HOME: jh }, cwd: fx.cwd, home: fx.home, exec, findBin: () => ({ found: false }), readHead: head });
  assert.equal(r.version, 25);
  assert.deepEqual(exec.calls, []);
  assert.equal(releaseJavaVersion('JAVA_VERSION="1.8.0_402"'), 8);
  assert.equal(releaseJavaVersion('JAVA_VERSION=21'), 21);
  assert.equal(releaseJavaVersion('IMPLEMENTOR="x"'), null);
});

// ------------------------------------------------------------------ G1-M2: secret key spellings
import { redactArgs, redactPasses, redactText, secretKey } from './redact.mjs';
const S = 'S3cr3tVal9';
test('F1 M2: numbered, plural and *_KEY spellings of secret names are masked', () => {
  const names = ['TOKEN2', 'SECRET1', 'PASSWORD2', 'MYTOKEN_V2', 'DB_PASSWORD_2', 'SECRETS', 'TOKENS', 'PASSWORDS', 'CREDS', 'APIKEYS', 'API_KEYS',
    'ACCESS_KEYS', 'JWT', 'APP_JWT', 'SSHKEY', 'ssh_key', 'ENCRYPTION_KEY', 'SIGNING_KEY', 'LICENSE_KEY', 'SESSION_KEY', 'APP_KEY', 'dbpass',
    'PASSPHRASE', 'passphrase', 'GITHUB_TOKENS', 'credentials2'];
  const leaked = names.filter((k) => redactText(`${k}=${S}`).text.includes(S));
  assert.deepEqual(leaked, []);
  for (const k of names) assert.ok(secretKey(k), k);
});

test('F1 M2: counts, settings and ordinary *_key names stay unmasked', () => {
  const benign = ['max_tokens', 'max_completion_tokens', 'prompt_tokens', 'input_tokens', 'total_tokens', 'num_tokens', 'TOKENS_USED', 'KEYBOARD',
    'MONKEY', 'keyboard_layout', 'primary_key', 'sort_key', 'cache_key', 'partition_key', 'public_key', 'AUTH0_DOMAIN', 'OAUTH2_SCOPE',
    'passthrough', 'bypass', 'compass', 'tokenizer', 'JWT_ALGORITHM', 'JWT_ISSUER', 'client_id', 'sessions'];
  assert.deepEqual(benign.filter((k) => secretKey(k)), []);
  // the bare plural `tokens` with a plain number is a usage count, also in JSON, flags and argv
  for (const t of ['tokens: 1200', '"tokens": "1200"', 'run --tokens 1200', '<tokens>1200</tokens>']) assert.equal(redactText(t).text, t);
  assert.deepEqual(redactArgs(['--tokens', '1200']).args, ['--tokens', '1200']);
  assert.equal(redactText(`TOKENS=${S}`).text, 'TOKENS=***');
});

// ------------------------------------------------------------------ G2-M1: --flag VALUE inside a quoted command
test('F1 G2-M1: a secret --flag VALUE inside a quoted command string is masked', () => {
  const cases = [
    `bash -c "notify --api-key ${S} --msg done"`,
    `sh -c 'tool --password ${S} go'`,
    `docker exec c sh -c 'x --client-secret ${S}'`,
    `sh -c "a 'b --secret ${S}'"`,
    `ssh host -t "deploy --token ${S}"`,
  ];
  for (const c of cases) {
    const r = redactText(c);
    assert.ok(!r.text.includes(S), c);
    assert.ok(r.hits.length > 0, c);
  }
  // the quotes and everything else stay as they were
  assert.equal(redactText(`bash -c "notify --api-key ${S} --msg done"`).text, 'bash -c "notify --api-key *** --msg done"');
  assert.equal(redactText('bash -c "echo --verbose hi"').text, 'bash -c "echo --verbose hi"');
});

// ------------------------------------------------------------------ G1/G2 minors: known token formats
test('F1 L7: npm, Hugging Face, PyPI, Slack app, Google, SendGrid, Linear, Figma tokens, webhook URLs and PEM keys are masked', () => {
  const X = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4P5q6';
  const forms = [`npm_${X}`, `hf_${X}`, `pypi-AgEIcHlwaS5vcmc${X}${X}`, `xapp-1-A0B1C2D3E4-123-${X}`, `ya29.${X}`, `SG.${X}.${X}`,
    `shpat_${X}`, `lin_api_${X}`, `figd_${X}`, `pplx-${X}`,
    `https://hooks.slack.com/services/T0001/B0002/${X}`, `curl -X POST https://discord.com/api/webhooks/123456/${X}`,
    `https://api.telegram.org/bot123456:${X}/getMe`, `hooks.slack.com/services/T0/B0/${X}`,
    `-----BEGIN RSA PRIVATE KEY-----\n${X}\n-----END RSA PRIVATE KEY-----`, `{"k":"-----BEGIN PRIVATE KEY-----\\n${X}\\n-----END PRIVATE KEY-----\\n"}`,
    `-----BEGIN OPENSSH PRIVATE KEY-----\n${X}`, `<password>${X}</password>`, `<passphrase> ${X} </passphrase>`];
  assert.deepEqual(forms.filter((f) => redactText(f).text.includes(X)), []);
  assert.equal(redactText('https://hooks.slack.com/services/T0/B0/zzz').text, 'https://hooks.slack.com/services/***');
  assert.equal(redactText('<name>bob</name> <version>1</version>').text, '<name>bob</name> <version>1</version>');
  assert.equal(redactText('-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----').text, '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----');
});

// ------------------------------------------------------------------ G2-L1: a swallowed key followed by blanks + =
test('F1 G2-L1: the value after a swallowed `?token` + blanks + `=` is masked', () => {
  const t = redactText(`x-api-key=AAAA1111?token\t=BBBB2222`).text;
  assert.ok(!t.includes('BBBB2222') && !t.includes('AAAA1111'), t);
  assert.equal(redactText('token=abc next = 1').text, 'token=*** next = 1');
});

test('F1: the new passes stay linear (PEM, XML pairs, nested quoted flags, = continuations)', () => {
  const fams = { pem: '-----BEGIN PRIVATE KEY-----', xml: '<token>', xmlOpen: '<a>b', quoted: '-c "--x ', quotedS: "-c '--x ", cont: 'token=a =', slack: 'hooks.slack.com/services/' };
  for (const [name, unit] of Object.entries(fams)) {
    const time = (n) => { const s = unit.repeat(Math.ceil(n / unit.length)); let best = Infinity; for (let i = 0; i < 3; i++) { const t0 = process.hrtime.bigint(); redactPasses(s); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); } return best; };
    const small = time(50000); const big = time(200000);
    assert.ok(big < 1500, `${name}: ${big.toFixed(0)} ms on 200k`);
    assert.ok(big < Math.max(small, 2) * 10, `${name}: 50k ${small.toFixed(1)} ms -> 200k ${big.toFixed(1)} ms (quadratic?)`);
  }
});

// ------------------------------------------------------------------ G2-L2 / L3 / L6: host config reads
import { readHosts } from './hosts.mjs';
import { locatePackage } from './options.mjs';
import { spawnSync } from 'node:child_process';
const posix = process.platform !== 'win32';
const json = (f, v) => write(f, JSON.stringify(v));
function pluginHome(t) {
  const fx = fakeHome(t);
  const plug = join(fx.home, 'plugin');
  json(join(fx.home, '.claude', 'settings.json'), { enabledPlugins: { 'p@m': true } });
  json(join(fx.home, '.claude', 'plugins', 'installed_plugins.json'), { plugins: { 'p@m': [{ scope: 'user', installPath: plug }] } });
  return { ...fx, plug };
}
const ccServers = (fx, extra = {}) => {
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: {}, platform: process.platform, managedFile: join(fx.home, 'none'), ...extra });
  return { r, cc: r.hosts.find((h) => h.id === 'claude-code') };
};

test('F1 G2-L2: a plugin.json mcpServers path through a linked folder does not leave the plugin', (t) => {
  const fx = pluginHome(t);
  const outside = join(fx.home, 'outside');
  json(join(outside, 'private.json'), { mcpServers: { LEAKED_SERVER: { command: 'node' } } });
  json(join(fx.plug, 'own.json'), { mcpServers: { OWN_SERVER: { command: 'node' } } });
  symlinkSync(outside, join(fx.plug, 'lnk'), 'junction');
  json(join(fx.plug, '.claude-plugin', 'plugin.json'), { name: 'p', mcpServers: ['./lnk/private.json', './own.json'] });
  const { cc } = ccServers(fx);
  const names = cc.servers.map((s) => s.name);
  assert.ok(names.includes('OWN_SERVER'), names.join());
  assert.ok(!names.includes('LEAKED_SERVER'), names.join());
  assert.ok(cc.files.some((f) => /outside the plugin folder/.test(f.error ?? '')), JSON.stringify(cc.files));
});

test('F1 G2-L2: a linked .claude-plugin folder is not followed out of the plugin', (t) => {
  const fx = pluginHome(t);
  const outside = join(fx.home, 'elsewhere');
  json(join(outside, 'plugin.json'), { name: 'p', mcpServers: { FROM_LINKED_DIR: { command: 'node' } } });
  mkdirSync(fx.plug, { recursive: true });
  symlinkSync(outside, join(fx.plug, '.claude-plugin'), 'junction');
  const { cc } = ccServers(fx);
  assert.ok(!cc.servers.some((s) => s.name === 'FROM_LINKED_DIR'));
});

test('F1 G2-L3: a FIFO as a plugin .mcp.json is skipped, not read (the scan used to hang)', { skip: !posix && 'mkfifo: POSIX only' }, (t) => {
  const fx = pluginHome(t);
  mkdirSync(fx.plug, { recursive: true });
  const r = spawnSync('mkfifo', [join(fx.plug, '.mcp.json')]);
  if (r.status !== 0) return t.skip('mkfifo not available');
  // run in a child with a timeout: under the bug readFileSync blocks forever
  const code = `import { readHosts } from ${JSON.stringify(new URL('./hosts.mjs', import.meta.url).href)};
    const r = readHosts({ home: ${JSON.stringify(fx.home)}, cwd: ${JSON.stringify(fx.cwd)}, env: {}, managedFile: ${JSON.stringify(join(fx.home, 'none'))} });
    console.log(JSON.stringify(r.hosts.find((h) => h.id === 'claude-code').files.filter((f) => f.scope === 'plugin')));`;
  const c = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 10000 });
  assert.equal(c.status, 0, `readHosts did not return (signal ${c.signal})`);
  assert.match(c.stdout, /not a regular file, skipped/);
});

test('F1 G2-L6: a WSL Windows-side config that is a link is not followed', { skip: !posix && 'WSL paths are POSIX; file links need privileges on Windows' }, (t) => {
  const fx = fakeHome(t);
  const mnt = join(fx.home, 'mnt', 'c');
  const outside = join(fx.home, 'outside');
  json(join(outside, 'x.json'), { mcpServers: { FROM_OUTSIDE: { command: 'node' } } });
  mkdirSync(join(mnt, 'Users', 'alice'), { recursive: true });
  symlinkSync(join(outside, 'x.json'), join(mnt, 'Users', 'alice', '.claude.json'));
  const r = readHosts({ home: fx.home, cwd: fx.cwd, env: { WSL_DISTRO_NAME: 'Ubuntu', USER: 'alice' }, platform: 'linux', managedFile: join(fx.home, 'none'), wslMount: mnt });
  const cc = r.hosts.find((h) => h.id === 'claude-code');
  assert.ok(!cc.servers.some((s) => s.name === 'FROM_OUTSIDE'));
  assert.ok(r.notes.some((n) => /a link; not followed/.test(n)), r.notes.join('\n'));
});

// ------------------------------------------------------------------ G2-L5: --run-help never picks a linked-out global copy
test('F1 G2-L5: a global package that is a link out of its node_modules is listed, never chosen', (t) => {
  const fx = fakeHome(t);
  const modules = join(fx.home, '.bun', 'install', 'global', 'node_modules');
  const elsewhere = join(fx.home, 'downloaded');
  json(join(elsewhere, 'package.json'), { name: 'some-mcp', version: '9.9.9' });
  mkdirSync(modules, { recursive: true });
  symlinkSync(elsewhere, join(modules, 'some-mcp'), 'junction');
  const globalDirs = [{ manager: 'bun', modules: [modules], bins: [] }];
  const loc = locatePackage('some-mcp', { home: fx.home, cwd: fx.home, env: {}, globalDirs });
  assert.equal(loc.chosen, null);
  assert.equal(loc.candidates.length, 1);
  assert.equal(loc.candidates[0].trusted, false);
  // a real folder there is still chosen; so is pnpm's link into its own .pnpm store
  rmSync(join(modules, 'some-mcp'), { recursive: true, force: true });
  json(join(modules, 'some-mcp', 'package.json'), { name: 'some-mcp', version: '1.0.0' });
  assert.equal(locatePackage('some-mcp', { home: fx.home, cwd: fx.home, env: {}, globalDirs }).chosen?.version, '1.0.0');
  const v = join(fx.home, 'pnpm', 'global', '5');
  json(join(v, '.pnpm', 'other-mcp@2.0.0', 'node_modules', 'other-mcp', 'package.json'), { name: 'other-mcp', version: '2.0.0' });
  mkdirSync(join(v, 'node_modules'), { recursive: true });
  symlinkSync(join(v, '.pnpm', 'other-mcp@2.0.0', 'node_modules', 'other-mcp'), join(v, 'node_modules', 'other-mcp'), 'junction');
  assert.equal(locatePackage('other-mcp', { home: fx.home, cwd: fx.home, env: {}, globalDirs: [{ manager: 'pnpm', modules: [join(v, 'node_modules')], bins: [] }] }).chosen?.version, '2.0.0');
});
