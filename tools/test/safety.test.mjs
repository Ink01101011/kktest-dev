// Regression tests for the 1.0.0 release-gate findings (G1/G2/G3): safe writes, project containment,
// export deletion, Windows robustness. Every test runs on a fake HOME under the test temp root.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../lib/catalog.mjs';
import { applyPlan, planInstall } from '../lib/install.mjs';
import { ApplyError, atomicWrite, backupFile, checkTarget, renameRetry } from '../lib/safefs.mjs';
import { ROOT, runCli, tmpdir } from './helpers.mjs';

const cat = loadCatalog(ROOT);
const posix = process.platform !== 'win32';
const mode = (f) => fs.statSync(f).mode & 0o777;
const read = (f) => fs.readFileSync(f, 'utf8');
const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
const SECRET = 'FAKE-TOKEN-NOT-REAL';

/** Patch one method of the shared fs object for the duration of fn (the lib uses the same object). */
function patched(name, impl, fn) {
  const real = fs[name];
  fs[name] = (...a) => impl(real, ...a);
  try {
    return fn();
  } finally {
    fs[name] = real;
  }
}

test('G1-01/G2-03: a 0600 config stays 0600 after --apply; a new config is created 0600', { skip: !posix && 'POSIX modes' }, () => {
  const home = tmpdir();
  const codex = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(codex));
  fs.writeFileSync(codex, `[mcp_servers.other.env]\nAPI_TOKEN = "${SECRET}"\n`, { mode: 0o600 });
  fs.chmodSync(codex, 0o600);
  const r = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(read(codex), /\[mcp_servers\.loop-ledger\]/);
  assert.equal(mode(codex), 0o600);
  assert.ok(!r.stdout.includes(SECRET));

  const cursor = path.join(home, '.cursor', 'mcp.json');
  const n = runCli(['install', '--target', 'cursor', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(n.code, 0, n.stdout + n.stderr);
  assert.equal(mode(cursor), 0o600, 'new config file');

  fs.chmodSync(cursor, 0o640);
  const g = runCli(['install', '--target', 'cursor', '--only', 'mcp', '--plugin', 'reflexion', '--apply', '--yes'], { home });
  assert.equal(g.code, 0, g.stdout + g.stderr);
  assert.equal(mode(cursor), 0o640, 'existing mode kept, not widened or narrowed');
});

test('G1-01: the kept mode is not narrowed by a strict umask', { skip: !posix && 'POSIX modes' }, () => {
  const dir = tmpdir();
  const f = path.join(dir, 'settings.json');
  const old = process.umask(0o077);
  try {
    atomicWrite(f, '{}', { mode: 0o644 });
  } finally {
    process.umask(old);
  }
  assert.equal(mode(f), 0o644);
});

test('G1-03/G2-03: a user config symlinked into HOME (dotfiles) keeps its link; the real file is updated', { skip: !posix && 'symlinks' }, () => {
  const home = tmpdir();
  const real = path.join(home, 'dotfiles', 'gemini', 'settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, '{"theme":"x"}\n', { mode: 0o600 });
  fs.chmodSync(real, 0o600);
  const link = path.join(home, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync('../dotfiles/gemini/settings.json', link);
  const r = runCli(['install', '--target', 'gemini', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'link kept');
  assert.equal(JSON.parse(read(real)).theme, 'x');
  assert.ok(JSON.parse(read(real)).mcpServers['loop-ledger']);
  assert.equal(mode(real), 0o600);
  assert.equal(ls(path.dirname(real)).filter((f) => f.includes('.bak-')).length, 1, 'backup sits next to the real file');
  assert.deepEqual(ls(path.dirname(link)), ['settings.json']);
});

test('user config symlinked outside its folder is refused (dry run too), with the snippet to paste', { skip: !posix && 'symlinks' }, () => {
  const home = tmpdir();
  const outside = path.join(tmpdir(), 'elsewhere.json');
  fs.writeFileSync(outside, '{}');
  fs.mkdirSync(path.join(home, '.cursor'));
  fs.symlinkSync(outside, path.join(home, '.cursor', 'mcp.json'));
  for (const extra of [[], ['--apply', '--yes']]) {
    const r = runCli(['install', '--target', 'cursor', '--only', 'mcp', '--plugin', 'loop-ledger', ...extra], { home });
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stdout, /REFUSED: .*mcp\.json is a symbolic link to .*elsewhere\.json, outside/);
    assert.match(r.stdout, /"loop-ledger"/, 'snippet printed');
  }
  assert.equal(read(outside), '{}');
  assert.ok(fs.lstatSync(path.join(home, '.cursor', 'mcp.json')).isSymbolicLink());
});

test('G2-02: project scope refuses a symlinked config or folder; nothing is read into the repo (PoC p1)', { skip: !posix && 'symlinks' }, () => {
  const home = tmpdir();
  const secret = path.join(home, '.ssh', 'id_fake');
  fs.mkdirSync(path.dirname(secret));
  fs.writeFileSync(secret, `-----BEGIN FAKEKEYMATERIAL-----\n${SECRET}\n`, { mode: 0o600 });
  const cases = [
    ['codex', '.codex/config.toml', (repo) => (fs.mkdirSync(path.join(repo, '.codex')), fs.symlinkSync(secret, path.join(repo, '.codex', 'config.toml')))],
    ['codex', '.codex (folder)', (repo) => fs.symlinkSync(path.dirname(secret), path.join(repo, '.codex'))],
    ['cursor', '.cursor/mcp.json', (repo) => (fs.mkdirSync(path.join(repo, '.cursor')), fs.symlinkSync(secret, path.join(repo, '.cursor', 'mcp.json')))],
    ['agents', '.agents/skills', (repo) => (fs.mkdirSync(path.join(repo, '.agents')), fs.symlinkSync(path.dirname(secret), path.join(repo, '.agents', 'skills')))],
  ];
  for (const [target, label, plant] of cases) {
    const repo = tmpdir();
    plant(repo);
    for (const extra of [[], ['--apply', '--yes']]) {
      const r = runCli(['install', '--target', target, '--scope', 'project', ...extra], { home, cwd: repo });
      assert.equal(r.code, 2, `${label}: ${r.stdout}`);
      assert.match(r.stdout, /REFUSED: .*is a symbolic link/, label);
      assert.ok(!r.stdout.includes(SECRET), label);
    }
    const found = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (e.isFile() && read(f).includes(SECRET)) found.push(f);
      }
    };
    walk(repo);
    assert.deepEqual(found, [], `${label}: secret copied into the repo`);
    assert.deepEqual(ls(path.dirname(secret)), ['id_fake'], `${label}: no backup or temp file next to the secret`);
  }
});

test('G2-01: the temp file is opened exclusively, so a planted symlink at its name is never followed', { skip: !posix && 'symlinks' }, () => {
  const dir = tmpdir();
  const victim = path.join(dir, 'zshrc');
  fs.writeFileSync(victim, 'original\n');
  const cfg = path.join(dir, 'config.toml');
  fs.writeFileSync(cfg, 'a = 1\n');
  const names = [];
  // Plant a link at whatever temp name is chosen, just before it is opened.
  assert.throws(
    () =>
      patched(
        'openSync',
        (real, p, ...rest) => {
          if (String(p).includes('.kktest-dev.tmp-')) {
            names.push(p);
            fs.symlinkSync(victim, p);
          }
          return real(p, ...rest);
        },
        () => atomicWrite(cfg, 'pwned\n'),
      ),
    /EEXIST/,
  );
  assert.equal(read(victim), 'original\n');
  assert.equal(read(cfg), 'a = 1\n');
  atomicWrite(cfg, 'b = 2\n');
  atomicWrite(cfg, 'c = 3\n');
  assert.equal(read(cfg), 'c = 3\n');
  assert.equal(names.length, 1);
  assert.match(path.basename(names[0]), /^config\.toml\.kktest-dev\.tmp-[0-9a-f]{12}$/, 'random, not the pid');
});

test('G2-01/G1-09: backups are created exclusively with unique names, even with the same timestamp', { skip: !posix && 'symlinks' }, () => {
  const dir = tmpdir();
  const victim = path.join(dir, 'victim');
  fs.writeFileSync(victim, 'original\n');
  const cfg = path.join(dir, 'mcp.json');
  fs.writeFileSync(cfg, '{}', { mode: 0o600 });
  fs.chmodSync(cfg, 0o600);
  const a = backupFile(cfg, 'T');
  const b = backupFile(cfg, 'T');
  assert.notEqual(a, b);
  assert.equal(read(a), '{}');
  assert.equal(mode(a), 0o600);
  assert.throws(
    () =>
      patched(
        'copyFileSync',
        (real, src, dst, flags) => {
          fs.symlinkSync(victim, dst);
          return real(src, dst, flags);
        },
        () => backupFile(cfg, 'T'),
      ),
    /EEXIST/,
  );
  assert.equal(read(victim), 'original\n');
});

test('G2-01: PoC p2 shape: predictable-name links in a project never reach a file outside it', { skip: !posix && 'symlinks' }, () => {
  const home = tmpdir();
  const zshrc = path.join(home, '.zshrc');
  fs.writeFileSync(zshrc, 'export SAFE=1\n');
  const repo = tmpdir();
  fs.mkdirSync(path.join(repo, '.codex'));
  fs.writeFileSync(path.join(repo, '.codex', 'config.toml'), 'model = "x"\n');
  for (let i = 1; i < 400; i++) fs.symlinkSync(zshrc, path.join(repo, '.codex', `config.toml.kktest-dev.tmp-${i}`));
  const r = runCli(['install', '--target', 'codex', '--scope', 'project', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home, cwd: repo });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(read(zshrc), 'export SAFE=1\n');
  assert.match(read(path.join(repo, '.codex', 'config.toml')), /\[mcp_servers\.loop-ledger\]/);
});

test('G2-07: a FIFO or a symlink inside an existing skill folder never hangs or crashes the dry run', { skip: !posix && 'FIFOs' }, () => {
  const home = tmpdir();
  const skill = path.join(home, '.agents', 'skills', 'secret-hygiene');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'mine');
  fs.symlinkSync('/dev/zero', path.join(skill, 'zero'));
  fs.symlinkSync(home, path.join(skill, 'loop'));
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const fifo = spawnSync('mkfifo', [path.join(skill, 'pipe')]);
  const t0 = Date.now();
  const r = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene'], { home, timeout: 10000 });
  assert.ok(Date.now() - t0 < 10000);
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stdout, /already exists with different content/);
  assert.ok(!/EISDIR|at .*\.mjs/.test(r.stderr), r.stderr);
  if (fifo.status !== 0) return;
  assert.ok(fs.lstatSync(path.join(skill, 'pipe')).isFIFO());

  // An exact copy of the skill whose SKILL.md is a link to identical content is not "unchanged".
  const copy = path.join(tmpdir(), 'same.md');
  fs.rmSync(skill, { recursive: true });
  const built = runCli(['export', '--target', 'agents', '--skill', 'secret-hygiene', '--out', path.dirname(copy)], { home });
  assert.equal(built.code, 0, built.stderr);
  fs.cpSync(path.join(path.dirname(copy), '.agents', 'skills', 'secret-hygiene'), skill, { recursive: true });
  fs.renameSync(path.join(skill, 'SKILL.md'), copy);
  fs.symlinkSync(copy, path.join(skill, 'SKILL.md'));
  const l = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene'], { home, timeout: 10000 });
  assert.equal(l.code, 2, l.stdout);
  assert.ok(!/unchanged/.test(l.stdout));
});

