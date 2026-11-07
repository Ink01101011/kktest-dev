import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, runCli, tmpdir, treeHash } from './helpers.mjs';

const SECRET = 'sk-THIS-IS-A-SECRET-123';
const read = (f) => fs.readFileSync(f, 'utf8');
const backups = (dir) => fs.readdirSync(dir).filter((n) => n.includes('.kktest-dev.bak-'));

test('exit codes: help 0, usage 1, refused 2', () => {
  assert.equal(runCli([]).code, 1);
  assert.equal(runCli(['--help']).code, 0);
  for (const c of ['list', 'export', 'install']) {
    const r = runCli([c, '--help']);
    assert.equal(r.code, 0, c);
    assert.match(r.stdout, /Usage: kktest-dev/);
  }
  assert.equal(runCli(['nope']).code, 1);
  assert.equal(runCli(['export']).code, 1);
  assert.equal(runCli(['export', '--target', 'nope']).code, 1);
  assert.equal(runCli(['export', '--target', 'agents', '--bogus']).code, 1);
  assert.equal(runCli(['install', '--target', 'cursor', '--scope', 'galaxy']).code, 1);
  assert.equal(runCli(['install', '--target', 'cursor', '--plugin', 'no-such-plugin']).code, 1);
  const w = runCli(['install', '--target', 'windsurf']);
  assert.equal(w.code, 2);
  assert.match(w.stdout, /REFUSED: .*unverified/i);
  assert.equal(runCli(['install', '--target', 'claude-desktop', '--scope', 'project']).code, 2);
});

test('list shows tiers and targets', () => {
  const r = runCli(['list', '--json']);
  assert.equal(r.code, 0);
  const rows = JSON.parse(r.stdout);
  const tier = Object.fromEntries(rows.map((x) => [x.plugin, x.tier]));
  assert.equal(tier['kkskills-situational'], 'portable');
  assert.equal(tier['critique-gate'], 'partly-Claude-only');
  assert.equal(tier['focus-notify'], 'Claude-only');
  assert.ok(rows.find((x) => x.plugin === 'loop-ledger').mcpServers[0].targets.includes('codex'));
});

test('install dry run prints the plan and writes nothing', () => {
  const home = tmpdir();
  fs.mkdirSync(path.join(home, '.cursor'));
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x', env: { TOKEN: SECRET } } } }));
  const before = treeHash(home);
  const r = runCli(['install', '--target', 'cursor'], { home });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /dry run: target=cursor scope=user/);
  assert.match(r.stdout, /mcpServers\.loop-ledger/);
  assert.match(r.stdout, /\.agents[\\/]skills[\\/]critique-gate/);
  assert.match(r.stdout, /re-run with --apply/);
  assert.ok(!r.stdout.includes(SECRET));
  assert.equal(treeHash(home), before);
});

test('install --apply: backup, merge keeps other servers, secrets never printed, idempotent', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cfg));
  const original = JSON.stringify({ mcpServers: { other: { command: 'x', env: { TOKEN: SECRET } } }, extra: true });
  fs.writeFileSync(cfg, original);
  const r = runCli(['install', '--target', 'cursor', '--apply', '--yes', '--plugin', 'loop-ledger,reflexion'], { home });
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  const doc = JSON.parse(read(cfg));
  assert.equal(doc.mcpServers.other.env.TOKEN, SECRET);
  assert.equal(doc.extra, true);
  assert.deepEqual(Object.keys(doc.mcpServers).sort(), ['loop-ledger', 'other', 'reflexion']);
  const index = doc.mcpServers['loop-ledger'].args[0];
  assert.ok(fs.existsSync(index), index);
  assert.ok(index.startsWith(path.join(home, '.kktest-dev', 'servers')));
  assert.ok(fs.existsSync(path.join(home, '.kktest-dev', 'servers', 'reflexion', 'scripts', 'memctl.py')));
  assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'reflexion', 'SKILL.md')));
  const baks = backups(path.dirname(cfg));
  assert.equal(baks.length, 1);
  assert.equal(read(path.join(path.dirname(cfg), baks[0])), original);
  assert.deepEqual(fs.readdirSync(path.dirname(cfg)).filter((n) => n.includes('.tmp-')), []);

  const again = runCli(['install', '--target', 'cursor', '--apply', '--yes', '--plugin', 'loop-ledger,reflexion'], { home });
  assert.equal(again.code, 0);
  assert.match(again.stdout, /unchanged/);
  assert.equal(backups(path.dirname(cfg)).length, 1, 'no new backup when nothing changes');
});

