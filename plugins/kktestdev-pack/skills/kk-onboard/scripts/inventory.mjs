#!/usr/bin/env node
// kk-onboard inventory + audit. Read-only: it never installs, removes, or writes anything.
// Prints one JSON document on stdout: what is installed/connected, the pack's status against it,
// and audit findings (redundancy + risk). Secret VALUES are never printed, only key names.
//
// usage: node inventory.mjs [--fast]   (--fast skips `claude mcp list`, the slow health check)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const CWD = process.cwd();
const FAST = process.argv.includes('--fast');
const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(readFileSync(join(HERE, '..', 'pack.json'), 'utf8'));
const notes = [];

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}
function claude(args) {
  const r = spawnSync('claude', args, { encoding: 'utf8', shell: process.platform === 'win32', timeout: 180000 });
  if (r.error || r.status !== 0) { notes.push(`claude ${args.join(' ')} failed: ${r.error?.message ?? (r.stderr || '').trim().slice(0, 200)}`); return null; }
  return r.stdout;
}
function which(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  return r.status === 0;
}
const short = (p) => (p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p);

// ---------------------------------------------------------------- plugins + marketplaces
const plugins = JSON.parse(claude(['plugin', 'list', '--json']) ?? '[]').map((p) => ({
  id: p.id, enabled: !!p.enabled, scope: p.scope, version: p.version, installPath: p.installPath,
}));
const marketplaces = JSON.parse(claude(['plugin', 'marketplace', 'list', '--json']) ?? '[]').map((m) => ({
  name: m.name, source: m.source, repo: m.repo ?? null, path: m.path ? short(m.path) : null,
}));

// ---------------------------------------------------------------- MCP servers (config view)
const mcp = [];
function addServers(obj, source) {
  for (const [name, c] of Object.entries(obj ?? {})) {
    mcp.push({
      name, source,
      type: c.type ?? (c.url ? 'http' : 'stdio'),
      url: c.url ?? null,
      command: c.command ?? null,
      args: c.args ?? [],
      envKeys: Object.keys(c.env ?? {}),
      headerKeys: Object.keys(c.headers ?? {}),
      _env: c.env ?? {}, _headers: c.headers ?? {},
    });
  }
}
const claudeJson = readJson(join(HOME, '.claude.json')) ?? {};
addServers(claudeJson.mcpServers, 'user (~/.claude.json)');
const proj = claudeJson.projects?.[CWD];
addServers(proj?.mcpServers, 'local (~/.claude.json, this project)');
addServers(readJson(join(CWD, '.mcp.json'))?.mcpServers, 'project (.mcp.json)');
for (const p of plugins.filter((p) => p.enabled && p.installPath)) {
  addServers(readJson(join(p.installPath, '.mcp.json'))?.mcpServers ?? readJson(join(p.installPath, '.mcp.json')), `plugin ${p.id}`);
  addServers(readJson(join(p.installPath, '.claude-plugin', 'plugin.json'))?.mcpServers, `plugin ${p.id}`);
}
const disabledHere = proj?.disabledMcpServers ?? [];

// ---------------------------------------------------------------- MCP health (+ claude.ai connectors)
const health = [];
if (!FAST) {
  const out = claude(['mcp', 'list']) ?? '';
  for (const line of out.split('\n')) {
    const m = line.match(/^(.+?): (.*?) - (.)\s*(.+)$/);
    if (!m) continue;
    const [, name, target, , status] = m;
    health.push({ name, target: target.replace(/\s*\((HTTP|SSE|stdio)\)$/, ''), status: status.trim() });
  }
  for (const h of health.filter((h) => h.name.startsWith('claude.ai '))) {
    mcp.push({ name: h.name, source: 'claude.ai connector', type: 'http', url: h.target, command: null, args: [], envKeys: [], headerKeys: [], _env: {}, _headers: {} });
  }
} else notes.push('--fast: MCP health and claude.ai connectors were not checked');

