// Gaps found by the owner's first real /kk-onboard run (#21, unit I7b): the Java jdtls will start on, the no-terminal
// form of `bantamkit-mcp --install-hooks`, and MCP/hook commands that point into one node version of a version manager.
// Stdlib only. Every fixture is a fake HOME under os.tmpdir(); no real java, jdtls or bantamkit-mcp is ever run
// (exec is a stub that records its calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  run, parseJavaVersion, wrapperJavaHome, javaForBin, requiresRuntimeNotes, JAVA_TIMEOUT_MS,
  nodeVersionPathOf, nodeVersionPathState,
} from './inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(readFileSync(join(HERE, '..', 'pack.json'), 'utf8'));
const PLUGIN = join(HERE, '..', '..', '..');

function fakeHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'kk-i7b-'));
  t.after(() => { try { rmSync(home, { recursive: true, force: true }); } catch {} });
  const cwd = join(home, 'proj');
  mkdirSync(cwd, { recursive: true });
  return { home, cwd };
}
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };
const stubClaude = () => async (args) => {
  const key = args.join(' ');
  if (key === 'plugin list --json' || key === 'plugin marketplace list --json') return { ok: true, stdout: '[]' };
  return { ok: true, stdout: '' };
};
/** exec stub: answers `<java> -version` with the version mapped to that java path; records every call */
function javaExec(versions, calls = []) {
  const fn = async (cmd, args, ms, o) => {
    calls.push({ cmd, args, ms, o });
    if (cmd === '/usr/libexec/java_home') return versions.javaHome ? { ok: true, stdout: versions.javaHome + '\n', stderr: '' } : { ok: false, code: 1, error: 'Unable to locate a Java Runtime.' };
    const v = versions[cmd];
    if (v === 'timeout') return { ok: false, code: 'ETIMEDOUT', error: 'timed out after 10 s' };
    if (v == null) return { ok: false, code: 'ENOENT', error: 'not stubbed' };
    return { ok: true, stdout: '', stderr: `openjdk version "${v}" 2025-09-16\nOpenJDK Runtime Environment Temurin\n` };
  };
  fn.calls = calls;
  return fn;
}
const javaOf = (home) => join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
function jdk(root, name) { const h = join(root, 'jdks', name); write(javaOf(h), ''); return h; }
const JDTLS_PACK = { items: [{ id: 'jdtls-lsp', kind: 'plugin', plugin: 'jdtls-lsp@x', detect: { plugins: ['jdtls-lsp@'] }, requires: [{ bin: 'jdtls', install: 'brew install jdtls', java: 25 }] }] };

// ------------------------------------------------------------------ 1. the Java jdtls will start on
test('#21 java: parseJavaVersion reads the feature version of every java -version style', () => {
  assert.equal(parseJavaVersion('openjdk version "21.0.2" 2024-01-16'), 21);
  assert.equal(parseJavaVersion('Picked up JAVA_TOOL_OPTIONS: -Dx=1\nopenjdk version "25" 2025-09-16'), 25);
  assert.equal(parseJavaVersion('java version "1.8.0_391"'), 8);
  assert.equal(parseJavaVersion('openjdk 17.0.16 2025-07-15'), 17); // `java --version` style
  assert.equal(parseJavaVersion('Error: could not find libjava'), null);
});

test('#21 java: pack.json jdtls requires Java 25 (the jdtls 1.63+ floor)', () => {
  const jd = PACK.items.find((i) => i.id === 'jdtls-lsp');
  assert.equal(jd.requires.find((r) => r.bin === 'jdtls').java, 25);
});

test('#21 java: $JAVA_HOME below the floor gives a requires note naming the version and where it comes from', async (t) => {
  const fx = fakeHome(t);
  const j17 = jdk(fx.home, 'temurin-17');
  const exec = javaExec({ [javaOf(j17)]: '17.0.16' });
  const notes = await requiresRuntimeNotes(JDTLS_PACK, { findBin: (b) => (b === 'jdtls' ? { found: true, path: '/opt/homebrew/bin/jdtls' } : { found: false }), env: { JAVA_HOME: j17 }, exec, readHead: () => '' });
  const [n] = notes['jdtls-lsp'];
  assert.equal(n.java, 17);
  assert.equal(n.needs, 25);
  assert.match(n.note, /will start on Java 17 from \$JAVA_HOME/);
  assert.match(n.note, /needs Java 25\+/);
  // only `<java> -version`, with the timeout; jdtls itself never runs
  assert.deepEqual(exec.calls.map((c) => [c.cmd, ...c.args]), [[javaOf(j17), '-version']]);
  assert.equal(exec.calls[0].ms, JAVA_TIMEOUT_MS);
  assert.ok(JAVA_TIMEOUT_MS > 0 && JAVA_TIMEOUT_MS <= 15000);
});

