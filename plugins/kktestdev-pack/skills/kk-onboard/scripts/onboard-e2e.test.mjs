// End-to-end walk of /kk-onboard on a fresh account (#21), as far as it can run without installing anything.
// Stdlib only. Run: node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/
// Every fixture is a fake HOME under os.tmpdir(); claude is a stub; nothing is installed and the real ~/.claude* is
// never read. pack.json is read at run time, so a new item is walked without editing this file.
// What a manual run on a simulated clean HOME found, and what is left for a real fresh account: docs/kk-onboard-e2e.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as inventoryRun, tokenizeCommand } from './inventory.mjs';
import { run as optionsRun, stateFile } from './options.mjs';

const HERE = nodePath.dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(readFileSync(nodePath.join(HERE, '..', 'pack.json'), 'utf8'));
const PROFILES = [['core'], ['core', 'frontend']];
const write = (file, data) => { mkdirSync(nodePath.dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data)); };

function freshHome(t) {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'kk-e2e-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = nodePath.join(root, 'home'); const cwd = nodePath.join(home, 'proj'); const npmRoot = nodePath.join(root, 'npm', 'lib', 'node_modules');
  for (const d of [home, cwd, npmRoot]) mkdirSync(d, { recursive: true });
  return { root, home, cwd, npmRoot };
}

/** a machine whose state is what the CLI would report: `claude` and `npm` answer from these lists only */
function machine(fx) {
  const m = { plugins: [], marketplaces: [], health: [] };
  m.execClaude = async (args) => {
    const key = args.join(' ');
    if (key === 'plugin list --json') return { ok: true, stdout: JSON.stringify(m.plugins) };
    if (key === 'plugin marketplace list --json') return { ok: true, stdout: JSON.stringify(m.marketplaces) };
    // the real CLI prints this line, exit 0, on an account with no servers (claude 2.1.x)
    if (key === 'mcp list') return { ok: true, stdout: m.health.length ? m.health.join('\n') + '\n' : 'No MCP servers configured. Use `claude mcp add` to add a server.\n' };
    if (args[0] === 'plugin' && args[1] === 'configure') return { ok: true, stdout: JSON.stringify({ schema: {}, configured: [], unconfigured: [] }) };
    return { ok: false, code: 1, error: `refused: ${key}` }; // anything that could change state
  };
  m.exec = async (cmd, args) => {
    if (cmd === 'npm' && args[0] === 'root') return { ok: true, stdout: fx.npmRoot + '\n' };
    if (cmd === 'npm' && args[0] === 'config') return { ok: true, stdout: nodePath.join(fx.root, 'npm-cache') + '\n' };
    return { ok: false, code: 1, error: 'not stubbed' };
  };
  return m;
}
const inv = (fx, m, argv = [], env = {}) => inventoryRun(argv, { home: fx.home, cwd: fx.cwd, env, findBin: () => ({ found: true }), execClaude: m.execClaude });
const opt = (fx, m, argv = [], env = {}) => optionsRun(argv, { home: fx.home, cwd: fx.cwd, env, findBin: () => ({ found: false }), execClaude: m.execClaude, exec: m.exec, globalDirs: [] });

/** SKILL.md Step 4, followed as written: marketplaces first, then plugin installs, then the MCP steps; shadcn is per project */
function installPlan(inventory, profiles) {
  const byId = new Map(PACK.items.map((i) => [i.id, i]));
  const chosen = inventory.pack.filter((p) => profiles.includes(p.profile) && ['missing', 'disabled'].includes(p.status));
  const markets = []; const cmds = []; const perProject = [];
  for (const p of chosen) {
    const it = byId.get(p.id);
    if (it.kind === 'plugin') {
      const mk = it.plugin.split('@')[1];
      if (!PACK.marketplaces[mk]?.builtin && !markets.includes(mk)) markets.push(mk);
      cmds.push(p.status === 'disabled' ? `claude plugin enable ${it.plugin}` : `claude plugin install ${it.plugin} --scope user`);
    } else if (it.kind === 'mcp') for (const s of it.steps) (it.scope === 'project' ? perProject : cmds).push(s);
  }
  return { items: chosen.map((p) => p.id), commands: [...markets.map((mk) => PACK.marketplaces[mk].add), ...cmds], perProject };
}