// ---------------------------------------------------------------- skills
const skills = [];
const seenSkill = new Set();
const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
function walkSkills(root, source, depth = 0) {
  if (!existsSync(root) || depth > 3) return;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const d = join(root, e.name);
    if (existsSync(join(d, 'SKILL.md'))) {
      if (seenSkill.has(real(d))) continue;
      seenSkill.add(real(d));
      const src = d.includes(`${sep}synced${sep}`) ? 'claude.ai synced' : source;
      let scripts = [];
      try { scripts = readdirSync(d, { recursive: true }).filter((f) => /\.(sh|py|mjs|js|ts|cmd|ps1|rb)$/.test(String(f))).map(String); } catch {}
      skills.push({ name: e.name, source: src, path: short(d), scripts: scripts.slice(0, 10) });
    } else walkSkills(d, source, depth + 1);
  }
}
walkSkills(join(HOME, '.claude', 'skills'), 'user (~/.claude/skills)');
if (real(CWD) !== real(HOME)) walkSkills(join(CWD, '.claude', 'skills'), 'project (.claude/skills)');
for (const p of plugins.filter((p) => p.enabled && p.installPath)) walkSkills(join(p.installPath, 'skills'), `plugin ${p.id}`);

// ---------------------------------------------------------------- hooks + permissions
const hooks = [];
const permissions = [];
const seenSettings = new Set();
function addSettings(file, source) {
  if (seenSettings.has(real(file))) return;
  seenSettings.add(real(file));
  const s = readJson(file);
  if (!s) return;
  for (const [event, groups] of Object.entries(s.hooks ?? {})) {
    for (const g of groups) for (const h of g.hooks ?? []) hooks.push({ source, event, matcher: g.matcher ?? null, command: h.command ?? h.type });
  }
  for (const a of s.permissions?.allow ?? []) permissions.push({ source, rule: a });
  if (s.permissions?.defaultMode) permissions.push({ source, rule: `defaultMode=${s.permissions.defaultMode}` });
}
addSettings(join(HOME, '.claude', 'settings.json'), 'user settings');
addSettings(join(CWD, '.claude', 'settings.json'), 'project settings');
addSettings(join(CWD, '.claude', 'settings.local.json'), 'local settings');
for (const p of plugins.filter((p) => p.enabled && p.installPath)) {
  const h = readJson(join(p.installPath, 'hooks', 'hooks.json'));
  if (h) for (const [event, groups] of Object.entries(h.hooks ?? {})) for (const g of groups) for (const x of g.hooks ?? []) hooks.push({ source: `plugin ${p.id}`, event, matcher: g.matcher ?? null, command: x.command });
}

// ---------------------------------------------------------------- matching helpers
const lc = (s) => String(s ?? '').toLowerCase();
function matches(detect, { plugin, server, skill } = {}) {
  if (plugin) return (detect.plugins ?? []).some((x) => lc(plugin.id).startsWith(lc(x)));
  if (server) {
    const name = lc(server.name.replace(/^claude\.ai /, '')).replace(/\s+/g, '-');
    const argv = lc([server.command, ...server.args].join(' '));
    return (detect.mcpName ?? []).some((x) => name === lc(x) || name.endsWith(':' + lc(x)) || name.includes(lc(x)))
      || (detect.mcpUrl ?? []).some((x) => lc(server.url).includes(lc(x)))
      || (detect.mcpCommand ?? []).some((x) => lc(server.command).includes(lc(x)))
      || (detect.mcpArgs ?? []).some((x) => argv.includes(lc(x)));
  }
  if (skill) return (detect.skills ?? []).some((x) => lc(skill.name) === lc(x));
  return false;
}
const pub = (s) => { const { _env, _headers, ...rest } = s; return rest; };

// ---------------------------------------------------------------- pack status
const pack = PACK.items.map((it) => {
  const viaPlugins = plugins.filter((p) => matches(it.detect, { plugin: p }));
  const viaMcp = mcp.filter((s) => matches(it.detect, { server: s }));
  const found = [
    ...viaPlugins.map((p) => `plugin ${p.id}${p.enabled ? '' : ' (installed, DISABLED)'}`),
    ...viaMcp.map((s) => `mcp "${s.name}" from ${s.source}`),
  ];
  const missingBins = (it.requires ?? []).filter((r) => !which(r.bin)).map((r) => ({ bin: r.bin, install: r.install }));
  let status = found.length ? 'present' : 'missing';
  if (found.length && viaPlugins.length && viaPlugins.every((p) => !p.enabled) && !viaMcp.length) status = 'disabled';
  return { id: it.id, profile: it.profile, kind: it.kind, status, foundAs: found, missingBins, what: it.what };
});

