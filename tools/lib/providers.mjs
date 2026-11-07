// The one table of export/install targets (G6 S1, issue #23). cli, paths, mcp, export and install read their
// target lists, config keys, env-reference syntax, file names and how-to text from here, so adding or changing a
// target is one edit. Facts come from the vendor docs listed in docs/providers.md; tools/test/providers.test.mjs
// checks that its "Per tool" section names exactly the providers below.
// Per-OS config paths stay in paths.mjs (targetPaths): they are logic, not data.

/**
 * Row order is the order every list is shown in (EXPORT_TARGETS, INSTALL_TARGETS, SKILL_TARGETS, --help).
 * provider     the tool's section heading in docs/providers.md (null: a folder several tools share)
 * export       what `export --target <id>` writes: 'skills' (folders or zips), 'extension' (skills + MCP in one
 *              folder), 'mcp' (a config snippet + server files); absent: not an export target
 * install      true: an `install --target <id>`; installMcp: install also writes its MCP config
 * configKey    the JSON key servers go under; envRef: how the tool spells "read NAME from the environment"
 *              (null: no reference syntax documented, so a placeholder is written instead)
 * exportFile   the snippet file `export` writes; howTo: the NOTES.txt line saying where it goes
 * exportHelp / installHelp   the target's line(s) in `export --help` / `install --help`
 * unverified   the MCP format is not confirmed from an official page (export only, never installed)
 */
export const TARGETS = Object.freeze([
  {
    id: 'agents',
    provider: null,
    export: 'skills',
    install: true,
    howTo: 'Copy skills/<name>/ into .agents/skills/ (project) or ~/.agents/skills/ (user). Read by Codex, Gemini CLI, VS Code Copilot, Copilot CLI and Cursor.',
    exportHelp: '.agents/skills/<name>/ (Codex, Gemini CLI, VS Code Copilot, Copilot CLI, Cursor)',
    installHelp: ['skills -> ~/.agents/skills (or ./.agents/skills with --scope project)'],
  },
  {
    id: 'claude-ai',
    provider: 'claude.ai',
    export: 'skills',
    howTo:
      'Upload each zip at claude.ai: Customize > Skills > + > Create skill > Upload a skill (code execution must be enabled). Documented: name at most 64 characters, description at most 200, the skill folder at the zip root. Zip size limit: UNVERIFIED (not documented; these zips stay within the OpenAI API limits of 50 MB / 500 files / 25 MB per file).',
    exportHelp: 'one .zip per skill for claude.ai upload (description <= 200 chars)',
  },
  {
    id: 'chatgpt',
    provider: 'ChatGPT',
    export: 'skills',
    howTo:
      "Upload each zip in ChatGPT: Plugins > Skills > Create > Upload from your computer. The zips stay within the documented OpenAI API skill limits (50 MB zip, 500 files, 25 MB per file); the ChatGPT app's own size limit and Plus/Pro eligibility are UNVERIFIED (its help page refuses automated reads).",
    exportHelp: 'one .zip per skill for ChatGPT upload',
  },
  {
    id: 'gemini-extension',
    provider: 'Gemini CLI',
    export: 'extension',
    exportHelp: 'a Gemini CLI extension folder (gemini-extension.json + skills + MCP servers)',
  },
  {
    id: 'codex',
    provider: 'Codex CLI',
    export: 'mcp',
    install: true,
    installMcp: true,
    exportFile: 'config.toml',
    howTo: 'Append config.toml to ~/.codex/config.toml (or .codex/config.toml in a trusted project).',
    exportHelp: 'config.toml [mcp_servers.*] snippet + server files',
    installHelp: [
      'skills + [mcp_servers.*] appended to ~/.codex/config.toml, $CODEX_HOME/config.toml',
      'when CODEX_HOME is set (or .codex/config.toml with --scope project)',
    ],
  },
  {
    id: 'gemini',
    provider: 'Gemini CLI',
    install: true,
    installMcp: true,
    configKey: 'mcpServers',
    envRef: (n) => `\${${n}}`, // geminicli.com/docs/tools/mcp-server ($VAR / ${VAR})
    installHelp: ['skills + mcpServers merged into ~/.gemini/settings.json (or .gemini/settings.json)'],
  },
  {
    id: 'cursor',
    provider: 'Cursor',
    export: 'mcp',
    install: true,
    installMcp: true,
    configKey: 'mcpServers',
    envRef: (n) => `\${env:${n}}`, // cursor.com/docs/mcp
    exportFile: 'mcp.json',
    howTo: 'Merge mcp.json into ~/.cursor/mcp.json (or .cursor/mcp.json in the project).',
    exportHelp: 'mcp.json snippet + server files',
    installHelp: ['skills + mcpServers merged into ~/.cursor/mcp.json (or .cursor/mcp.json)'],
  },
  {
    id: 'vscode',
    provider: 'GitHub Copilot',
    export: 'mcp',
    install: true,
    installMcp: true,
    configKey: 'servers',
    envRef: (n) => `\${env:${n}}`, // code.visualstudio.com/docs/agents/reference/mcp-configuration
    exportFile: 'mcp.json',
    howTo: 'Merge mcp.json ("servers") into .vscode/mcp.json, or run "MCP: Open User Configuration" and paste there.',
    exportHelp: '.vscode/mcp.json ("servers") snippet + server files',
    installHelp: ['skills + servers merged into .vscode/mcp.json (project); user scope prints', 'the "code --add-mcp" command to run'],
  },
  {
    id: 'claude-desktop',
    provider: 'Claude Desktop',
    export: 'mcp',
    install: true,
    installMcp: true,
    configKey: 'mcpServers',
    envRef: null, // no reference support documented
    exportFile: 'claude_desktop_config.json',
    howTo:
      'Merge into claude_desktop_config.json (macOS ~/Library/Application Support/Claude/, Windows %APPDATA%\\Claude\\, Linux ~/.config/Claude/) and restart Claude Desktop.',
    exportHelp: 'claude_desktop_config.json snippet + server files',
    installHelp: ['mcpServers merged into claude_desktop_config.json (user scope only)'],
  },
  {
    id: 'windsurf',
    provider: 'Windsurf',
    export: 'mcp',
    install: true,
    unverified: true,
    configKey: 'mcpServers',
    envRef: null, // unverified
    exportFile: 'mcp_config.json',
    howTo:
      'Windsurf is now Devin Local (docs.devin.ai). Merge mcp_config.json ("mcpServers") into .devin/mcp_config.json (project), ~/.config/devin/mcp_config.json (user) or %APPDATA%\\devin\\mcp_config.json (Windows user). UNVERIFIED: whether Devin Local reads exactly these files (its page links to the Devin CLI docs for them).',
    exportHelp: 'mcp_config.json snippet (UNVERIFIED format) + server files',
    installHelp: ['refused: config format unverified (use export --target windsurf)'],
  },
].map((t) => Object.freeze(t)));