test('G2-06: a config that changes between plan and apply is not overwritten', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cfg));
  fs.writeFileSync(cfg, '{"mcpServers":{"mine":{"command":"x"}}}');
  const plan = planInstall(cat, 'cursor', { only: 'mcp', plugin: 'loop-ledger', env: { HOME: home, USERPROFILE: home, APPDATA: home }, cwd: home });
  fs.writeFileSync(cfg, '{"mcpServers":{"mine":{"command":"x"},"other":{"command":"y"}}}');
  assert.throws(() => applyPlan(plan), (e) => e instanceof ApplyError && /changed after the plan/.test(e.message));
  assert.ok(JSON.parse(read(cfg)).mcpServers.other, 'concurrent edit kept');
  assert.deepEqual(ls(path.dirname(cfg)).filter((f) => f.includes('.bak-') || f.includes('.tmp-')), []);
});

test('G2-06: install.lock stops a second concurrent apply; a stale lock is replaced', () => {
  const home = tmpdir();
  const env = { HOME: home, USERPROFILE: home, APPDATA: home };
  const lock = path.join(home, '.kktest-dev', 'install.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, String(process.pid)); // a live pid: this test process
  const plan = planInstall(cat, 'agents', { skill: 'secret-hygiene', env, cwd: home });
  assert.throws(() => applyPlan(plan), (e) => e instanceof ApplyError && /another kktest-dev install is running/.test(e.message));
  assert.ok(!fs.existsSync(path.join(home, '.agents')));
  fs.writeFileSync(lock, ''); // being created by another process: not stale (PoC p4 race)
  assert.throws(() => applyPlan(plan), (e) => e instanceof ApplyError && /running \(pid \?\)/.test(e.message));
  fs.writeFileSync(lock, '2147483646'); // no such process
  applyPlan(plan);
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'secret-hygiene', 'SKILL.md')));
  assert.ok(!fs.existsSync(lock), 'lock released');
});

