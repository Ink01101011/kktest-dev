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

test('trusted publishing prerequisites: repository.url matches this repo; docs name the same workflow and environment', () => {
  assert.equal(PKG.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''), 'https://github.com/Ink01101011/kktest-dev');
  const docs = read('docs/providers.md');
  const rel = docs.slice(docs.indexOf('## Releasing'), docs.indexOf('## Sources'));
  assert.match(rel, /`NPM_TOKEN`/);
  assert.match(rel, /`npm-publish`/);
  assert.match(WORKFLOW, /\n {4}environment: npm-publish\n/);
  assert.match(rel, /`dry_run` defaults to true/);
});