test('install --apply refuses a name collision unless --force', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(cfg));
  const original = JSON.stringify({ mcpServers: { 'loop-ledger': { command: 'mine' } } }, null, 2);
  fs.writeFileSync(cfg, original);
  const r = runCli(['install', '--target', 'gemini', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /REFUSED: .*loop-ledger.*already exists/);
  assert.equal(read(cfg), original);
  assert.deepEqual(backups(path.dirname(cfg)), []);

  const f = runCli(['install', '--target', 'gemini', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes', '--force'], { home });
  assert.equal(f.code, 0, f.stdout);
  assert.equal(JSON.parse(read(cfg)).mcpServers['loop-ledger'].command, 'node');
  assert.equal(backups(path.dirname(cfg)).length, 1);
});

test('skill folder collision is refused; --force backs the old folder up outside the skills dir', () => {
  const home = tmpdir();
  const mine = path.join(home, '.agents', 'skills', 'secret-hygiene');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), 'my own skill');
  const r = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene', '--apply', '--yes'], { home });
  assert.equal(r.code, 2);
  assert.equal(read(path.join(mine, 'SKILL.md')), 'my own skill');
  const f = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene', '--apply', '--yes', '--force'], { home });
  assert.equal(f.code, 0, f.stdout);
  assert.match(read(path.join(mine, 'SKILL.md')), /^---\nname: secret-hygiene/);
  assert.deepEqual(fs.readdirSync(path.join(home, '.agents', 'skills')), ['secret-hygiene']);
  const bdir = path.join(home, '.kktest-dev', 'backups');
  const [stamp] = fs.readdirSync(bdir);
  assert.equal(read(path.join(bdir, stamp, 'skills', 'secret-hygiene', 'SKILL.md')), 'my own skill');
});

test('JSONC with comments is never rewritten; the snippet is printed instead', () => {
  const home = tmpdir();
  const proj = tmpdir();
  const cfg = path.join(proj, '.vscode', 'mcp.json');
  fs.mkdirSync(path.dirname(cfg));
  const original = '{\n  // my servers\n  "servers": {}\n}\n';
  fs.writeFileSync(cfg, original);
  const r = runCli(['install', '--target', 'vscode', '--scope', 'project', '--only', 'mcp', '--apply', '--yes'], { home, cwd: proj });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /contains comments/);
  assert.match(r.stdout, /"type": "stdio"/);
  assert.equal(read(cfg), original);
  assert.deepEqual(backups(path.dirname(cfg)), []);
});

test('invalid JSON is refused', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.cursor', 'mcp.json');
  fs.mkdirSync(path.dirname(cfg));
  fs.writeFileSync(cfg, '{"mcpServers": {,}');
  const r = runCli(['install', '--target', 'cursor', '--only', 'mcp', '--apply', '--yes'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /not valid JSON/);
});

test('codex TOML: appends absent tables, refuses existing or unclear ones', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfg));
  const original = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n';
  fs.writeFileSync(cfg, original);
  const ok = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'memory-keeper', '--apply', '--yes'], { home });
  assert.equal(ok.code, 0, ok.stdout);
  const text = read(cfg);
  assert.ok(text.startsWith(original));
  assert.match(text, /\n\[mcp_servers\.memory-keeper\]\ncommand = "python3"\n/);
  assert.match(text, /\[mcp_servers\.memory-keeper\.env\]\nMEMCTL_PATH = /);
  assert.equal(backups(path.dirname(cfg)).length, 1);

  // same install again: table present and identical -> nothing to do
  const same = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'memory-keeper', '--apply', '--yes'], { home });
  assert.equal(same.code, 0, same.stdout);
  assert.equal(read(cfg), text);

  // a hand-edited table with the same name -> refused even with --force
  fs.writeFileSync(cfg, '[mcp_servers.memory-keeper]\ncommand = "custom"\n');
  const clash = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'memory-keeper', '--apply', '--yes', '--force'], { home });
  assert.equal(clash.code, 2);
  assert.match(clash.stdout, /already exists/);
  assert.equal(read(cfg), '[mcp_servers.memory-keeper]\ncommand = "custom"\n');

  fs.writeFileSync(cfg, 'mcp_servers = { other = { command = "x" } }\n');
  const unsure = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'memory-keeper', '--apply', '--yes'], { home });
  assert.equal(unsure.code, 2);
  assert.match(unsure.stdout, /cannot tell/);
});

