#!/usr/bin/env node
// kktest-dev: use the kktest-dev skills and MCP servers from other AI tools.
// Exit codes: 0 ok, 1 usage error, 2 refused (nothing unsafe was written).
import { parseArgs } from 'node:util';
import readline from 'node:readline';
import { loadCatalog, RefusedError, UsageError, SKILL_TARGETS, MCP_TARGETS, skillTargets } from './lib/catalog.mjs';
import { FrontmatterError } from './lib/frontmatter.mjs';
import { EXPORT_TARGETS, planExport, writeExport } from './lib/export.mjs';
import { applyPlan, formatPlan, planInstall } from './lib/install.mjs';
import { INSTALL_TARGETS } from './lib/paths.mjs';

const HELP = {
  main: `kktest-dev - use kktest-dev skills and MCP servers from other AI tools

Usage: kktest-dev <command> [options]

Commands:
  list      plugins, skills and MCP servers with their portability tier
  export    write skills / MCP configs for a target into an output folder
  install   copy skills and merge MCP config into a tool (dry run unless --apply)

Run "kktest-dev <command> --help" for options. Docs: docs/providers.md
Exit codes: 0 ok, 1 usage error, 2 refused.`,
  list: `Usage: kktest-dev list [--json]

Lists every plugin with its portability tier (portable / with-fallbacks /
partly-Claude-only / Claude-only), its skills, its MCP servers, and the targets
that accept each.`,
  export: `Usage: kktest-dev export --target <t> [--out dir] [--plugin p[,p]] [--skill s[,s]]

Targets:
  agents            .agents/skills/<name>/ (Codex, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor)
  claude-ai         one .zip per skill for claude.ai upload (description <= 200 chars)
  chatgpt           one .zip per skill for ChatGPT upload
  gemini-extension  a Gemini CLI extension folder (gemini-extension.json + skills + MCP servers)
  codex             config.toml [mcp_servers.*] snippet + server files
  cursor            mcp.json snippet + server files
  vscode            .vscode/mcp.json ("servers") snippet + server files
  claude-desktop    claude_desktop_config.json snippet + server files
  windsurf          mcp_config.json snippet (UNVERIFIED format) + server files

Options:
  --out <dir>       output folder (default: ./kktest-dev-export)
  --plugin <names>  only these plugins (kkskills-personal is exported only when named)
  --skill <names>   only these skills (no MCP servers)

The source tree is never modified. Re-exporting gives byte-identical output.`,
  install: `Usage: kktest-dev install --target <t> [--scope user|project] [--apply] [--yes] [--force]
                          [--only all|skills|mcp] [--plugin p[,p]] [--skill s[,s]]

Targets: ${INSTALL_TARGETS.join(', ')}
  agents          skills -> ~/.agents/skills (or ./.agents/skills with --scope project)
  codex           skills + [mcp_servers.*] appended to ~/.codex/config.toml (or .codex/config.toml)
  gemini          skills + mcpServers merged into ~/.gemini/settings.json (or .gemini/settings.json)
  cursor          skills + mcpServers merged into ~/.cursor/mcp.json (or .cursor/mcp.json)
  vscode          skills + servers merged into .vscode/mcp.json (project); user scope prints
                  the "code --add-mcp" command to run
  claude-desktop  mcpServers merged into claude_desktop_config.json (user scope only)
  windsurf        refused: config format unverified (use export --target windsurf)

Without --apply nothing is written: the exact changes are printed.
With --apply: each changed file is backed up to <file>.kktest-dev.bak-<timestamp>, JSON is merged
(other servers are kept) and written atomically, Codex TOML gets new tables appended only when
absent, and you are asked to confirm unless --yes is given.
Refuses (exit 2) on a name collision (unless --force), on JSON files with comments, and on TOML it
cannot read safely. MCP server files are copied to ~/.kktest-dev/servers/<plugin>/.`,
};

function out(s) {
  process.stdout.write(s + '\n');
}

