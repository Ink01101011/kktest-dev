// Config and skill locations per target, per OS. Pure: platform, env and cwd are injected.
// Every path here comes from the vendor docs listed in docs/providers.md.
import path from 'node:path';

export function homeDir({ platform, env }) {
  const h = platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME;
  if (!h) throw new Error(platform === 'win32' ? 'USERPROFILE is not set' : 'HOME is not set');
  return h;
}

/**
 * @returns {{skillsDir: string|null, mcpConfig: string|null, format: string|null, serversDir: string, manual?: string}}
 */
export function targetPaths(target, { platform = process.platform, env = process.env, scope = 'user', cwd = process.cwd() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const home = homeDir({ platform, env });
  const base = scope === 'project' ? cwd : home;
  // .agents/skills: Codex, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor (P0 section 0).
  const agentsSkills = p.join(base, '.agents', 'skills');
  // Our own copy of MCP server runtimes, so configs never point into an npx cache.
  const serversDir = p.join(home, '.kktest-dev', 'servers');
  switch (target) {
    case 'agents':
      return { skillsDir: agentsSkills, mcpConfig: null, format: null, serversDir };
    case 'codex':
      // ~/.codex/config.toml (user), .codex/config.toml (project, trusted projects only)
      return { skillsDir: agentsSkills, mcpConfig: p.join(base, '.codex', 'config.toml'), format: 'codex-toml', serversDir };
    case 'gemini':
      // ~/.gemini/settings.json (user), .gemini/settings.json (project)
      return { skillsDir: agentsSkills, mcpConfig: p.join(base, '.gemini', 'settings.json'), format: 'gemini-json', serversDir };
    case 'cursor':
      // ~/.cursor/mcp.json (global), .cursor/mcp.json (project)
      return { skillsDir: agentsSkills, mcpConfig: p.join(base, '.cursor', 'mcp.json'), format: 'cursor-json', serversDir };
    case 'vscode':
      // .vscode/mcp.json (workspace). The user-profile mcp.json location is not documented as a path,
      // so user scope uses the documented `code --add-mcp` command instead.
      return scope === 'project'
        ? { skillsDir: agentsSkills, mcpConfig: p.join(cwd, '.vscode', 'mcp.json'), format: 'vscode-json', serversDir }
        : { skillsDir: agentsSkills, mcpConfig: null, format: 'vscode-json', serversDir, manual: 'code --add-mcp' };
    case 'claude-desktop': {
      if (scope === 'project') return { skillsDir: null, mcpConfig: null, format: null, serversDir, unsupported: 'Claude Desktop has no project scope' };
      let cfg;
      if (platform === 'darwin') cfg = p.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      else if (platform === 'win32') {
        if (!env.APPDATA) throw new Error('APPDATA is not set');
        cfg = p.join(env.APPDATA, 'Claude', 'claude_desktop_config.json');
      } else cfg = p.join(home, '.config', 'Claude', 'claude_desktop_config.json');
      return { skillsDir: null, mcpConfig: cfg, format: 'claude-desktop-json', serversDir };
    }
    case 'windsurf':
      // docs.devin.ai lists .devin/mcp_config.json and ~/.config/devin/mcp_config.json, but the file
      // format and env interpolation were not verified from a fetched page: export only.
      return {
        skillsDir: null,
        mcpConfig: scope === 'project' ? p.join(cwd, '.devin', 'mcp_config.json') : p.join(home, '.config', 'devin', 'mcp_config.json'),
        format: 'windsurf-json',
        serversDir,
        unsupported: 'Windsurf/Devin config format is unverified; use `export --target windsurf` and paste by hand',
      };
    default:
      return null;
  }
}

export const INSTALL_TARGETS = ['agents', 'codex', 'gemini', 'cursor', 'vscode', 'claude-desktop', 'windsurf'];
