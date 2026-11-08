// Issue #24: provider targets re-checked against current vendor docs, and the tagged publish workflow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveToolDirs, targetPaths } from '../lib/paths.mjs';
import { ROOT, runCli, tmpdir } from './helpers.mjs';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const PKG = JSON.parse(read('package.json'));
const WORKFLOW = read('.github/workflows/publish.yml');

const win = { platform: 'win32', env: { USERPROFILE: 'C:\\Users\\a', APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } };
const linux = { platform: 'linux', env: { HOME: '/home/a' } };
const mac = { platform: 'darwin', env: { HOME: '/Users/a' } };

test('windsurf/Devin: documented user config per OS (docs.devin.ai/cli/extensibility/mcp/configuration)', () => {
  assert.equal(targetPaths('windsurf', win).mcpConfig, 'C:\\Users\\a\\AppData\\Roaming\\devin\\mcp_config.json');
  assert.equal(targetPaths('windsurf', linux).mcpConfig, '/home/a/.config/devin/mcp_config.json');
  assert.equal(targetPaths('windsurf', mac).mcpConfig, '/Users/a/.config/devin/mcp_config.json');
  assert.equal(targetPaths('windsurf', { ...linux, scope: 'project', cwd: '/w' }).mcpConfig, '/w/.devin/mcp_config.json');
  assert.equal(targetPaths('windsurf', { ...win, scope: 'project', cwd: 'C:\\w' }).mcpConfig, 'C:\\w\\.devin\\mcp_config.json');
});

test('windsurf/Devin: install still refuses and names exactly what is unverified', () => {
  const reason = targetPaths('windsurf', linux).unsupported;
  assert.match(reason, /format is documented/);
  assert.match(reason, /env interpolation/);
  assert.match(reason, /export --target windsurf/);
  const r = runCli(['install', '--target', 'windsurf', '--apply', '--yes']);
  assert.equal(r.code, 2);
  assert.ok(!fs.existsSync(path.join(r.home, '.config', 'devin')), 'nothing may be written');
  assert.ok(!fs.existsSync(path.join(r.home, 'AppData', 'Roaming', 'devin')), 'nothing may be written');
});

test('windsurf/Devin: Windows user config folder counts as a live tool folder for export --out', () => {
  assert.ok(liveToolDirs(win).includes('C:\\Users\\a\\AppData\\Roaming\\devin'));
  assert.ok(liveToolDirs(linux).includes('/home/a/.config/devin'));
});

test('export notes: Devin paths incl. Windows, why env stays a placeholder, documented zip limits', () => {
  const out = tmpdir();
  for (const t of ['windsurf', 'chatgpt', 'claude-ai']) assert.equal(runCli(['export', '--target', t, '--out', out]).code, 0, t);
  const ws = fs.readFileSync(path.join(out, 'windsurf', 'NOTES.txt'), 'utf8');
  assert.match(ws, /%APPDATA%\\devin\\mcp_config\.json/);
  assert.match(ws, /\$\{env:VAR\} is documented for OAuth fields only/);
  const gpt = fs.readFileSync(path.join(out, 'chatgpt', 'NOTES.txt'), 'utf8');
  assert.match(gpt, /50 MB zip, 500 files, 25 MB per file/);
  assert.match(gpt, /UNVERIFIED/);
  const cai = fs.readFileSync(path.join(out, 'claude-ai', 'NOTES.txt'), 'utf8');
  assert.match(cai, /name at most 64 characters, description at most 200/);
});

// ---- .github/workflows/publish.yml (text checks: zero deps, no YAML parser) ----

/** Lines of the step whose `- name:` is `name`, up to the next step. */
function step(name) {
  const lines = WORKFLOW.split('\n');
  const i = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(i >= 0, `step "${name}" not found`);
  const indent = lines[i].indexOf('-');
  let j = i + 1;
  while (j < lines.length && !(lines[j].indexOf('-') === indent && lines[j].trimStart().startsWith('- '))) j++;
  return { index: i, text: lines.slice(i, j).join('\n') };
}

/** The `run: |` block of a step, dedented. */
function runBlock(name) {
  const body = step(name).text.split('\n');
  const k = body.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  assert.ok(k >= 0, `step "${name}" has no run: | block`);
  const rest = body.slice(k + 1).filter((l) => l.trim());
  const pad = Math.min(...rest.map((l) => l.match(/^ */)[0].length));
  return rest.map((l) => l.slice(pad)).join('\n') + '\n';
}