test('claude-desktop: config path under the fake HOME/APPDATA, no skills', () => {
  const home = tmpdir();
  const r = runCli(['install', '--target', 'claude-desktop', '--apply', '--yes', '--plugin', 'loop-ledger'], { home });
  assert.equal(r.code, 0, r.stdout);
  const cfg =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : process.platform === 'win32'
        ? path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
        : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  assert.ok(JSON.parse(read(cfg)).mcpServers['loop-ledger']);
  assert.ok(!fs.existsSync(path.join(home, '.agents')));
});

test('vscode user scope prints code --add-mcp instead of guessing a path', () => {
  const r = runCli(['install', '--target', 'vscode', '--only', 'mcp', '--plugin', 'loop-ledger']);
  assert.equal(r.code, 0);
  // win32 prints one form per shell: (cmd.exe) and (PowerShell, with --% so the JSON quoting survives)
  if (process.platform === 'win32') {
    assert.match(r.stdout, /manual step: \(cmd\.exe\) code --add-mcp .*name\\?":\\?"loop-ledger/);
    assert.match(r.stdout, /manual step: \(PowerShell\) code --% --add-mcp .*name\\?":\\?"loop-ledger/);
  } else assert.match(r.stdout, /manual step: code --add-mcp .*name\\?":\\?"loop-ledger/);
});

test('--apply without --yes on a non-terminal is refused and writes nothing', () => {
  const home = tmpdir();
  const r = runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene', '--apply'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /not a terminal/);
  assert.ok(!fs.existsSync(path.join(home, '.agents')));
});

test('export: deterministic, never touches source, refuses foreign output dirs', () => {
  const out1 = tmpdir();
  const out2 = tmpdir();
  for (const t of ['agents', 'claude-ai', 'chatgpt', 'gemini-extension']) {
    assert.equal(runCli(['export', '--target', t, '--out', out1]).code, 0, t);
    assert.equal(runCli(['export', '--target', t, '--out', out2]).code, 0, t);
  }
  assert.equal(treeHash(out1), treeHash(out2));
  const before = treeHash(out1);
  assert.equal(runCli(['export', '--target', 'claude-ai', '--out', out1]).code, 0);
  assert.equal(treeHash(out1), before, 're-export into the same folder is byte-identical');

  const zips = fs.readdirSync(path.join(out1, 'claude-ai')).filter((n) => n.endsWith('.zip'));
  assert.ok(zips.includes('critique-gate.zip') && !zips.includes('user-profile.zip'), 'personal skills are opt-in');
  const ext = JSON.parse(read(path.join(out1, 'gemini-extension', 'kktest-dev', 'gemini-extension.json')));
  assert.equal(ext.name, 'kktest-dev');
  assert.match(ext.mcpServers['loop-ledger'].args[0], /^\$\{extensionPath\}\$\{\/\}servers/);

  const foreign = tmpdir();
  fs.mkdirSync(path.join(foreign, 'cursor'));
  fs.writeFileSync(path.join(foreign, 'cursor', 'mine.txt'), 'keep');
  const r = runCli(['export', '--target', 'cursor', '--out', foreign]);
  assert.equal(r.code, 2);
  assert.equal(read(path.join(foreign, 'cursor', 'mine.txt')), 'keep');
});