/** the result of each approved command, written the way the CLI writes it (nothing is run) */
function applyPlan(fx, m, plan) {
  const cj = nodePath.join(fx.home, '.claude.json');
  let claudeJson = {};
  try { claudeJson = JSON.parse(readFileSync(cj, 'utf8')); } catch {}
  claudeJson.mcpServers ??= {};
  for (const c of plan.commands) {
    const w = tokenizeCommand(c);
    if (c.startsWith('claude plugin marketplace add ')) {
      const name = Object.keys(PACK.marketplaces).find((k) => PACK.marketplaces[k].add === c);
      m.marketplaces.push({ name, source: 'github', repo: w[4] });
    } else if (c.startsWith('claude plugin install ')) {
      const installPath = nodePath.join(fx.home, '.claude', 'plugins', 'cache', ...w[3].split('@').reverse(), '1.0.0');
      write(nodePath.join(installPath, '.claude-plugin', 'plugin.json'), { name: w[3].split('@')[0], version: '1.0.0' });
      m.plugins.push({ id: w[3], version: '1.0.0', scope: 'user', enabled: true, installPath });
    } else if (c.startsWith('claude mcp add ')) {
      const dd = w.indexOf('--');
      claudeJson.mcpServers[w[dd - 1]] = { type: 'stdio', command: w[dd + 1], args: w.slice(dd + 2), env: {} };
      m.health.push(`${w[dd - 1]}: ${w.slice(dd + 1).join(' ')} - ✓ Connected`);
    } else if (c.startsWith('npm i -g ')) {
      for (const spec of w.slice(3)) {
        const pkg = spec.replace(/@latest$/, '');
        const it = PACK.items.find((i) => i.options?.package === pkg);
        write(nodePath.join(fx.npmRoot, pkg, 'package.json'), { name: pkg, version: '1.0.0' });
        write(nodePath.join(fx.npmRoot, pkg, 'README.md'), `| \`${it.options.envPrefix}HOME\` | where data lives |\n| \`${it.options.envPrefix}API_TOKEN\` | your token |\n`);
      }
    } else throw new Error(`unknown command shape: ${c}`);
  }
  write(cj, claudeJson);
}

test('#21: on a fresh account every item of core and core+frontend is missing, and the CLI\'s empty answers raise no notes', async (t) => {
  for (const profiles of PROFILES) {
    const fx = freshHome(t); const m = machine(fx);
    const out = await inv(fx, m);
    for (const p of out.pack.filter((x) => profiles.includes(x.profile))) assert.equal(p.status, 'missing', p.id);
    assert.deepEqual(out.findings, []);
    assert.deepEqual(out.notes, [], 'a fresh account must not read as a broken one');
    assert.ok(Object.values(out.counts).every((n) => n === 0));
  }
});