test('publish.yml: v* tags or a manual run that defaults to dry run; OIDC at job level only', () => {
  assert.match(WORKFLOW, /^on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:\n/m);
  assert.match(WORKFLOW, /\n {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n {8}default: true\n/);
  assert.doesNotMatch(WORKFLOW, /^ {2}(pull_request|pull_request_target|schedule|release):/m);
  // Only a manual run can be a dry run; a tag push always evaluates to 'false'.
  assert.match(WORKFLOW, /DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry_run && 'true' \|\| 'false' \}\}/);
  // Workflow-wide token stays read-only; id-token only for the publish job.
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read\n\n/m);
  const job = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:'));
  assert.match(job, /\n {4}permissions:\n {6}contents: read\n {6}id-token: write/);
  assert.match(job, /\n {4}runs-on: ubuntu-latest\n/); // trusted publishing needs a GitHub-hosted runner
});

test('publish.yml: real publish uses provenance + the NPM_TOKEN secret, only when not a dry run', () => {
  const pub = step('Publish with provenance').text;
  assert.match(pub, /run: npm publish --provenance --access public$/m);
  assert.match(pub, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
  assert.match(pub, /if: env\.DRY_RUN != 'true' && steps\.registry\.outputs\.published != 'true'/);
  const dry = step('Publish dry run').text;
  assert.match(dry, /if: env\.DRY_RUN == 'true'/);
  assert.match(dry, /run: npm publish --provenance --access public --dry-run$/m);
  assert.doesNotMatch(dry, /secrets\./); // the dry run never sees the token
  assert.equal((WORKFLOW.match(/secrets\./g) ?? []).length, 1);
  assert.equal((WORKFLOW.match(/run: npm publish/g) ?? []).length, 2);
});

test('publish.yml: Node latest LTS, unpinned (team policy); actions on the majors ci.yml uses', () => {
  assert.match(WORKFLOW, /node-version: lts\/\*\n/);
  assert.doesNotMatch(WORKFLOW, /npm@\d|node-version: '?\d/);
  for (const a of ['actions/checkout@v4', 'actions/setup-node@v4', 'actions/setup-python@v5']) assert.ok(WORKFLOW.includes(`uses: ${a}\n`), a);
});

test('publish.yml: version check, all test suites and pack run before publish; published versions are skipped', () => {
  const pub = step('Publish with provenance').index;
  for (const [name, cmd] of [
    ['Tag must match package.json version', 'GITHUB_REF_NAME'],
    ['Node tests', 'node --test "tools/test/*.test.mjs"'],
    ['Node tests (kktestdev-pack kk-onboard)', 'node --test "plugins/kktestdev-pack/skills/kk-onboard/scripts/*.test.mjs"'],
    ['Python tests (infographic-diagram)', 'unittest discover -s plugins/infographic-diagram/skills/infographic-diagram/scripts'],
    ['Package contents', 'npm pack --dry-run'],
    ['Skip a version that is already published', 'npm view "kktest-dev@${version}"'],
  ]) {
    const s = step(name);
    assert.ok(s.text.includes(cmd), `${name} runs ${cmd}`);
    assert.ok(s.index < pub, `${name} comes before publish`);
  }
  for (const n of ['Publish with provenance', 'Publish dry run']) assert.match(step(n).text, /&& steps\.registry\.outputs\.published != 'true'/, n);
  assert.ok(step('Publish dry run').index < step('Publish with provenance').index);
  assert.match(step('Skip a version that is already published').text, /id: registry/);
});

test('publish.yml: the tag check passes for v<version>, fails for other tags and for a real publish off a tag', { skip: process.platform === 'win32' && 'bash step, run on POSIX' }, () => {
  const script = runBlock('Tag must match package.json version');
  const run = (name, type = 'tag', dry = 'false') =>
    spawnSync('bash', ['-c', script], { cwd: ROOT, env: { ...process.env, GITHUB_REF_NAME: name, GITHUB_REF_TYPE: type, DRY_RUN: dry }, encoding: 'utf8' });
  assert.equal(run(`v${PKG.version}`).status, 0);
  assert.equal(run(`v${PKG.version}.1`).status, 1);
  assert.equal(run(PKG.version).status, 1);
  assert.match(run('v0.0.0-nope').stdout, /::error::tag v0\.0\.0-nope does not match/);
  assert.equal(run('master', 'branch', 'true').status, 0); // manual dry run from a branch
  assert.equal(run('master', 'branch', 'false').status, 1); // manual real publish from a branch
  assert.equal(run(`v${PKG.version}`, 'branch', 'false').status, 1); // a branch named like the tag is not a tag
  assert.equal(run('v0.0.0-nope', 'tag', 'true').status, 1); // dry run on a wrong tag still fails
});

// ---- release gate fixes (G2-M2, G1 minor): tag must be on master; a failed registry lookup is not "unpublished" ----
const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

test('publish.yml: full-history checkout, and the master check runs before any test or publish step', () => {
  assert.match(WORKFLOW, /uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 0/);
  const s = step('Tagged commit must be on master');
  assert.ok(s.index > step('Tag must match package.json version').index && s.index < step('Node tests').index);
  assert.match(s.text, /git merge-base --is-ancestor "\$\{GITHUB_SHA\}" refs\/remotes\/origin\/master/);
});

test('publish.yml: a v* tag on a commit that is not on master is refused; one on master passes', { skip: process.platform === 'win32' && 'bash step, run on POSIX' }, () => {
  const dir = tmpdir('pub-');
  const origin = path.join(dir, 'origin.git'); const work = path.join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'master', origin);
  git(dir, 'init', '-q', '-b', 'master', work);
  fs.writeFileSync(path.join(work, 'a'), '1'); git(work, 'add', 'a'); git(work, 'commit', '-qm', 'one');
  git(work, 'remote', 'add', 'origin', origin); git(work, 'push', '-q', 'origin', 'master');
  const onMaster = git(work, 'rev-parse', 'HEAD');
  git(work, 'checkout', '-qb', 'side'); fs.writeFileSync(path.join(work, 'a'), '2'); git(work, 'commit', '-qam', 'side');
  const offMaster = git(work, 'rev-parse', 'HEAD');
  const script = runBlock('Tagged commit must be on master');
  const run = (sha, type = 'tag') => spawnSync('bash', ['-c', script], { cwd: work, encoding: 'utf8', env: { ...process.env, GITHUB_SHA: sha, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: 'v9.9.9', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  assert.equal(run(onMaster).status, 0);
  const bad = run(offMaster);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /::error::tag v9\.9\.9 \([0-9a-f]+\) is not on master/);
  assert.equal(run(offMaster, 'branch').status, 0, 'a manual dry run off a branch is not a tag');
  git(work, 'remote', 'set-url', 'origin', path.join(dir, 'gone.git'));
  assert.match(run(onMaster).stdout, /::error::could not fetch origin\/master/);
});

test('publish.yml: the registry lookup tells published / not published / failed apart', { skip: process.platform === 'win32' && 'bash step, run on POSIX' }, () => {
  const dir = tmpdir('pub-');
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  // a stub npm: prints NPM_OUT, exits NPM_CODE (node stays the real one, for package.json)
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nprintf "%s" "$NPM_OUT"\nexit "${NPM_CODE:-0}"\n', { mode: 0o755 });
  const script = runBlock('Skip a version that is already published');
  const run = (out, code) => {
    const ghOut = path.join(dir, `out-${code}-${out.length}`); fs.writeFileSync(ghOut, '');
    const r = spawnSync('bash', ['-c', script], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NPM_OUT: out, NPM_CODE: String(code), GITHUB_OUTPUT: ghOut } });
    return { status: r.status, out: fs.readFileSync(ghOut, 'utf8'), stdout: r.stdout };
  };
  assert.deepEqual([run(`${PKG.version}\n`, 0).status, run(`${PKG.version}\n`, 0).out], [0, 'published=true\n']);
  assert.equal(run('', 0).out, 'published=false\n'); // the package exists, this version does not
  assert.equal(run('npm error code E404\nnpm error 404 Not Found', 1).out, 'published=false\n'); // no package yet
  const net = run('npm error code ETIMEDOUT\nnpm error network request failed', 1);
  assert.equal(net.status, 1, 'a network failure stops the run');
  assert.equal(net.out, '');
  assert.match(net.stdout, /::error::could not ask the registry/);
  assert.equal(run('npm error code E401', 1).status, 1);
  assert.equal(run('1.0.0-other\n', 0).status, 1, 'an answer that is not this version is not trusted either');
});

test('docs: Releasing tells the owner to add required reviewers and a v* tag rule to npm-publish', () => {
  const docs = read('docs/providers.md');
  const rel = docs.slice(docs.indexOf('## Releasing'), docs.indexOf('## Sources'));
  assert.match(rel, /required reviewers/);
  assert.match(rel, /`v\*` tag/);
  assert.match(rel, /ancestor of `origin\/master`/);
});

test('trusted publishing prerequisites: repository.url matches this repo; docs name the same workflow and environment', () => {
  assert.equal(PKG.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''), 'https://github.com/Ink01101011/kktest-dev');
  const docs = read('docs/providers.md');
  const rel = docs.slice(docs.indexOf('## Releasing'), docs.indexOf('## Sources'));
  assert.match(rel, /`NPM_TOKEN`/);
  assert.match(rel, /`npm-publish`/);
  assert.match(WORKFLOW, /\n {4}environment: npm-publish\n/);
  assert.match(rel, /`dry_run` defaults to true/);
});