function forcedReplace(scopeOpts = {}) {
  const home = tmpdir();
  const base = scopeOpts.scope === 'project' ? tmpdir() : home;
  const skill = path.join(base, '.agents', 'skills', 'secret-hygiene');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'my own skill');
  const plan = planInstall(cat, 'agents', { skill: 'secret-hygiene', force: true, env: { HOME: home }, platform: 'darwin', cwd: base, timestamp: 'T', ...scopeOpts });
  return { home, skill, skillsDir: path.dirname(skill), plan, backup: path.join(home, '.kktest-dev', 'backups', 'T', 'skills', 'secret-hygiene') };
}

test('G3-X1/G1-06: replacing a project skill works when the backup folder is on another volume (EXDEV)', () => {
  const { home, skill, skillsDir, plan, backup } = forcedReplace({ scope: 'project' });
  const crossing = (a, b) => a.startsWith(home) !== b.startsWith(home);
  const out = [];
  patched(
    'renameSync',
    (real, a, b) => {
      if (crossing(a, b)) throw Object.assign(new Error(`EXDEV: cross-device link not permitted, rename '${a}' -> '${b}'`), { code: 'EXDEV' });
      return real(a, b);
    },
    () => applyPlan(plan, { log: (l) => out.push(l) }),
  );
  assert.match(read(path.join(skill, 'SKILL.md')), /^---\nname: secret-hygiene/);
  assert.equal(read(path.join(backup, 'SKILL.md')), 'my own skill');
  assert.deepEqual(ls(skillsDir), ['secret-hygiene'], 'no temp folder left in the skills folder');
  assert.ok(out.some((l) => l.includes(backup)), 'backup path printed');
});

