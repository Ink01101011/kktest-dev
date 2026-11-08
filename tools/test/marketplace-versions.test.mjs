import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

// `claude plugin update` compares the marketplace entry's version, so an entry left behind its
// plugin.json reports "already latest" while the plugin changed. `claude plugin validate .` only
// warns about it; this test makes the mismatch a red suite.
const marketplace = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
const pluginRoot = marketplace.metadata?.pluginRoot ?? '.';

// A string source is a local path: "./x" or "../x" is relative to the repo root, a bare name is
// relative to metadata.pluginRoot. Object sources (github, url, npm) are remote and skipped.
function localDir(source) {
  if (typeof source !== 'string') return null;
  const rel = /^\.\.?\//.test(source) ? source : path.join(pluginRoot, source);
  return path.resolve(ROOT, rel);
}

test('marketplace.json: every local plugin entry version equals its plugin.json version', () => {
  const problems = [];
  let checked = 0;
  for (const entry of marketplace.plugins) {
    const dir = localDir(entry.source);
    if (!dir) continue;
    checked++;
    const where = `${entry.name} (${entry.source})`;
    const manifest = path.join(dir, '.claude-plugin', 'plugin.json');
    let plugin;
    try {
      plugin = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    } catch (e) {
      problems.push(`${where}: cannot read ${path.relative(ROOT, manifest)}: ${e.message}`);
      continue;
    }
    if (typeof plugin.version !== 'string' || !plugin.version) {
      problems.push(`${where}: plugin.json has no version (marketplace entry says ${JSON.stringify(entry.version)})`);
      continue;
    }
    if (entry.version !== plugin.version) {
      problems.push(`${where}: marketplace entry version ${JSON.stringify(entry.version)} != plugin.json version ${JSON.stringify(plugin.version)}`);
    }
  }
  assert.ok(checked > 0, 'no local plugin entries found in marketplace.json');
  assert.deepEqual(problems, [], `marketplace/plugin.json version drift:\n  ${problems.join('\n  ')}`);
});