test('export of MCP targets writes snippets that point at copied server files', () => {
  const out = tmpdir();
  for (const t of ['codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf']) {
    const r = runCli(['export', '--target', t, '--out', out]);
    assert.equal(r.code, 0, t + r.stderr);
  }
  const cur = JSON.parse(read(path.join(out, 'cursor', 'mcp.json')));
  for (const s of Object.values(cur.mcpServers)) assert.ok(fs.existsSync(s.args[0]), s.args[0]);
  assert.match(read(path.join(out, 'windsurf', 'NOTES.txt')), /UNVERIFIED/);
  assert.match(read(path.join(out, 'codex', 'config.toml')), /\[mcp_servers\.loop-ledger\]/);
});

test('CODEX_HOME: set -> $CODEX_HOME/config.toml, unset -> ~/.codex/config.toml (G1-05, G3-X3)', () => {
  const home = tmpdir();
  const ch = path.join(home, 'codex-home');
  const set = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home, env: { CODEX_HOME: ch } });
  assert.equal(set.code, 0, set.stdout + set.stderr);
  assert.match(set.stdout, /note: CODEX_HOME is set/);
  assert.match(read(path.join(ch, 'config.toml')), /\[mcp_servers\.loop-ledger\]/);
  assert.ok(!fs.existsSync(path.join(home, '.codex')));
  const unset = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(unset.code, 0, unset.stdout + unset.stderr);
  assert.match(read(path.join(home, '.codex', 'config.toml')), /\[mcp_servers\.loop-ledger\]/);
});

test('JSON with a UTF-8 BOM and CRLF is merged; BOM and CRLF are kept (G3-X4, G3-N1)', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(cfg));
  fs.writeFileSync(cfg, '\uFEFF{\r\n  "theme": "x"\r\n}\r\n');
  const r = runCli(['install', '--target', 'gemini', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const text = read(cfg);
  assert.ok(text.startsWith('\uFEFF{\r\n'));
  assert.ok(!/[^\r]\n/.test(text), 'only CRLF line endings');
  assert.equal(JSON.parse(text.slice(1)).theme, 'x');
});

test('codex TOML appended to a CRLF file uses CRLF', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfg));
  fs.writeFileSync(cfg, 'model = "o3"\r\n');
  const r = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'loop-ledger', '--apply', '--yes'], { home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(!/[^\r]\n/.test(read(cfg)));
  assert.match(read(cfg), /\r\n\[mcp_servers\.loop-ledger\]\r\n/);
});