// ---------------------------------------------------------------- findings
const findings = [];
const F = (type, category, title, evidence) => findings.push({ type, category, title, evidence });

// redundancy: same endpoint / same package from more than one source
const norm = (u) => lc(u).replace(/\/+$/, '').replace(/\/(v\d+\/)?mcp(\/.*)?$/, '').replace(/^https?:\/\//, '');
const byUrl = {};
for (const s of mcp.filter((s) => s.url)) (byUrl[norm(s.url)] ??= []).push(s);
for (const [u, list] of Object.entries(byUrl)) if (list.length > 1) F('redundancy', 'same-endpoint', `${list.length} MCP entries point at ${u}`, list.map((s) => `${s.name} — ${s.source}`));
const pkgOf = (s) => (s.args.find((a) => /^(@[\w.-]+\/)?[\w.-]+(@[\w.^~-]+)?$/.test(a) && !a.startsWith('-')) ?? '').replace(/@[^@/]*$/, (m) => (m.includes('/') ? m : ''));
const byPkg = {};
for (const s of mcp.filter((s) => s.command && /npx|uvx|bunx|pnpm/.test(s.command))) { const k = pkgOf(s); if (k) (byPkg[k] ??= []).push(s); }
for (const [k, list] of Object.entries(byPkg)) if (list.length > 1) F('redundancy', 'same-package', `${k} is configured ${list.length} times`, list.map((s) => `${s.name} — ${s.source}`));
// redundancy: same skill name from different sources
const byName = {};
for (const s of skills) (byName[s.name] ??= []).push(s);
for (const [n, list] of Object.entries(byName)) if (new Set(list.map((s) => s.source)).size > 1) F('redundancy', 'same-skill-name', `skill "${n}" exists in ${list.length} places`, list.map((s) => `${s.source}: ${s.path}`));
// redundancy: functional overlap groups
for (const g of PACK.overlapGroups) {
  const members = [
    ...plugins.filter((p) => p.enabled && matches(g.match, { plugin: p })).map((p) => `plugin ${p.id}`),
    ...mcp.filter((s) => matches(g.match, { server: s })).map((s) => `mcp ${s.name} (${s.source})`),
    ...skills.filter((s) => matches(g.match, { skill: s })).map((s) => `skill ${s.name} (${s.source})`),
  ];
  if (members.length > 1) F('redundancy', `overlap:${g.id}`, `${g.label}: ${members.length} tools cover the same job`, [...members, `note: ${g.note}`]);
}
// redundancy: installed but disabled
for (const p of plugins.filter((p) => !p.enabled)) F('redundancy', 'disabled-installed', `plugin ${p.id} is installed but disabled`, [`scope ${p.scope}, version ${p.version}`]);

// risk: inline secrets in MCP config (key names only)
const SECRETY = /(token|secret|password|passwd|api[-_]?key|auth|bearer|cookie|private)/i;
for (const s of mcp) {
  const keys = [...Object.entries(s._env), ...Object.entries(s._headers)]
    .filter(([k, v]) => (SECRETY.test(k) || /^bearer\s/i.test(String(v))) && v && !/^\$\{?[A-Z_][A-Z0-9_]*\}?$/.test(String(v)))
    .map(([k]) => k);
  if (keys.length) F('risk', 'inline-secret', `MCP "${s.name}" stores a credential in plain text in its config`, [`source: ${s.source}`, `keys: ${keys.join(', ')}`, 'values not shown']);
}
// risk: commands that run code from a local checkout (not portable, not from a registry)
const localPath = (str) => str && (str.startsWith(HOME) || str.startsWith('~')) && !/node_modules|\.local\/share\/mise|\.nvm|\.volta|\.asdf|homebrew|\.claude[\\/]plugins/.test(str);
for (const s of mcp) {
  const p = [s.command, ...s.args].find((a) => localPath(a));
  if (p) F('risk', 'local-path-mcp', `MCP "${s.name}" runs code from a local path`, [`source: ${s.source}`, `path: ${short(p)}`]);
}
const hookPaths = {};
for (const h of hooks) {
  const p = String(h.command ?? '').split(/\s+/).map((a) => a.replace(/^"|"$/g, '')).find((a) => localPath(a));
  if (p) (hookPaths[`${short(p)}|${h.source}`] ??= []).push(h.event);
}
for (const [k, events] of Object.entries(hookPaths)) {
  const [p, source] = k.split('|');
  F('risk', 'local-path-hook', `hooks run code from a local path: ${p}`, [`source: ${source}`, `events: ${[...new Set(events)].join(', ')}`]);
}
// risk/cost: hooks on every tool call
const every = {};
for (const h of hooks.filter((h) => /^(Pre|Post)ToolUse$/.test(h.event) && !h.matcher)) (every[short(String(h.command)).slice(0, 160)] ??= new Set()).add(`${h.event} (${h.source})`);
for (const [cmd, ev] of Object.entries(every)) F('risk', 'hook-every-tool', `a hook with no matcher runs on every tool call: ${cmd}`, [...ev]);
// risk: npx without a version resolves the registry each start; with @latest too (by policy) — reported as info
for (const s of mcp.filter((s) => s.command && /npx|uvx|bunx/.test(s.command))) {
  const pkg = s.args.find((a) => !a.startsWith('-')) ?? '';
  F('info', 'runs-latest-from-registry', `MCP "${s.name}" downloads ${pkg || 'its package'} from the registry`, [`source: ${s.source}`, 'a new upstream release reaches you on next start, good or bad']);
}
// risk: unhealthy / unauthenticated servers
const sick = {};
for (const h of health.filter((h) => !/connected/i.test(h.status))) {
  const origin = h.name.startsWith('plugin:') ? `plugin ${h.name.split(':')[1]}` : h.name.startsWith('claude.ai ') ? 'claude.ai connectors' : 'configured servers';
  const off = disabledHere.includes(h.name) ? ', disabled here' : '';
  (sick[origin] ??= []).push(`${h.name.replace(/^plugin:[^:]+:/, '')}: ${h.status}${off}`);
}
for (const [origin, list] of Object.entries(sick)) F('risk', 'mcp-unhealthy', `${origin}: ${list.length} MCP server(s) not connected`, list);
// risk: third-party marketplaces (code from repos outside anthropics/)
for (const m of marketplaces.filter((m) => !(m.repo ?? '').startsWith('anthropics/'))) F('risk', 'third-party-marketplace', `marketplace "${m.name}" is not from Anthropic`, [m.repo ? `github: ${m.repo}` : `${m.source}: ${m.path ?? ''}`]);
// risk: user/project skills that ship executable scripts
const scripted = {};
for (const s of skills.filter((s) => s.scripts.length && !s.source.startsWith('plugin '))) (scripted[s.source] ??= []).push(`${s.name} (${s.scripts.length}${s.scripts.length === 10 ? '+' : ''} scripts, ${s.path})`);
for (const [source, list] of Object.entries(scripted)) F('risk', 'skill-with-scripts', `${list.length} skill(s) from ${source} ship executable scripts`, list);
// risk: broad permission rules
for (const p of permissions.filter((p) => /^Bash(\(\*\))?$|^Bash\(\*|bypassPermissions|^mcp__[^_]+$|^\*$/.test(p.rule))) F('risk', 'broad-permission', `broad permission rule: ${p.rule}`, [`source: ${p.source}`]);

const out = {
  generatedAt: new Date().toISOString(), cwd: short(CWD), platform: process.platform,
  pack,
  installed: {
    plugins: plugins.map(({ installPath, ...p }) => p),
    marketplaces,
    mcp: mcp.map(pub),
    mcpHealth: health,
    skills: skills.map(({ scripts, ...s }) => s),
    hooks: hooks.map((h) => ({ ...h, command: short(String(h.command)).slice(0, 200) })),
  },
  findings, notes,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