async function confirm(question) {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function cmdList(args) {
  const { values } = parseArgs({ args, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) return out(HELP.list), 0;
  const catalog = loadCatalog();
  const rows = catalog.plugins.map((p) => ({
    plugin: p.name,
    tier: p.tier,
    note: p.note ?? '',
    optIn: Boolean(p.optIn),
    skills: p.skills.map((s) => ({ name: s.name, descriptionChars: String(s.data.description).trim().length, targets: skillTargets(p) })),
    mcpServers: p.mcpServers.map((s) => ({ name: s.name, command: s.command, targets: MCP_TARGETS })),
    claudeOnly: [p.hasHooks && 'hooks', p.hasCommands && 'slash commands'].filter(Boolean),
  }));
  if (values.json) return out(JSON.stringify(rows, null, 2)), 0;
  out(`kktest-dev ${catalog.version}: ${rows.length} plugins`);
  out(`skill targets: ${SKILL_TARGETS.join(', ')}`);
  out(`MCP targets:   ${MCP_TARGETS.join(', ')} (windsurf unverified)\n`);
  for (const r of rows) {
    out(`${r.plugin}  [${r.tier}]${r.optIn ? ' (opt-in)' : ''}${r.note ? `  - ${r.note}` : ''}`);
    for (const s of r.skills) out(`  skill ${s.name}${s.descriptionChars > 200 ? ' (zip uses short description)' : ''} -> ${s.targets.join(', ') || 'none'}`);
    for (const s of r.mcpServers) out(`  mcp   ${s.name} (${s.command}, stdio) -> ${s.targets.join(', ')}`);
    if (r.claudeOnly.length) out(`  Claude Code only: ${r.claudeOnly.join(', ')}`);
  }
  return 0;
}

function cmdExport(args) {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: 'string', short: 't' },
      out: { type: 'string', short: 'o' },
      plugin: { type: 'string' },
      skill: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return out(HELP.export), 0;
  if (!values.target) throw new UsageError(`--target is required (one of: ${EXPORT_TARGETS.join(', ')})`);
  const catalog = loadCatalog();
  const plan = planExport(catalog, values.target, { outDir: values.out ?? 'kktest-dev-export', plugin: values.plugin, skill: values.skill, log: out });
  writeExport(plan);
  out(`wrote ${plan.files.length} file(s) to ${plan.dir}`);
  for (const n of plan.notes) out(`note: ${n}`);
  return 0;
}

async function cmdInstall(args) {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: 'string', short: 't' },
      scope: { type: 'string', default: 'user' },
      apply: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      force: { type: 'boolean' },
      only: { type: 'string', default: 'all' },
      plugin: { type: 'string' },
      skill: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return out(HELP.install), 0;
  if (!values.target) throw new UsageError(`--target is required (one of: ${INSTALL_TARGETS.join(', ')})`);
  const catalog = loadCatalog();
  const plan = planInstall(catalog, values.target, { scope: values.scope, plugin: values.plugin, skill: values.skill, only: values.only, force: values.force });
  out(formatPlan(plan, { target: values.target, scope: values.scope, apply: values.apply }));
  if (plan.refusals.length) return 2;
  if (!values.apply) return 0;
  const changes = plan.actions.filter((a) => a.kind === 'file' || a.state !== 'identical');
  if (!changes.length) return 0;
  if (!values.yes) {
    const ok = await confirm(`Write ${changes.length} change(s)? [y/N] `);
    if (ok === null) {
      out('REFUSED: not a terminal; re-run with --yes to confirm');
      return 2;
    }
    if (!ok) {
      out('aborted, nothing written');
      return 2;
    }
  }
  for (const line of applyPlan(plan)) out(line);
  return 0;
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
      out(HELP.main);
      return cmd ? 0 : 1;
    }
    if (cmd === '--version' || cmd === '-v') return out(loadCatalog().version), 0;
    if (cmd === 'list') return cmdList(rest);
    if (cmd === 'export') return cmdExport(rest);
    if (cmd === 'install') return await cmdInstall(rest);
    throw new UsageError(`unknown command "${cmd}"`);
  } catch (e) {
    if (e instanceof UsageError || e?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      process.stderr.write(`error: ${e.message}\nRun "kktest-dev --help".\n`);
      return 1;
    }
    if (e instanceof RefusedError || e instanceof FrontmatterError) {
      process.stderr.write(`REFUSED: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

// exitCode (not process.exit) so buffered stdout reaches a pipe in full.
main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
