import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, tmpdir, treeHash } from './helpers.mjs';

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
  assert.match(r.stdout, /manual step: code --add-mcp .*name\\?":\\?"loop-ledger/);
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