test('--force does not replace a Codex TOML table, and the refusal says so (G1-04)', () => {
  const home = tmpdir();
  const cfg = path.join(home, '.codex', 'config.toml');
  fs.mkdirSync(path.dirname(cfg));
  fs.writeFileSync(cfg, '[mcp_servers.loop-ledger]\ncommand = "old"\n');
  const r = runCli(['install', '--target', 'codex', '--only', 'mcp', '--plugin', 'loop-ledger', '--force'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stdout, /--force does not apply to config\.toml/);
  assert.match(runCli(['install', '--help']).stdout, /Codex TOML table is never replaced/);
});

test('vscode user scope on win32 prints a cmd.exe and a PowerShell-safe form (G1-07, G3-X6)', async () => {
  const { planInstall } = await import('../lib/install.mjs');
  const { loadCatalog } = await import('../lib/catalog.mjs');
  const plan = planInstall(loadCatalog(), 'vscode', { only: 'mcp', plugin: 'loop-ledger', platform: 'win32', env: { USERPROFILE: 'C:\\Users\\Zoë Ü', APPDATA: 'C:\\A' }, cwd: 'C:\\w' });
  const [cmd, ps] = plan.manual;
  assert.match(cmd, /^\(cmd\.exe\) code --add-mcp "\{\\"name\\":\\"loop-ledger\\"/);
  assert.match(ps, /^\(PowerShell\) code --% --add-mcp "\{\\"name\\":\\"loop-ledger\\"/);
  // the payload after --add-mcp decodes (CommandLineToArgvW rules: \" -> ") to the JSON entry
  const json = JSON.parse(ps.replace(/^.*--add-mcp "/, '').replace(/"$/, '').replace(/\\"/g, '"'));
  assert.equal(json.type, 'stdio');
  assert.match(json.args[0], /^C:\\Users\\Zoë Ü\\\.kktest-dev\\servers\\loop-ledger\\/);
});

test('notes: agents --only mcp explains itself; win32 python3; WSL; project-scope absolute paths', async () => {
  const r = runCli(['install', '--target', 'agents', '--only', 'mcp']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /agents has no MCP config/);
  const { planInstall } = await import('../lib/install.mjs');
  const { loadCatalog } = await import('../lib/catalog.mjs');
  const cat = loadCatalog();
  const win = planInstall(cat, 'cursor', { only: 'mcp', plugin: 'memory-keeper', platform: 'win32', env: { USERPROFILE: 'C:\\u' }, cwd: 'C:\\w' });
  assert.match(win.notes.join('\n'), /Microsoft Store.*`py`/);
  const wsl = planInstall(cat, 'claude-desktop', { plugin: 'loop-ledger', platform: 'linux', env: { HOME: '/nonexistent-h', WSL_DISTRO_NAME: 'Ubuntu' }, cwd: '/w' });
  assert.match(wsl.notes.join('\n'), /^WSL: /m);
  const proj = planInstall(cat, 'cursor', { only: 'mcp', plugin: 'loop-ledger', scope: 'project', platform: 'linux', env: { HOME: '/nonexistent-h' }, cwd: '/nonexistent-w' });
  assert.match(proj.notes.join('\n'), /do not commit it/);
});

test('--skill with --plugin narrows within the plugin; opt-in skills need their plugin; empty names (S7, G1-10)', () => {
  const both = runCli(['install', '--target', 'agents', '--plugin', 'agent-loops', '--skill', 'reflexion']);
  assert.equal(both.code, 1);
  assert.match(both.stderr, /belongs to plugin reflexion, which --plugin does not select/);
  const ok = runCli(['install', '--target', 'agents', '--plugin', 'reflexion', '--skill', 'reflexion']);
  assert.equal(ok.code, 0, ok.stderr);
  const personal = runCli(['export', '--target', 'claude-ai', '--skill', 'user-profile', '--out', tmpdir()]);
  assert.equal(personal.code, 1);
  assert.match(personal.stderr, /opt-in plugin kkskills-personal; add --plugin kkskills-personal/);
  assert.equal(runCli(['export', '--target', 'claude-ai', '--plugin', 'kkskills-personal', '--skill', 'user-profile', '--out', tmpdir()]).code, 0);
  assert.equal(runCli(['install', '--target', 'agents', '--skill', ',']).code, 1);
  assert.equal(runCli(['install', '--target', 'agents', '--skill', 'secret-hygiene,']).code, 0);
});

test('typed errors: HOME unset is a usage error (exit 1), never a stack trace (S6)', () => {
  const h = tmpdir();
  const r = runCli(['install', '--target', 'codex'], { home: h, env: { HOME: '', USERPROFILE: '' } });
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /^error: HOME is not set|^error: USERPROFILE is not set/);
  assert.ok(!/\n\s+at /.test(r.stderr));
});

test('docs and --help name every target, and the tier table names every plugin (S2)', async () => {
  const { EXPORT_TARGETS } = await import('../lib/export.mjs');
  const { INSTALL_TARGETS } = await import('../lib/paths.mjs');
  const { TIERS } = await import('../lib/catalog.mjs');
  const docs = read(path.join(ROOT, 'docs', 'providers.md'));
  const exportHelp = runCli(['export', '--help']).stdout;
  const installHelp = runCli(['install', '--help']).stdout;
  for (const t of EXPORT_TARGETS) {
    assert.match(exportHelp, new RegExp(`^  ${t} `, 'm'), `export --help: ${t}`);
    assert.ok(docs.includes(`--target ${t}`), `docs/providers.md: --target ${t}`);
  }
  for (const t of INSTALL_TARGETS) assert.match(installHelp, new RegExp(`^  ${t} `, 'm'), `install --help: ${t}`);
  const table = docs.slice(docs.indexOf('| Plugin | Tier |'), docs.indexOf('Skills that name Claude-only tools'));
  for (const name of Object.keys(TIERS)) assert.ok(table.includes(name), `providers.md tier table: ${name}`);
  for (const name of fs.readdirSync(path.join(ROOT, 'plugins')).filter((n) => !n.startsWith('_'))) assert.ok(name in TIERS, `TIERS: ${name}`);
});
