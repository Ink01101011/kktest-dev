// Config and skill locations per target, per OS. Pure: platform, env and cwd are injected.
// Every path here comes from the vendor docs listed in docs/providers.md.
import path from 'node:path';
import { UsageError } from './catalog.mjs';

export function homeDir({ platform, env }) {
  const h = platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME;
  if (!h) throw new UsageError(platform === 'win32' ? 'USERPROFILE is not set' : 'HOME is not set');
  return h;
}

/**
 * Platform application-data folder (macOS Application Support, Windows APPDATA, Linux XDG).
 * Kept in step with appDataDir() in plugins/kktestdev-pack/skills/kk-onboard/scripts/hosts.mjs:
 * hosts.mjs only READS host configs for onboarding, this file decides where the installer WRITES.
 * Both must agree on Claude Desktop. They deliberately differ on two hosts: hosts.mjs also reads
 * VS Code's <appdata>/Code/User/mcp.json and Windsurf's ~/.codeium/windsurf/mcp_config.json, which
 * the installer never writes because neither path is documented by the vendor (docs/providers.md).
 */
export function appDataDir({ platform, env, home }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') return p.join(home, 'Library', 'Application Support');
  if (platform === 'win32') return env.APPDATA || p.join(home, 'AppData', 'Roaming');
  // The XDG spec says a relative XDG_CONFIG_HOME is invalid and must be ignored.
  return env.XDG_CONFIG_HOME && p.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : p.join(home, '.config');
}

/** Codex's home: $CODEX_HOME when set (P0 section 2), else ~/.codex. */
export function codexHome({ platform, env, home }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  if (env.CODEX_HOME) {
    if (!p.isAbsolute(env.CODEX_HOME)) throw new UsageError(`CODEX_HOME must be an absolute path (got "${env.CODEX_HOME}")`);
    return env.CODEX_HOME;
  }
  return p.join(home, '.codex');
}

/**
 * `root` is the folder each destination is derived from; writes must stay inside it (safefs.checkTarget).
 * @returns {{skillsDir: string|null, mcpConfig: string|null, format: string|null, serversDir: string,
 *   home: string, root: string, configRoot: string|null, manual?: string, unsupported?: string, notes: string[]}}
 */
export function targetPaths(target, { platform = process.platform, env = process.env, scope = 'user', cwd = process.cwd() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = homeDir({ platform, env });
  const base = scope === 'project' ? cwd : home;
  const common = { home, root: base, configRoot: base, notes: [] };
  // .agents/skills: Codex, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor (P0 section 0).
  const agentsSkills = p.join(base, '.agents', 'skills');
  // Our own copy of MCP server runtimes, so configs never point into an npx cache.
  const serversDir = p.join(home, '.kktest-dev', 'servers');
  switch (target) {
    case 'agents':
      return { ...common, skillsDir: agentsSkills, mcpConfig: null, format: null, serversDir };
    case 'codex': {
      // ~/.codex/config.toml or $CODEX_HOME/config.toml (user), .codex/config.toml (project, trusted projects only)
      if (scope === 'project') return { ...common, skillsDir: agentsSkills, mcpConfig: p.join(base, '.codex', 'config.toml'), format: 'codex-toml', serversDir };
      const ch = codexHome({ platform, env, home });
      const notes = env.CODEX_HOME ? [`CODEX_HOME is set: using ${p.join(ch, 'config.toml')}`] : [];
      return { ...common, notes, configRoot: ch, skillsDir: agentsSkills, mcpConfig: p.join(ch, 'config.toml'), format: 'codex-toml', serversDir };
    }
    case 'gemini':
      // ~/.gemini/settings.json (user), .gemini/settings.json (project)
      return { ...common, skillsDir: agentsSkills, mcpConfig: p.join(base, '.gemini', 'settings.json'), format: 'gemini-json', serversDir };
    case 'cursor':
      // ~/.cursor/mcp.json (global), .cursor/mcp.json (project)
      return { ...common, skillsDir: agentsSkills, mcpConfig: p.join(base, '.cursor', 'mcp.json'), format: 'cursor-json', serversDir };
    case 'vscode':
      // .vscode/mcp.json (workspace). The user-profile mcp.json location is not documented as a path,
      // so user scope uses the documented `code --add-mcp` command instead.
      return scope === 'project'
        ? { ...common, skillsDir: agentsSkills, mcpConfig: p.join(cwd, '.vscode', 'mcp.json'), format: 'vscode-json', serversDir }
        : { ...common, configRoot: null, skillsDir: agentsSkills, mcpConfig: null, format: 'vscode-json', serversDir, manual: 'code --add-mcp' };
    case 'claude-desktop': {
      if (scope === 'project') return { ...common, skillsDir: null, mcpConfig: null, format: null, serversDir, unsupported: 'Claude Desktop has no project scope' };
      const app = appDataDir({ platform, env, home });
      return { ...common, configRoot: app, skillsDir: null, mcpConfig: p.join(app, 'Claude', 'claude_desktop_config.json'), format: 'claude-desktop-json', serversDir };
    }
    case 'windsurf':
      // Windsurf is now Devin Local. docs.devin.ai/cli/extensibility/mcp/configuration (checked 2026-11-08):
      // project .devin/mcp_config.json, user ~/.config/devin/mcp_config.json or %APPDATA%\devin\mcp_config.json
      // on Windows; "mcpServers" with command/args/env. Still export only: ${env:VAR} is documented for
      // OAuth fields only, not for `env`, and the Devin Local page links to the CLI docs without saying
      // in so many words that it reads the same files (docs/providers.md).
      return {
        ...common,
        skillsDir: null,
        mcpConfig:
          scope === 'project'
            ? p.join(cwd, '.devin', 'mcp_config.json')
            : platform === 'win32'
              ? p.join(appDataDir({ platform, env, home }), 'devin', 'mcp_config.json')
              : p.join(home, '.config', 'devin', 'mcp_config.json'),
        format: 'windsurf-json',
        serversDir,
        unsupported:
          'Windsurf/Devin: the mcp_config.json format is documented, but env interpolation in "env" and whether Devin Local reads the CLI files are unverified; use `export --target windsurf` and paste by hand',
      };
    default:
      return null;
  }
}

export const INSTALL_TARGETS = ['agents', 'codex', 'gemini', 'cursor', 'vscode', 'claude-desktop', 'windsurf'];

/** Folders other tools read live; `export --out` must not point at (or inside) them. */
export function liveToolDirs({ platform = process.platform, env = process.env } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let home;
  try {
    home = homeDir({ platform, env });
  } catch {
    return [];
  }
  const dirs = ['.agents', '.codex', '.gemini', '.cursor', '.vscode', '.claude', '.copilot', '.kktest-dev', '.codeium'].map((d) => p.join(home, d));
  const app = appDataDir({ platform, env, home });
  dirs.push(p.join(app, 'Claude'), p.join(home, '.config', 'devin'));
  if (platform === 'win32') dirs.push(p.join(app, 'devin')); // Devin's Windows user config (docs.devin.ai)
  if (env.CODEX_HOME && p.isAbsolute(env.CODEX_HOME)) dirs.push(env.CODEX_HOME);
  return dirs;
}