test('#21 java: Java 25 (exactly the floor) gives no note', async (t) => {
  const fx = fakeHome(t);
  const j25 = jdk(fx.home, 'temurin-25');
  const notes = await requiresRuntimeNotes(JDTLS_PACK, { findBin: () => ({ found: true, path: '/x/jdtls' }), env: { JAVA_HOME: j25 }, exec: javaExec({ [javaOf(j25)]: '25.0.1' }), readHead: () => '' });
  assert.deepEqual(notes, {});
});

test('#21 java: $JAVA_HOME wins over the wrapper default and over java on PATH (what the brew wrapper does)', async (t) => {
  const fx = fakeHome(t);
  const j21 = jdk(fx.home, 'mise-21'); const brew = jdk(fx.home, 'brew-openjdk'); const onPath = jdk(fx.home, 'path');
  const wrapper = `#!/bin/bash\nJAVA_HOME="\${JAVA_HOME:-${brew}}" exec "/opt/homebrew/Cellar/jdtls/1.63.0/libexec/bin/jdtls"  "$@"\n`;
  const versions = { [javaOf(j21)]: '21.0.5', [javaOf(brew)]: '25.0.1', [javaOf(onPath)]: '25.0.1' };
  const findBin = (b) => (b === 'java' ? { found: true, path: javaOf(onPath) } : { found: true, path: '/x/jdtls' });
  const r = await javaForBin('/x/jdtls', { env: { JAVA_HOME: j21 }, exec: javaExec(versions), findBin, readHead: () => wrapper });
  assert.equal(r.version, 21);
  assert.match(r.from, /^\$JAVA_HOME/);
  // without JAVA_HOME: the wrapper's own default (Homebrew openjdk), not java on PATH
  const r2 = await javaForBin('/x/jdtls', { env: {}, exec: javaExec({ ...versions, [javaOf(onPath)]: '17' }), findBin, readHead: () => wrapper });
  assert.equal(r2.java, javaOf(brew));
  assert.equal(r2.version, 25);
  assert.equal(wrapperJavaHome(wrapper), brew);
  // no JAVA_HOME and no wrapper default: java on PATH
  const r3 = await javaForBin('/x/jdtls', { env: {}, exec: javaExec({ [javaOf(onPath)]: '17.0.2' }), findBin, readHead: () => '#!/bin/sh\nexec java -jar x.jar' });
  assert.equal(r3.version, 17);
  assert.match(r3.from, /^java on PATH/);
});

test('#21 java: macOS /usr/bin/java stub is resolved through /usr/libexec/java_home, never run itself', { skip: process.platform === 'win32' && 'darwin path rules on a POSIX fixture' }, async (t) => {
  const fx = fakeHome(t);
  const home = jdk(fx.home, 'Home');
  const exec = javaExec({ javaHome: home, [javaOf(home)]: '21.0.1' });
  const r = await javaForBin(null, { env: {}, platform: 'darwin', exec, findBin: () => ({ found: true, path: '/usr/bin/java' }), readHead: () => '' });
  assert.equal(r.version, 21);
  assert.ok(!exec.calls.some((c) => c.cmd === '/usr/bin/java'), 'the stub can pop up an install dialog');
  const none = await javaForBin(null, { env: {}, platform: 'darwin', exec: javaExec({}), findBin: () => ({ found: true, path: '/usr/bin/java' }), readHead: () => '' });
  assert.equal(none.version, null);
  assert.match(none.error, /no JDK is installed/);
});