test('G3-X2: a rename that keeps failing restores the old skill, removes the temp folder, names the backup', () => {
  const { skill, skillsDir, plan } = forcedReplace();
  const eperm = (real, a, b) => {
    if (String(a).includes('.kktest-dev.tmp-')) throw Object.assign(new Error(`EPERM: operation not permitted, rename '${a}'`), { code: 'EPERM' });
    return real(a, b);
  };
  assert.throws(
    () => patched('renameSync', eperm, () => applyPlan(plan)),
    (e) => e instanceof ApplyError && /EPERM/.test(e.message) && /put back in place/.test(e.message),
  );
  assert.equal(read(path.join(skill, 'SKILL.md')), 'my own skill', 'previous skill restored');
  assert.deepEqual(ls(skillsDir), ['secret-hygiene'], 'temp folder removed');
});

test('G3-X2: on win32 a transient EPERM/EBUSY/EACCES on rename is retried; elsewhere it is not', () => {
  const dir = tmpdir();
  const src = path.join(dir, 'a');
  fs.mkdirSync(src);
  let fails = 0;
  const flaky = (real, a, b) => {
    if (fails < 3) {
      fails++;
      throw Object.assign(new Error('busy'), { code: ['EBUSY', 'EPERM', 'EACCES'][fails - 1] });
    }
    return real(a, b);
  };
  patched('renameSync', flaky, () => renameRetry(src, path.join(dir, 'b'), { platform: 'win32', delays: [1, 1, 1, 1] }));
  assert.equal(fails, 3);
  assert.ok(fs.existsSync(path.join(dir, 'b')));
  fails = 0;
  assert.throws(() => patched('renameSync', flaky, () => renameRetry(path.join(dir, 'b'), src, { platform: 'darwin' })), /busy/);
  fails = 0;
  assert.throws(() => patched('renameSync', flaky, () => renameRetry(path.join(dir, 'b'), src, { platform: 'win32', delays: [1] })), /busy/, 'gives up after the backoff');
});

test('G3-X2: the CLI turns an apply failure into one ERROR: line and exit 2 (no stack trace)', () => {
  const home = tmpdir();
  const skill = path.join(home, '.agents', 'skills', 'secret-hygiene');
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'my own skill');
  const inject = path.join(tmpdir(), 'inject.mjs');
  fs.writeFileSync(
    inject,
    "import fs from 'node:fs';\nconst real = fs.renameSync;\nfs.renameSync = (a, b) => { if (String(a).includes('.kktest-dev.tmp-')) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); return real(a, b); };\n",
  );
  const r = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene', '--force', '--apply', '--yes'], { home, node: ['--import', inject] });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^ERROR: could not move the new skill secret-hygiene into .*EPERM.*put back in place/);
  assert.ok(!/\n\s+at /.test(r.stderr), r.stderr);
  assert.match(r.stdout, /backed up .* -> .*backups/, 'progress printed before the error');
  assert.equal(read(path.join(skill, 'SKILL.md')), 'my own skill');
  assert.deepEqual(ls(path.dirname(skill)), ['secret-hygiene']);
});

