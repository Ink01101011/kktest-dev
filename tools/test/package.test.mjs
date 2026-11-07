import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../lib/catalog.mjs';
import { buildSkill } from '../lib/skills.mjs';
import { serverRuntimeFiles } from '../lib/export.mjs';
import { ROOT } from './helpers.mjs';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));

// npm and pnpm differ on "!" negations in "files" (pnpm ignores them), so the whitelist is
// explicit: only "*" (one path segment) wildcards, no negations, no "**".
const toRe = (pat) => new RegExp('^' + pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
const matchers = pkg.files.map(toRe);
const packed = (rel) => matchers.some((re) => re.test(rel));

function allFiles(dir, base = ROOT) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...allFiles(f, base));
    else out.push(path.relative(base, f).split(path.sep).join('/'));
  }
  return out;
}

test('package.json: publishable by a plain `pnpm publish`', () => {
  assert.equal(pkg.name, 'kktest-dev');
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.type, 'module');
  assert.deepEqual(pkg.bin, { 'kktest-dev': 'tools/cli.mjs' });
  assert.deepEqual(pkg.publishConfig, { access: 'public' }, 'no provenance: it only works in CI');
  assert.equal(pkg.license, 'MIT');
  assert.match(pkg.engines.node, />=\s*22/);
  for (const k of ['prepublishOnly', 'prepublish', 'prepack', 'prepare', 'postpack']) assert.ok(!(k in (pkg.scripts ?? {})), k);
  for (const k of ['dependencies', 'packageManager']) assert.ok(!(k in pkg), k);
  assert.match(fs.readFileSync(path.join(ROOT, 'tools', 'cli.mjs'), 'utf8'), /^#!\/usr\/bin\/env node\r?\n/);
  assert.equal(marketplace.version, pkg.version);
  for (const f of pkg.files) assert.ok(!f.startsWith('!') && !f.includes('**'), f);
});

test('package files cover everything the CLI reads and nothing it should not ship', () => {
  const cat = loadCatalog(ROOT);
  const need = ['tools/cli.mjs', '.claude-plugin/marketplace.json', ...fs.readdirSync(path.join(ROOT, 'tools', 'lib')).map((f) => `tools/lib/${f}`)];
  for (const p of cat.plugins) {
    need.push(`plugins/${p.name}/.claude-plugin/plugin.json`);
    if (p.mcpServers.length) need.push(`plugins/${p.name}/.mcp.json`);
    for (const s of p.tier === 'Claude-only' ? [] : p.skills) {
      const { files } = buildSkill(s, p, { root: ROOT });
      for (const rel of files.keys()) {
        const src = path.join(s.dir, ...rel.split('/'));
        if (fs.existsSync(src)) need.push(path.relative(ROOT, src).split(path.sep).join('/'));
      }
    }
    for (const srv of p.mcpServers) for (const src of serverRuntimeFiles(p, srv, ROOT).values()) need.push(path.relative(ROOT, src).split(path.sep).join('/'));
  }
  // bundled ${CLAUDE_PLUGIN_ROOT} files come from the plugin root
  need.push('plugins/prompt-evolve/scripts/pevolve.py', 'plugins/memory-keeper/scripts/memctl.py', 'plugins/memory-keeper/automation/pre-commit');
  for (const f of need) assert.ok(packed(f), `not in package.json files: ${f}`);

  const forbidden = /(^|\/)(test_[^/]*\.py|[^/]*\.test\.mjs|selftest\.mjs|__pycache__\/.*|[^/]*\.pyc)$|^\.shiftwork\/|\.bak/;
  for (const f of [...allFiles(path.join(ROOT, 'plugins')), ...allFiles(path.join(ROOT, 'tools'))]) {
    if (forbidden.test(f)) assert.ok(!packed(f), `would ship ${f}`);
  }
});