test('#21 java: a java that times out or is missing gives an "could not tell" note, not silence', async (t) => {
  const fx = fakeHome(t);
  const j = jdk(fx.home, 'slow');
  const findBin = () => ({ found: true, path: '/x/jdtls' });
  const slow = await requiresRuntimeNotes(JDTLS_PACK, { findBin, env: { JAVA_HOME: j }, exec: javaExec({ [javaOf(j)]: 'timeout' }), readHead: () => '' });
  assert.match(slow['jdtls-lsp'][0].note, /could not tell which Java jdtls will use \(`java -version` failed: timed out/);
  const gone = await requiresRuntimeNotes(JDTLS_PACK, { findBin, env: { JAVA_HOME: join(fx.home, 'nope') }, exec: javaExec({}), readHead: () => '' });
  assert.match(gone['jdtls-lsp'][0].note, /does not exist/);
  // jdtls not on PATH: nothing to check here (missingBins covers it), and no process is started
  const exec = javaExec({});
  assert.deepEqual(await requiresRuntimeNotes(JDTLS_PACK, { findBin: () => ({ found: false }), env: { JAVA_HOME: j }, exec }), {});
  assert.equal(exec.calls.length, 0);
});

test('#21 java: inventory run() puts the note on the jdtls item as requiresNotes', async (t) => {
  const fx = fakeHome(t);
  const j17 = jdk(fx.home, 'temurin-17');
  const out = await run(['--fast'], {
    home: fx.home, cwd: fx.cwd, env: { JAVA_HOME: j17 }, pack: PACK, execClaude: stubClaude(), globalDirs: [],
    findBin: (b) => (b === 'jdtls' ? { found: true, path: join(fx.home, 'no-such-jdtls') } : { found: b !== 'java' }),
    exec: javaExec({ [javaOf(j17)]: '17.0.16' }),
  });
  assert.ok(!out.error, JSON.stringify(out.notes));
  const jd = out.pack.find((p) => p.id === 'jdtls-lsp');
  assert.equal(jd.requiresNotes.length, 1);
  assert.match(jd.requiresNotes[0].note, /Java 17 from \$JAVA_HOME \(~/); // HOME shortened to ~
  assert.equal(out.pack.find((p) => p.id === 'gopls-lsp').requiresNotes, undefined);
});

// ------------------------------------------------------------------ 3. version-manager node paths
test('#21 node paths: nodeVersionPathOf knows mise, nvm, fnm, asdf and Volta layouts, and nothing else', () => {
  const cases = [
    ['/Users/a/.local/share/mise/installs/node/26.13.0/bin/bantamkit-mcp', 'mise', '26.13.0'],
    ['/home/a/.nvm/versions/node/v22.11.0/bin/pyright-langserver', 'nvm', 'v22.11.0'],
    ['/home/a/.local/share/fnm/node-versions/v24.1.0/installation/bin/x', 'fnm', 'v24.1.0'],
    ['/home/a/.asdf/installs/nodejs/20.19.0/bin/x', 'asdf', '20.19.0'],
    ['C:\\Users\\a\\AppData\\Local\\mise\\installs\\node\\24.0.0\\bantamkit-mcp.cmd', 'mise', '24.0.0'],
    ['/home/a/.volta/tools/image/node/22.0.0/bin/node', 'volta', '22.0.0'],
  ];
  for (const [p, manager, version] of cases) {
    const hit = nodeVersionPathOf(p);
    assert.equal(hit?.manager, manager, p);
    assert.equal(hit.version, version);
    assert.ok(p.startsWith(hit.versionDir) && hit.versionDir.endsWith(version));
  }
  for (const p of ['bantamkit-mcp', '/opt/homebrew/bin/bantamkit-mcp', '/home/a/.volta/bin/bantamkit-mcp', 'relative/mise/installs/node/1.2.3/x']) assert.equal(nodeVersionPathOf(p), null, p);
});

test('#21 node paths: state is gone / not-active / fine, and an alias dir (mise latest, 26) is fine', () => {
  const hit = (version) => ({ manager: 'mise', versionDir: `/m/installs/node/${version}`, version });
  const dir = { isSymbolicLink: () => false };
  const link = { isSymbolicLink: () => true };
  const lstat = (table) => (p) => { if (table[p]) return table[p]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  assert.equal(nodeVersionPathState(hit('20.0.0'), { activeVersion: '24.1.0', lstat: lstat({}) }), 'gone');
  assert.equal(nodeVersionPathState(hit('22.0.0'), { activeVersion: '24.1.0', lstat: lstat({ '/m/installs/node/22.0.0': dir }) }), 'not-active');
  assert.equal(nodeVersionPathState(hit('24.1.0'), { activeVersion: '24.1.0', lstat: lstat({ '/m/installs/node/24.1.0': dir }) }), null);
  assert.equal(nodeVersionPathState({ ...hit('v24.1.0'), manager: 'nvm' }, { activeVersion: '24.1.0', lstat: lstat({ '/m/installs/node/v24.1.0': dir }) }), null);
  assert.equal(nodeVersionPathState(hit('latest'), { activeVersion: '24.1.0', lstat: lstat({ '/m/installs/node/latest': link }) }), null);
  assert.equal(nodeVersionPathState(hit('26'), { activeVersion: '24.1.0', lstat: lstat({ '/m/installs/node/26': dir }) }), null, 'fuzzy alias dir');
});

test('#21 node paths: inventory flags MCP and hook commands in a removed or inactive node version (read-only)', async (t) => {
  const fx = fakeHome(t);
  const inst = join(fx.home, '.local', 'share', 'mise', 'installs', 'node');
  mkdirSync(join(inst, '22.5.0', 'bin'), { recursive: true }); // still installed, not active
  mkdirSync(join(inst, '24.1.0', 'bin'), { recursive: true }); // active
  write(join(fx.home, '.claude.json'), {
    mcpServers: {
      gone: { command: join(inst, '20.0.0', 'bin', 'bantamkit-mcp') },
      old: { command: 'node', args: [join(inst, '22.5.0', 'lib', 'node_modules', 'x', 'cli.js')] },
      fine: { command: join(inst, '24.1.0', 'bin', 'y') },
      plain: { command: 'bantamkit-mcp' },
    },
  });
  const hook = (cmd) => [{ hooks: [{ type: 'command', command: cmd }] }];
  write(join(fx.home, '.claude', 'settings.json'), { hooks: { SessionStart: hook(`"${join(inst, '20.0.0', 'bin', 'bantamkit-mcp')}" --hook`), PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: `"${join(inst, '20.0.0', 'bin', 'bantamkit-mcp')}" --hook` }] }] } });
  const out = await run(['--fast'], { home: fx.home, cwd: fx.cwd, env: {}, pack: { items: [] }, execClaude: stubClaude(), globalDirs: [], findBin: () => ({ found: true }), nodeVersion: '24.1.0' });
  const f = out.findings.filter((x) => x.category === 'node-version-path');
  const titles = f.map((x) => x.title).sort();
  assert.deepEqual(titles, [
    'MCP "gone" runs from mise node 20.0.0, which is no longer installed',
    'MCP "old" runs from mise node 22.5.0, which is not the node running now (24.1.0)',
    'hooks run from mise node 20.0.0, which is no longer installed',
  ]);
  const hookF = f.find((x) => x.title.startsWith('hooks'));
  assert.ok(hookF.evidence.includes('events: SessionStart, PreToolUse'), hookF.evidence.join(' | '));
  assert.equal(hookF.type, 'risk');
  assert.ok(hookF.evidence.some((e) => e.startsWith('path: ~')), 'HOME is shortened');
});

