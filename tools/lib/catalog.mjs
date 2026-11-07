// Reads the marketplace (plugins/*) into a catalog: plugins, skills, MCP servers, tiers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.mjs';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Portability tiers from the P1 portability audit (see docs/providers.md).
export const TIERS = {
  'kkskills-situational': { tier: 'portable' },
  'kkskills-essentials': { tier: 'with-fallbacks' },
  'kkskills-personal': {
    tier: 'with-fallbacks',
    // One person's preferences: never exported unless asked for by name.
    optIn: true,
    note: 'personal skills; exported only with --plugin kkskills-personal',
  },
  'agent-loops': { tier: 'with-fallbacks', note: 'loop-ledger MCP tools optional; advisory without them' },
  'infographic-diagram': { tier: 'with-fallbacks', note: 'needs python3; PNG needs playwright + Chromium' },
  'prompt-evolve': { tier: 'with-fallbacks', note: 'needs python3 (script bundled into the skill)' },
  'critique-gate': {
    tier: 'partly-Claude-only',
    note: 'slash commands and Stop-hook enforcement are Claude Code only; the skill is advisory elsewhere',
  },
  'memory-keeper': { tier: 'partly-Claude-only', note: 'hooks and slash commands are Claude Code only' },
  reflexion: {
    tier: 'partly-Claude-only',
    note: 'slash commands are Claude Code only',
    // reflexionctl.py delegates to memory-keeper's engine; bundle it next to the script.
    extraFiles: { 'scripts/memctl.py': 'plugins/memory-keeper/scripts/memctl.py' },
  },
  'loop-ledger': { tier: 'Claude-only', note: 'Stop-hook enforcement is Claude Code only; its stdio MCP server is portable' },
  'focus-notify': { tier: 'Claude-only', note: 'Claude Code hooks only' },
  'tool-metrics': { tier: 'Claude-only', note: 'Claude Code hooks + transcript format' },
  // Not covered by the P1 audit (lands with PR #12): it installs Claude Code plugins, so treat it as Claude-only.
  'kktestdev-pack': { tier: 'Claude-only', note: 'Claude Code onboarding pack (installs Claude Code plugins)' },
};

