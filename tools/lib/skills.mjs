// Build the exported copy of one skill as an in-memory file map (the source is never modified).
import fs from 'node:fs';
import path from 'node:path';
import { serializeFrontmatter, transformFrontmatter } from './frontmatter.mjs';

// Never shipped: tests, caches, editor/OS junk, backups.
const EXCLUDE = [/(^|\/)__pycache__(\/|$)/, /\.py[cod]$/, /(^|\/)test_[^/]*\.py$/, /(^|\/)tests?\//, /(^|\/)\.DS_Store$/, /(^|\/)selftest\.mjs$/, /\.bak(-|$)/, /\.kktest-dev\.bak-/];
export const isExcluded = (rel) => EXCLUDE.some((re) => re.test(rel));

export function walk(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (isExcluded(rel) || isExcluded(rel + '/')) continue;
    if (ent.isDirectory()) out.push(...walk(full, base));
    else if (ent.isFile()) out.push(rel);
  }
  return out;
}

const PLUGIN_ROOT_REF = /\$\{CLAUDE_PLUGIN_ROOT\}(\/[A-Za-z0-9_.\-/]*[A-Za-z0-9_\-/])?/g;

/** Paths (relative to the plugin dir) referenced as ${CLAUDE_PLUGIN_ROOT}/... in text. */
export function pluginRootRefs(text) {
  const refs = new Set();
  for (const m of text.matchAll(PLUGIN_ROOT_REF)) if (m[1]) refs.add(m[1].slice(1).replace(/\/$/, ''));
  return [...refs].sort();
}

/** ${CLAUDE_PLUGIN_ROOT}/x -> x (skill-relative, per the Agent Skills spec); bare -> a plain phrase. */
export function rewritePluginRoot(text) {
  return text.replace(PLUGIN_ROOT_REF, (m, p) => (p ? p.slice(1) : "<this skill's folder>"));
}

const TEXT_EXT = /\.(md|txt|json|ya?ml|toml)$/i;

/**
 * @returns {{files: Map<string, Buffer>, notes: string[]}} keys are skill-relative paths
 */
export function buildSkill(skill, plugin, { zip = false, root } = {}) {
  const notes = [];
  const files = new Map();
  for (const rel of walk(skill.dir)) files.set(rel, fs.readFileSync(path.join(skill.dir, rel)));

  // 1. bundle every ${CLAUDE_PLUGIN_ROOT}/... file or folder the skill's text points at
  const bundled = new Map();
  for (const [rel, buf] of files) {
    if (!TEXT_EXT.test(rel)) continue;
    for (const ref of pluginRootRefs(buf.toString('utf8'))) {
      const src = path.join(plugin.dir, ...ref.split('/'));
      if (!fs.existsSync(src)) throw new Error(`${skill.name}: ${rel} references \${CLAUDE_PLUGIN_ROOT}/${ref}, which does not exist`);
      const entries = fs.statSync(src).isDirectory() ? walk(src).map((r) => `${ref}/${r}`) : [ref];
      for (const e of entries) bundled.set(e, path.join(plugin.dir, ...e.split('/')));
    }
  }
  for (const [dest, src] of Object.entries(plugin.extraFiles ?? {})) bundled.set(dest, path.join(root, ...src.split('/')));
  for (const [rel, src] of [...bundled].sort()) {
    const data = fs.readFileSync(src);
    if (files.has(rel) && !files.get(rel).equals(data)) throw new Error(`${skill.name}: bundling ${rel} would overwrite a different file in the skill`);
    if (!files.has(rel)) notes.push(`bundled ${rel}`);
    files.set(rel, data);
  }

  // 2. rewrite ${CLAUDE_PLUGIN_ROOT} in text files to skill-relative paths
  for (const [rel, buf] of files) {
    if (!TEXT_EXT.test(rel) || rel === 'SKILL.md') continue;
    const t = buf.toString('utf8');
    if (t.includes('${CLAUDE_PLUGIN_ROOT}')) files.set(rel, Buffer.from(rewritePluginRoot(t), 'utf8'));
  }

  // 3. spec-shaped frontmatter
  const fm = transformFrontmatter(skill.data, { skill: skill.name, zip });
  files.set('SKILL.md', Buffer.from(serializeFrontmatter(fm) + rewritePluginRoot(skill.body), 'utf8'));
  return { files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), notes, frontmatter: fm };
}