const ids = (pred) => Object.freeze(TARGETS.filter(pred).map((t) => t.id));

export const TARGET = Object.freeze(Object.fromEntries(TARGETS.map((t) => [t.id, t])));
export const EXPORT_TARGETS = ids((t) => t.export);
export const INSTALL_TARGETS = ids((t) => t.install);
/** install targets that also write an MCP config */
export const INSTALL_MCP_TARGETS = ids((t) => t.installMcp);
/** where a skill can go: the skill-folder and zip targets, then the bundles */
export const SKILL_TARGETS = Object.freeze([...ids((t) => t.export === 'skills'), ...ids((t) => t.export === 'extension')]);
/** where an MCP server can go: the config-snippet targets, then the bundles */
export const MCP_TARGETS = Object.freeze([...ids((t) => t.export === 'mcp'), ...ids((t) => t.export === 'extension')]);
/** the tools docs/providers.md has a "Per tool" section for, each once, in table order */
export const PROVIDERS = Object.freeze([...new Set(TARGETS.map((t) => t.provider).filter(Boolean))]);
/** targets whose MCP format is not confirmed from an official page */
export const UNVERIFIED_TARGETS = ids((t) => t.unverified);

/** "a, b or c" */
export const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

/** `--help` lines for a set of targets: the id in a column `width` wide, continuation lines aligned under the text */
export function helpRows(targets, field, width) {
  return targets
    .flatMap((id) => [].concat(TARGET[id][field]).map((line, i) => `  ${(i ? '' : id).padEnd(width)}  ${line}`))
    .join('\n');
}