export const SKILL_TARGETS = ['agents', 'claude-ai', 'chatgpt', 'gemini-extension'];
export const MCP_TARGETS = ['codex', 'cursor', 'vscode', 'claude-desktop', 'windsurf', 'gemini-extension'];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function loadCatalog(root = PACKAGE_ROOT) {
  const pluginsDir = path.join(root, 'plugins');
  const plugins = [];
  for (const name of fs.readdirSync(pluginsDir).sort()) {
    const dir = path.join(pluginsDir, name);
    const manifestPath = path.join(dir, '.claude-plugin', 'plugin.json');
    if (name.startsWith('_') || !fs.existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    const info = TIERS[name] ?? { tier: 'unclassified', note: 'not in the portability audit' };
    const skills = [];
    const skillsDir = path.join(dir, 'skills');
    if (fs.existsSync(skillsDir)) {
      for (const s of fs.readdirSync(skillsDir).sort()) {
        const file = path.join(skillsDir, s, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'), path.relative(root, file));
        skills.push({ name: data.name, dirName: s, dir: path.join(skillsDir, s), data, body, plugin: name });
      }
    }
    plugins.push({
      name,
      dir,
      version: manifest.version,
      description: manifest.description,
      ...info,
      skills,
      mcpServers: loadMcpServers(dir, manifest),
      hasHooks: fs.existsSync(path.join(dir, 'hooks', 'hooks.json')),
      hasCommands: fs.existsSync(path.join(dir, 'commands')),
    });
  }
  return { root, version: readJson(path.join(root, 'package.json')).version, plugins };
}

function loadMcpServers(dir, manifest) {
  let servers = {};
  if (typeof manifest.mcpServers === 'string') servers = readJson(path.join(dir, manifest.mcpServers)).mcpServers ?? {};
  else if (manifest.mcpServers && typeof manifest.mcpServers === 'object') servers = manifest.mcpServers;
  else if (fs.existsSync(path.join(dir, '.mcp.json'))) servers = readJson(path.join(dir, '.mcp.json')).mcpServers ?? {};
  return Object.keys(servers).sort().map((name) => normalizeServer(name, servers[name]));
}

const ROOT_VAR = /\$\{CLAUDE_PLUGIN_ROOT\}/;
const REF_ONLY = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * Neutral server model. Values are tagged:
 *   {kind:'path', rel}       a file inside the plugin (from ${CLAUDE_PLUGIN_ROOT}/rel)
 *   {kind:'ref', name}       an env reference (${NAME}) - a secret or user setting, never a literal
 *   {kind:'literal', value}  plain non-secret text
 */
export function normalizeServer(name, cfg) {
  if (!cfg.command) throw new RefusedError(`MCP server ${name}: only stdio servers (command) are supported`);
  const tag = (v) => {
    const s = String(v);
    if (ROOT_VAR.test(s)) {
      const m = s.match(/^\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)$/);
      if (!m) throw new RefusedError(`MCP server ${name}: unsupported use of \${CLAUDE_PLUGIN_ROOT} in "${s}"`);
      return { kind: 'path', rel: m[1] };
    }
    const r = s.match(REF_ONLY);
    if (r) return { kind: 'ref', name: r[1] };
    if (s.includes('${')) throw new RefusedError(`MCP server ${name}: mixed interpolation "${s}" is not supported`);
    return { kind: 'literal', value: s };
  };
  const env = {};
  for (const k of Object.keys(cfg.env ?? {}).sort()) env[k] = tag(cfg.env[k]);
  return { name, command: cfg.command, args: (cfg.args ?? []).map(tag), env };
}

/** Top-level plugin directories a server needs at runtime (first segment of each path value). */
export function serverRuntimeDirs(server) {
  const dirs = new Set();
  for (const v of [...server.args, ...Object.values(server.env)]) if (v.kind === 'path') dirs.add(v.rel.split('/')[0]);
  return [...dirs].sort();
}

export function selectPlugins(catalog, { plugin, skill } = {}) {
  const wanted = plugin ? String(plugin).split(',').map((s) => s.trim()).filter(Boolean) : null;
  if (wanted) {
    for (const w of wanted) if (!catalog.plugins.some((p) => p.name === w)) throw new UsageError(`unknown plugin "${w}"`);
  }
  let plugins = catalog.plugins.filter((p) => (wanted ? wanted.includes(p.name) : !p.optIn));
  if (skill) {
    const names = String(skill).split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.length) throw new UsageError('--skill needs at least one skill name');
    for (const n of names) {
      const owner = catalog.plugins.find((p) => p.skills.some((s) => s.name === n));
      if (!owner) throw new UsageError(`unknown skill "${n}"`);
      if (!plugins.includes(owner)) {
        throw new UsageError(
          wanted
            ? `skill "${n}" belongs to plugin ${owner.name}, which --plugin does not select`
            : `skill "${n}" is in the opt-in plugin ${owner.name}; add --plugin ${owner.name}`,
        );
      }
    }
    // --skill narrows the selected plugins to those skills (and drops their MCP servers).
    plugins = plugins.map((p) => ({ ...p, skills: p.skills.filter((s) => names.includes(s.name)), mcpServers: [] })).filter((p) => p.skills.length);
  }
  return plugins;
}

/** Plugins whose skills can leave Claude Code, plus one skip line per Claude-only plugin. */
export function portableSkillPlugins(plugins) {
  const out = [];
  const skipped = [];
  for (const p of plugins) {
    if (!p.skills.length) continue;
    if (p.tier === 'Claude-only') skipped.push(`skip ${p.name}: Claude-only (${p.note})`);
    else out.push(p);
  }
  return { plugins: out, skipped };
}

/** One line per plugin whose hooks or slash commands stay behind. */
export function claudeOnlyParts(plugins) {
  const lines = [];
  for (const p of plugins) {
    const parts = [];
    if (p.hasHooks) parts.push('hooks');
    if (p.hasCommands) parts.push('slash commands');
    if (parts.length) lines.push(`skip ${p.name} ${parts.join(' + ')}: Claude Code only`);
  }
  return lines;
}

export class UsageError extends Error {}
export class RefusedError extends Error {}

export function skillTargets(plugin) {
  return plugin.tier === 'Claude-only' ? [] : SKILL_TARGETS;
}