test('#21: the Step 4 commands are well formed, never pinned, and only use marketplaces pack.json can add', async (t) => {
  for (const profiles of PROFILES) {
    const fx = freshHome(t); const m = machine(fx);
    const plan = installPlan(await inv(fx, m), profiles);
    const firstNonMarket = plan.commands.findIndex((c) => !c.startsWith('claude plugin marketplace add '));
    assert.ok(plan.commands.slice(firstNonMarket).every((c) => !c.startsWith('claude plugin marketplace add ')), 'marketplaces come first');
    for (const c of plan.commands) {
      const w = tokenizeCommand(c);
      assert.ok(!/[;|&$`]/.test(c), `${c}: no shell metacharacters`);
      if (w[1] === 'plugin' && w[2] === 'install') {
        assert.match(w[3], /^[a-z0-9-]+@[a-z0-9-]+$/, c);
        const mk = w[3].split('@')[1];
        assert.ok(PACK.marketplaces[mk], `${c}: marketplace ${mk} is in pack.json`);
        assert.ok(PACK.marketplaces[mk].builtin || plan.commands.includes(PACK.marketplaces[mk].add), `${c}: its marketplace is added first`);
        assert.deepEqual(w.slice(4), ['--scope', 'user'], c);
      } else if (w[1] === 'mcp' && w[2] === 'add') {
        const dd = w.indexOf('--');
        assert.deepEqual(w.slice(3, 5), ['--scope', 'user'], c);
        assert.equal(dd, 6, `${c}: one server name, then --`);
        assert.ok(dd + 1 < w.length, `${c}: a command after --`);
      } else if (w[0] === 'npm') assert.deepEqual(w.slice(0, 3), ['npm', 'i', '-g'], c);
      else assert.match(c, /^claude plugin marketplace add [\w.-]+\/[\w.-]+$/, c);
      // team policy: never pin. A package spec (npm i -g, npx) is bare or @latest, never @<version>
      if (w[1] !== 'plugin') for (const x of w) {
        const v = x.match(/^(?:@[\w.-]+\/)?[\w.-]+@(.+)$/);
        if (v) assert.equal(v[1], 'latest', `${c}: ${x} is pinned`);
      }
    }
    for (const s of plan.perProject) assert.match(s, /^\(inside the project\) npx [\w.-]+@latest /, s);
  }
});

test('#21: after the Step 4 commands (and the per-project shadcn init), the inventory reports every chosen item present', async (t) => {
  for (const profiles of PROFILES) {
    const fx = freshHome(t); const m = machine(fx);
    const plan = installPlan(await inv(fx, m), profiles);
    applyPlan(fx, m, plan);
    // `npx shadcn@latest mcp init --client claude` writes the project's .mcp.json
    if (plan.perProject.length) write(nodePath.join(fx.cwd, '.mcp.json'), { mcpServers: { shadcn: { command: 'npx', args: ['shadcn@latest', 'mcp'] } } });
    const out = await inv(fx, m);
    for (const id of plan.items) assert.equal(out.pack.find((p) => p.id === id).status, 'present', `${profiles.join('+')}: ${id}`);
    // what is left to ask about is the pack's own choices (and info): nothing a fresh install should flag as a problem
    const asked = out.findings.filter((f) => !f.packManaged && f.type !== 'info');
    assert.deepEqual(asked.map((f) => f.category), [], `${profiles.join('+')}: unexpected findings`);
  }
});

test('#21: steps 5 and /kk-update on the installed machine: no seeded secret reaches any output or the state file; the diff names only changes', async (t) => {
  const fx = freshHome(t); const m = machine(fx);
  applyPlan(fx, m, installPlan(await inv(fx, m), ['core', 'frontend']));
  // seeded secrets: shell env, Claude Code settings env, the server's env and args, another AI tool, a project file, a README example
  const S = 'FAKE_SECRET_123';
  const cj = nodePath.join(fx.home, '.claude.json');
  const j = JSON.parse(readFileSync(cj, 'utf8'));
  j.mcpServers.bantamkit.env = { BANTAMKIT_API_TOKEN: `${S}a` };
  j.mcpServers.playwright.args.push(`--token=${S}b`);
  write(cj, j);
  write(nodePath.join(fx.home, '.claude', 'settings.json'), { env: { BANTAMKIT_API_TOKEN: `${S}c`, OPENAI_API_KEY: `${S}d` } });
  write(nodePath.join(fx.home, '.cursor', 'mcp.json'), { mcpServers: { bantamkit: { command: 'bantamkit-mcp', env: { BANTAMKIT_API_TOKEN: `${S}e` } } } });
  write(nodePath.join(fx.cwd, '.mcp.json'), { mcpServers: { shadcn: { command: 'npx', args: ['shadcn@latest', 'mcp'], env: { SHADCN_TOKEN: `${S}f` } } } });
  const readme = nodePath.join(fx.npmRoot, 'bantamkit-mcp', 'README.md');
  write(readme, readFileSync(readme, 'utf8') + `Example: BANTAMKIT_API_TOKEN=${S}g bantamkit-mcp\n`);
  const env = { BANTAMKIT_API_TOKEN: `${S}h`, ANTHROPIC_API_KEY: `${S}i` };
  const outputs = [
    await inv(fx, m, [], env), await inv(fx, m, ['--full'], env),
    await opt(fx, m, [], env), await opt(fx, m, ['--item', 'bantamkit'], env),
    await opt(fx, m, ['--record', '--pending', 'BANTAMKIT_HOME'], env),
  ];
  const b = outputs[3].items[0];
  assert.deepEqual(b.options.map((o) => o.name).sort(), ['BANTAMKIT_API_TOKEN', 'BANTAMKIT_HOME']);
  assert.ok(b.currentlySet.some((c) => c.where.startsWith('shell environment')), 'the shell variable is reported by name');
  // a version bump: one option added, one doc line changed, the plugin moves too
  write(nodePath.join(fx.npmRoot, 'bantamkit-mcp', 'package.json'), { name: 'bantamkit-mcp', version: '1.1.0' });
  write(readme, readFileSync(readme, 'utf8').replace('where data lives', 'where data lives (default ~/.bantamkit)') + '| `BANTAMKIT_LOG_LEVEL` | info or debug |\n');
  m.plugins.find((p) => p.id.startsWith('superpowers@')).version = '1.1.0';
  const diff = await opt(fx, m, ['--diff'], env);
  outputs.push(diff);
  const changedItems = diff.diff.filter((d) => ['added', 'removed', 'changed', 'pending'].some((k) => d[k]?.length));
  assert.deepEqual(changedItems.map((d) => d.id), ['bantamkit'], 'only the bumped item has option changes');
  const d = changedItems[0];
  assert.deepEqual([d.versionBefore, d.versionNow, d.added, d.removed, d.changed, d.pending], ['1.0.0', '1.1.0', ['BANTAMKIT_LOG_LEVEL'], [], ['BANTAMKIT_HOME'], ['BANTAMKIT_HOME']]);
  const sp = diff.diff.find((x) => x.id === 'superpowers');
  assert.deepEqual([sp.against, sp.pluginVersionBefore, sp.pluginVersionNow], ['plugin 1.1.0', '1.0.0', '1.1.0']);
  const file = stateFile({ home: fx.home, env });
  const texts = [...outputs.map((o) => JSON.stringify(o)), readFileSync(file, 'utf8')];
  for (const f of readdirSync(nodePath.dirname(file))) texts.push(readFileSync(nodePath.join(nodePath.dirname(file), f), 'utf8'));
  for (const txt of texts) assert.ok(!txt.includes(S), `a seeded secret leaked: ${txt.slice(Math.max(0, txt.indexOf(S) - 60), txt.indexOf(S) + 20)}`);
});