// ------------------------------------------------------------------ 2. --install-hooks without a terminal needs --yes
const HOOK_DOCS = {
  'kk-onboard SKILL.md': join(HERE, '..', 'SKILL.md'),
  'kk-update SKILL.md': join(PLUGIN, 'skills', 'kk-update', 'SKILL.md'),
  'docs/bantamkit-hooks.md': join(PLUGIN, 'docs', 'bantamkit-hooks.md'),
};
const paragraphs = (text) => text.split(/\r?\n\s*\r?\n/);

test('#21 hooks: every file that tells the model to install hooks gives the --yes form, gated on the user\'s yes in chat', () => {
  for (const [name, file] of Object.entries(HOOK_DOCS)) {
    const text = readFileSync(file, 'utf8');
    assert.ok(text.includes('`bantamkit-mcp --install-hooks --yes`'), `${name}: the model-run form needs --yes (no TTY in the Bash tool)`);
    assert.ok(/`bantamkit-mcp --install-hooks`/.test(text), `${name}: first the probe without --yes (exit 0 = already installed, 2 = needs consent)`);
    for (const p of paragraphs(text).filter((x) => /--(install|remove)-hooks --yes/.test(x))) {
      assert.match(p, /\b(after|only after)\b[^.]*\b(yes|approv)/i, `${name}: --yes must come only after the user's yes: ${p.slice(0, 120)}`);
    }
  }
});

test('#21 hooks: no file invents a flag bantamkit-mcp does not have, and pack.json steps never run --install-hooks unasked', () => {
  const real = new Set(['--install-hooks', '--remove-hooks', '--yes', '--hook', '--help', '--update', '--install', '--force', '--store', '--start', '--statusline', '--mcp-report', '--assets-root', '--k', '--index-budget']);
  for (const [name, file] of Object.entries(HOOK_DOCS)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/bantamkit-mcp((?:\s+--[a-z-]+)+)/g)) {
      for (const flag of m[1].trim().split(/\s+/)) assert.ok(real.has(flag), `${name}: bantamkit-mcp has no ${flag}`);
    }
  }
  for (const it of PACK.items) for (const s of [...(it.steps ?? []), ...(it.windows ?? [])]) assert.ok(!/--install-hooks/.test(s), `${it.id}: hooks are opt-in, never a pack step`);
});

test('#21 hooks: /kk-update re-runs the hook check after its updates (node upgrade moves the hook path)', () => {
  const text = readFileSync(HOOK_DOCS['kk-update SKILL.md'], 'utf8');
  const step = paragraphs(text).find((p) => /bantamkit hooks and a node upgrade/.test(p));
  assert.ok(step, 'kk-update has the hook re-check step');
  assert.match(step, /without\*\* `--yes`/);
  assert.match(step, /Exit 2/);
  assert.match(step, /mise, nvm, fnm, asdf, Volta/);
});
