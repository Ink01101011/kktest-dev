// Issue #23 / G6 S1: tools/lib/providers.mjs is the one table of targets; the docs and the code read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_KEY } from '../lib/mcp.mjs';
import { EXPORT_TARGETS, INSTALL_MCP_TARGETS, INSTALL_TARGETS, MCP_TARGETS, PROVIDERS, SKILL_TARGETS, TARGETS, UNVERIFIED_TARGETS, orList } from '../lib/providers.mjs';
import { targetPaths } from '../lib/paths.mjs';
import { ROOT, runCli } from './helpers.mjs';

const DOCS = fs.readFileSync(path.join(ROOT, 'docs', 'providers.md'), 'utf8').replace(/\r\n/g, '\n');

/** the `### ` headings of the "## Per tool" section */
function perToolHeadings(md) {
  const start = md.indexOf('\n## Per tool\n');
  assert.ok(start >= 0, 'docs/providers.md has a "## Per tool" section');
  const next = md.indexOf('\n## ', start + 1);
  return md.slice(start, next < 0 ? undefined : next).split('\n').filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
}

/** the provider a heading belongs to: the heading is the name, or the name followed by " (", ":" or " " */
const headingOf = (heading, provider) => heading === provider || new RegExp(`^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ (:]`).test(heading);

test('docs/providers.md "Per tool" lists exactly the providers of the target table, each once', () => {
  const headings = perToolHeadings(DOCS);
  for (const h of headings) {
    const owners = PROVIDERS.filter((p) => headingOf(h, p));
    assert.equal(owners.length, 1, `docs heading "${h}" must belong to exactly one provider in tools/lib/providers.mjs (got ${owners.join(', ') || 'none'})`);
  }
  for (const p of PROVIDERS) {
    const hs = headings.filter((h) => headingOf(h, p));
    assert.equal(hs.length, 1, `provider "${p}" must have exactly one "### " section under "## Per tool" in docs/providers.md (got ${hs.length})`);
  }
});

test('every target row is complete for what it claims (export/install/MCP)', () => {
  for (const t of TARGETS) {
    assert.match(t.id, /^[a-z][a-z-]*$/);
    if (t.export) assert.ok(['skills', 'extension', 'mcp'].includes(t.export), `${t.id}: export kind`);
    if (t.export) assert.ok(t.exportHelp, `${t.id}: exportHelp`);
    if (t.install) assert.ok(t.installHelp?.length, `${t.id}: installHelp`);
    if (t.export === 'skills' || t.export === 'mcp') assert.ok(t.howTo, `${t.id}: howTo`);
    if (t.export === 'mcp') assert.ok(t.exportFile, `${t.id}: exportFile`);
    if (t.export === 'mcp' && t.id !== 'codex') assert.ok(t.configKey, `${t.id}: JSON snippet needs a configKey`);
    if (t.configKey) assert.ok('envRef' in t, `${t.id}: envRef must be stated (null = no reference syntax)`);
    if (t.installMcp) assert.ok(targetPaths(t.id, { platform: 'linux', env: { HOME: '/h' }, scope: 'user', cwd: '/w' }).format, `${t.id}: installMcp needs an MCP format in paths.mjs`);
  }
  assert.equal(new Set(TARGETS.map((t) => t.id)).size, TARGETS.length, 'target ids are unique');
});

test('derived lists keep their shown order (byte-identical list/--help output)', () => {
  assert.deepEqual(EXPORT_TARGETS, ['agents', 'claude-ai', 'chatgpt', 'gemini-extension', 'codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf']);
  assert.deepEqual(INSTALL_TARGETS, ['agents', 'codex', 'gemini', 'cursor', 'vscode', 'claude-desktop', 'windsurf']);
  assert.deepEqual(SKILL_TARGETS, ['agents', 'claude-ai', 'chatgpt', 'gemini-extension']);
  assert.deepEqual(MCP_TARGETS, ['codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf', 'gemini-extension']);
  assert.deepEqual(UNVERIFIED_TARGETS, ['windsurf']);
  assert.equal(orList(INSTALL_MCP_TARGETS), 'codex, gemini, cursor, vscode or claude-desktop');
  assert.deepEqual(CONFIG_KEY, { gemini: 'mcpServers', cursor: 'mcpServers', vscode: 'servers', 'claude-desktop': 'mcpServers', windsurf: 'mcpServers' });
});

test('install --help shows each install target with its table text, continuation lines aligned', () => {
  const help = runCli(['install', '--help']).stdout;
  assert.match(help, /\n {2}codex {11}skills \+ \[mcp_servers\.\*\] appended to ~\/\.codex\/config\.toml, \$CODEX_HOME\/config\.toml\n {18}when CODEX_HOME is set/);
  const list = runCli(['list']).stdout;
  assert.match(list, /^MCP targets: {3}codex, cursor, vscode, claude-desktop, windsurf, gemini-extension \(windsurf unverified\)$/m);
});
