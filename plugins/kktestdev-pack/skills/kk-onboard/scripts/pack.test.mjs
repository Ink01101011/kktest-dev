// Tests for the pack catalog (pack.json) as the audit sees it: which pack items report each other as
// overlaps on a fully onboarded machine (issues #14-#18). Stdlib only. Every fixture is a fake HOME
// under os.tmpdir(); the real ~/.claude* is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, validatePack, LIMITS } from './inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(readFileSync(join(HERE, '..', 'pack.json'), 'utf8'));
const README = readFileSync(join(HERE, '..', '..', '..', 'README.md'), 'utf8');
const ONBOARD = readFileSync(join(HERE, '..', 'SKILL.md'), 'utf8');

// skill directory names the superpowers plugin ships (the ones the overlap groups care about, plus neighbours)
const SUPERPOWERS_SKILLS = ['brainstorming', 'writing-plans', 'executing-plans', 'subagent-driven-development', 'dispatching-parallel-agents',
  'requesting-code-review', 'receiving-code-review', 'test-driven-development', 'systematic-debugging', 'verification-before-completion'];

const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };

/** a fake HOME where every pack item of the given profiles is installed the way /kk-onboard installs it */
function onboarded(t, profiles, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'kk-pack-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const cwd = join(home, 'proj');
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const plugins = [...(extra.plugins ?? [])];
  const mcpServers = {};
  for (const it of PACK.items.filter((i) => profiles.includes(i.profile))) {
    if (it.kind === 'plugin') {
      const installPath = join(home, '.claude', 'plugins', 'cache', it.plugin.replace('@', '-'));
      mkdirSync(installPath, { recursive: true });
      if (it.id === 'superpowers') for (const s of SUPERPOWERS_SKILLS) write(join(installPath, 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
      plugins.push({ id: it.plugin, enabled: true, scope: 'user', version: '1.0.0', installPath });
    } else if (it.kind === 'mcp') {
      mcpServers[it.id] = { command: 'npx', args: ['-y', `${it.options?.package ?? it.id}@latest`] };
    }
  }
  write(join(home, '.claude.json'), { mcpServers: { ...mcpServers, ...(extra.mcpServers ?? {}) } });
  for (const s of extra.userSkills ?? []) write(join(home, '.claude', 'skills', s, 'SKILL.md'), `---\nname: ${s}\n---\n`);
  const execClaude = async (args) => {
    const key = args.join(' ');
    if (key === 'plugin list --json') return { ok: true, stdout: JSON.stringify(plugins) };
    if (key === 'plugin marketplace list --json') return { ok: true, stdout: '[]' };
    if (key === 'mcp list') return { ok: true, stdout: '' };
    return { ok: false, error: 'unexpected' };
  };
  return run([], { home, cwd, env: {}, findBin: () => ({ found: true }), execClaude });
}
const overlaps = (out) => out.findings.filter((f) => f.category.startsWith('overlap:'));
const finding = (out, c) => out.findings.find((f) => f.category === c);
const ids = (profile) => PACK.items.filter((i) => i.profile === profile).map((i) => i.id).sort();

test('pack.json stays valid', () => {
  assert.deepEqual(validatePack(PACK), []);
});

test('every overlap note (the routing guidance) reaches the output untruncated', () => {
  for (const g of PACK.overlapGroups) assert.ok(`note: ${g.note}`.length <= LIMITS.str, `${g.id} note is cut at ${LIMITS.str} characters`);
});

test('#14/#16/#17: a fully onboarded core machine reports no overlap among its own items except the routed planning group', async (t) => {
  const out = await onboarded(t, ['core']);
  for (const id of ids('core')) assert.equal(out.pack.find((p) => p.id === id).status, 'present', id);
  // planning stays reported (owner decision #15: route, do not uninstall), marked as the pack's own choice
  assert.deepEqual(overlaps(out).map((f) => f.category), ['overlap:planning']);
  assert.equal(finding(out, 'overlap:planning').packManaged, true);
});

test('#14: playwright is the core browser tool; chrome-devtools is frontend and overlaps only there, as a pack choice', async (t) => {
  assert.equal(PACK.items.find((i) => i.id === 'playwright').profile, 'core');
  assert.equal(PACK.items.find((i) => i.id === 'chrome-devtools').profile, 'frontend');
  const out = await onboarded(t, ['core', 'frontend']);
  const f = finding(out, 'overlap:browser');
  assert.ok(f, 'core + frontend installs both browser MCPs');
  assert.equal(f.packManaged, true);
  assert.match(f.evidence.join('\n'), /playwright \(core\) is the default/);
});

test('#17: superpowers requesting-code-review is not counted against /code-review', async (t) => {
  // a user skill named code-review plus superpowers: before #17 this was a 2-member overlap
  const out = await onboarded(t, ['core'], { userSkills: ['code-review'] });
  assert.equal(finding(out, 'overlap:code-review'), undefined);
  // a real second reviewer still makes the group fire, and superpowers is not among its members
  const out2 = await onboarded(t, ['core'], { userSkills: ['code-review'], plugins: [{ id: 'pr-review-toolkit@claude-plugins-official', enabled: true, scope: 'user' }] });
  const f = finding(out2, 'overlap:code-review');
  assert.ok(f);
  const members = f.evidence.filter((l) => !l.startsWith('note: '));
  assert.deepEqual(members, ['plugin pr-review-toolkit@claude-plugins-official', 'skill code-review (user (~/.claude/skills))']);
});

test('#16: serena is no longer a pack item; an existing serena install is reported under code-nav and asked about', async (t) => {
  assert.equal(PACK.items.some((i) => i.id === 'serena'), false);
  const home = mkdtempSync(join(tmpdir(), 'kk-pack-serena-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const installPath = join(home, 'serena-plugin');
  write(join(installPath, '.mcp.json'), { mcpServers: { serena: { command: 'uvx', args: ['--from', 'git+https://github.com/oraios/serena', 'serena', 'start-mcp-server'] } } });
  const out = await onboarded(t, ['core'], { plugins: [{ id: 'serena@claude-plugins-official', enabled: true, scope: 'user', installPath }] });
  assert.equal(out.pack.some((p) => p.id === 'serena'), false);
  const f = finding(out, 'overlap:code-nav');
  assert.ok(f, 'serena is reported');
  assert.equal(f.packManaged, undefined, 'not a pack choice: the user is asked');
  assert.match(f.evidence.join('\n'), /plugin serena@/);
});

test('#14/#16: README profile table matches pack.json', () => {
  for (const profile of ['core', 'frontend', 'investigate']) {
    const row = README.split('\n').find((l) => l.startsWith(`| **${profile}** |`));
    assert.ok(row, profile);
    const listed = [...row.split('|')[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
    assert.deepEqual(listed, ids(profile), profile);
  }
});

test('#15/#17/#18: the routing rules are written where onboarding reads them', () => {
  for (const doc of [README, ONBOARD]) {
    const sec = doc.slice(doc.indexOf('## Routing'));
    assert.ok(doc.includes('## Routing'));
    assert.match(sec, /superpowers[\s\S]*bantamkit shiftwork/); // #15
    assert.match(sec, /\/code-review[\s\S]*requesting-code-review/); // #17
    assert.match(sec, /next-devtools[\s\S]*context7/); // #18
    assert.match(sec, /playwright[\s\S]*chrome-devtools/); // #14
  }
});