test('checkTarget: containment and link rules', { skip: !posix && 'symlinks' }, () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, 'real'));
  fs.symlinkSync('real', path.join(root, 'link'));
  assert.equal(checkTarget(path.join(root, 'link', 'f'), { root, scope: 'user' }).ok, true);
  assert.equal(checkTarget(path.join(root, 'link', 'f'), { root, scope: 'project' }).ok, false);
  assert.equal(checkTarget(path.join(root, 'link'), { root, scope: 'user', kind: 'dir' }).ok, false, 'never replace a linked folder');
  fs.symlinkSync(tmpdir(), path.join(root, 'out'));
  assert.equal(checkTarget(path.join(root, 'out', 'f'), { root, scope: 'user' }).ok, false);
  assert.equal(checkTarget(path.join(root, 'new', 'deep', 'f'), { root, scope: 'project' }).ok, true);
  assert.equal(checkTarget(path.join(path.dirname(root), 'x'), { root, scope: 'user' }).ok, false);
});

test('G2-04: export refuses HOME and live tool folders as --out (PoC p8)', () => {
  const home = tmpdir();
  for (const out of [home, path.join(home, '.agents'), path.join(home, '.codex', 'x'), path.join(home, '.cursor')]) {
    const r = runCli(['export', '--target', 'agents', '--out', out], { home });
    assert.equal(r.code, 2, `${out}: ${r.stdout}`);
    assert.match(r.stderr, /REFUSED: --out /);
  }
  assert.ok(!fs.existsSync(path.join(home, '.agents')));
});

test('G2-04: re-export deletes only what the previous export wrote and never overwrites other files', () => {
  const home = tmpdir();
  const out = tmpdir();
  assert.equal(runCli(['export', '--target', 'agents', '--out', out], { home }).code, 0);
  const skills = path.join(out, '.agents', 'skills');
  const manifestFile = path.join(out, '.agents', '.kktest-dev-export');
  const manifest = JSON.parse(read(manifestFile));
  assert.equal(manifest.tool, 'kktest-dev export');
  assert.ok(manifest.files.includes('skills/secret-hygiene/SKILL.md'));
  // a skill the user added, a stray file inside an exported skill, and a stale file the last export listed
  fs.mkdirSync(path.join(skills, 'my-own-skill'));
  fs.writeFileSync(path.join(skills, 'my-own-skill', 'SKILL.md'), 'user work');
  fs.writeFileSync(path.join(skills, 'secret-hygiene', 'notes.txt'), 'mine');
  fs.mkdirSync(path.join(skills, 'gone'));
  fs.writeFileSync(path.join(skills, 'gone', 'SKILL.md'), 'old export');
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, files: [...manifest.files, 'skills/gone/SKILL.md'] }));
  const r = runCli(['export', '--target', 'agents', '--out', out], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(path.join(skills, 'my-own-skill', 'SKILL.md')), 'user work');
  assert.equal(read(path.join(skills, 'secret-hygiene', 'notes.txt')), 'mine');
  assert.ok(!fs.existsSync(path.join(skills, 'gone')), 'listed stale file and its emptied folder removed');

  // an unlisted file where the export wants to write is never overwritten
  const listed = JSON.parse(read(manifestFile));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...listed, files: listed.files.filter((f) => f !== 'skills/secret-hygiene/SKILL.md') }));
  fs.writeFileSync(path.join(skills, 'secret-hygiene', 'SKILL.md'), 'hand edited');
  const c = runCli(['export', '--target', 'agents', '--out', out], { home });
  assert.equal(c.code, 2);
  assert.match(c.stderr, /previous export did not write it/);
  assert.equal(read(path.join(skills, 'secret-hygiene', 'SKILL.md')), 'hand edited');

  // a manifest that points outside the folder is not trusted
  fs.writeFileSync(manifestFile, JSON.stringify({ tool: 'kktest-dev export', files: ['../../victim'] }));
  const m = runCli(['export', '--target', 'agents', '--out', out], { home });
  assert.equal(m.code, 2);
  assert.match(m.stderr, /not a kktest-dev export manifest/);
});
