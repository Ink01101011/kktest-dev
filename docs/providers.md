# Using kktest-dev with other AI tools

kktest-dev is a Claude Code plugin marketplace, but most of its **skills** follow the open
[Agent Skills](https://agentskills.io/specification) format and its three **MCP servers** are plain
stdio servers. The `kktest-dev` npm package exports or installs them for other tools.

```bash
npx kktest-dev list                              # plugins, skills, MCP servers, portability tier, targets
npx kktest-dev export --target agents            # .agents/skills/<name>/ folders
npx kktest-dev install --target cursor           # dry run: prints exactly what would change
npx kktest-dev install --target cursor --apply   # backs up, merges, asks before writing
```

From a clone, run `node tools/cli.mjs …` instead of `npx kktest-dev …` (Node 22 or later, no
dependencies). `kktest-dev <command> --help` lists every option. Exit codes: 0 ok, 1 usage error,
2 refused (nothing unsafe was written).

## What carries over

Only skills and MCP servers are portable. Claude Code **hooks** (focus-notify, loop-ledger's Stop
gate, memory-keeper's auto-compact, tool-metrics) and **slash commands** have no equivalent in the
other tools' documented formats and are skipped with a reason line.

| Plugin | Tier | Skills | MCP server | Claude Code only |
|---|---|---|---|---|
| kkskills-situational | portable | 9 | - | - |
| kkskills-essentials | with fallbacks | 5 | - | - |
| kkskills-personal | with fallbacks (opt-in: `--plugin kkskills-personal`) | 2 | - | - |
| agent-loops | with fallbacks | 6 | - | - |
| infographic-diagram | with fallbacks (needs python3; PNG needs playwright) | 1 | - | - |
| prompt-evolve | with fallbacks (python3; script bundled into the skill) | 1 | - | slash commands |
| critique-gate | partly Claude-only (advisory elsewhere) | 1 | - | slash commands, Stop-hook enforcement |
| memory-keeper | partly Claude-only | 1 | `memory-keeper` (python3) | hooks, slash commands |
| reflexion | partly Claude-only | 1 | `reflexion` (python3) | slash commands |
| loop-ledger | Claude-only (its MCP server is portable) | - | `loop-ledger` (node) | Stop hook |
| focus-notify, tool-metrics | Claude-only | - | - | everything |

Skills that name Claude-only tools carry a short **Other agents** section with the plain fallback.

### What the exporter changes (in the exported copy only, never the source)

- Top-level frontmatter keys outside the spec (`version`, `updated`) move under `metadata`.
- Zip targets (claude.ai, ChatGPT) use `metadata.short-description` when the description is over
  200 characters; if a skill has no short form the export fails and names the skill. Nothing is
  truncated.
- Files a skill references through `${CLAUDE_PLUGIN_ROOT}/…` (for example `scripts/memctl.py`) are
  copied into the skill folder and the references become skill-relative paths. reflexion also gets
  memory-keeper's `memctl.py`, which its CLI needs.
- Tests, `__pycache__`, `.pyc` and backups are left out. Output is sorted and zip timestamps are fixed
  (1980-01-01), so re-exporting gives byte-identical files.

### How `install` writes

- Dry run unless `--apply`. With `--apply` it asks before writing (or `--yes`); without a terminal and
  without `--yes` it refuses.
- Every config file it changes is first copied to `<file>.kktest-dev.bak-<timestamp>`. JSON is merged
  (other servers and settings are kept) and written atomically (temp file + rename).
- A server or skill with the same name is a collision: refused unless `--force`. A replaced skill folder
  is moved to `~/.kktest-dev/backups/<timestamp>/` (not next to it, where the tool would load it twice).
- JSON files that contain comments (VS Code, Cursor allow them) are never rewritten: the snippet to paste
  is printed instead. Invalid JSON is refused the same way.
- Codex `config.toml`: new `[mcp_servers.<name>]` tables are appended only when absent. There is no TOML
  parser here, so an existing table, or any layout it cannot read safely (`[mcp_servers]`, dotted keys,
  inline tables), is refused with the table to add by hand.
- MCP server files are copied to `~/.kktest-dev/servers/<plugin>/` and configs point there with absolute
  paths, so nothing depends on the npx cache.
- Secret values are never printed or written: env values that are references stay references in each
  tool's syntax. The three bundled servers need no secrets; their only env values are file paths.

## Per tool

Facts below come from each vendor's documentation (checked 2026-11-07, sources at the end). Items
marked **UNVERIFIED** could not be confirmed from an official page; for those kktest-dev only prints
text for you to check, it never writes them.

### Codex CLI (and the ChatGPT desktop app, which shares its config)

- Skills: `.agents/skills/` in the repo, `~/.agents/skills/` for the user.
- MCP: `[mcp_servers.<name>]` in `~/.codex/config.toml` (user) or `.codex/config.toml` (trusted
  projects). No `${VAR}` interpolation; variables are forwarded with `env_vars = ["NAME"]`.
- Hooks, slash commands: not supported by kktest-dev (Codex hooks UNVERIFIED).

```bash
npx kktest-dev install --target codex                  # skills + MCP, user scope
npx kktest-dev install --target codex --scope project  # .agents/skills + .codex/config.toml
npx kktest-dev export --target codex                   # config.toml snippet + server files
```

Manual: copy `kktest-dev-export/.agents/skills/*` to `~/.agents/skills/`, then add each server with
`codex mcp add <name> -- <command> <args…>` or paste the exported `config.toml`.

### Gemini CLI

- Skills: `.gemini/skills/` or `.agents/skills/` (workspace), `~/.gemini/skills/` or `~/.agents/skills/`
  (user), or inside an extension.
- MCP: `mcpServers` in `~/.gemini/settings.json` or `.gemini/settings.json`; env values may use `$VAR` /
  `${VAR}`.
- An extension (`gemini-extension.json` + `skills/` + `mcpServers`) bundles everything in one folder;
  server paths use `${extensionPath}${/}…`.
- Google's docs note Gemini CLI was replaced by Antigravity CLI on 2026-06-18 for unpaid and Google One
  users. `gemini` itself was not run while building this (UNVERIFIED locally).

```bash
npx kktest-dev export --target gemini-extension
gemini extensions install ./kktest-dev-export/gemini-extension/kktest-dev
# or: skills + settings.json merge
npx kktest-dev install --target gemini
```

### GitHub Copilot (VS Code and Copilot CLI)

- Skills: `.github/skills/`, `.claude/skills/`, `.agents/skills/` (project); `~/.copilot/skills/`,
  `~/.agents/skills/` (personal). Both VS Code and Copilot CLI read them.
- MCP (VS Code): `.vscode/mcp.json` with a top-level `servers` object, `"type": "stdio"`, env references
  `${env:NAME}`. The user-profile `mcp.json` is opened with "MCP: Open User Configuration"; its path is
  not documented, so user scope prints a `code --add-mcp '<json>'` command instead of writing a file.
- Copilot CLI MCP (`~/.copilot/mcp-config.json`) and the Copilot coding agent's MCP config: not handled
  (coding agent UNVERIFIED).

```bash
npx kktest-dev install --target vscode --scope project   # .agents/skills + .vscode/mcp.json
npx kktest-dev install --target vscode                    # ~/.agents/skills + prints code --add-mcp
npx kktest-dev install --target agents                    # skills only (Copilot CLI)
```

### Cursor

- Skills: `.agents/skills/`, `.cursor/skills/` and the user-level `~/.agents/skills/`, `~/.cursor/skills/`.
- MCP: `mcpServers` in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global); env references
  `${env:NAME}`.

```bash
npx kktest-dev install --target cursor
npx kktest-dev install --target cursor --scope project
```

### Claude Desktop

- MCP: `mcpServers` in `claude_desktop_config.json` — macOS `~/Library/Application Support/Claude/`,
  Windows `%APPDATA%\Claude\`, Linux `~/.config/Claude/`. Restart the app afterwards.
- Env references are not documented for this file, so a secret would be written as a
  `<set NAME here>` placeholder with a note to fill it in by hand (the bundled servers have none).
- Skills: upload the claude.ai zips (below). Desktop Extensions (`.mcpb`) are not generated.

```bash
npx kktest-dev install --target claude-desktop
```

### claude.ai

- Upload: Customize > Skills > + > Create skill > Upload a skill. One zip per skill, the skill folder at
  the zip root, `description` at most 200 characters, code execution enabled. Zip size limit: UNVERIFIED.
- MCP: only remote connectors; the bundled stdio servers cannot run there.

```bash
npx kktest-dev export --target claude-ai     # kktest-dev-export/claude-ai/<skill>.zip
```

### ChatGPT

- Skills (web): Plugins > Skills > Create > Upload from your computer. The same zips as claude.ai.
  Accepted formats, size limit and Plus/Pro eligibility: UNVERIFIED (the help article could not be read).
  Personal skills are documented for Business, Enterprise, Healthcare and Edu.
- MCP (web): remote servers only (developer mode / apps); stdio is not possible. The desktop app shares
  Codex's config, so use the Codex target there.

```bash
npx kktest-dev export --target chatgpt
```

### Windsurf (now Devin Local) — UNVERIFIED, export only

The Windsurf docs now redirect to Devin Local, which lists `.devin/mcp_config.json` (project) and
`~/.config/devin/mcp_config.json` (user). The file format and env interpolation could not be confirmed
from a fetched page, so `install --target windsurf` refuses and
`export --target windsurf` writes an `mcpServers` snippet with placeholders for any secrets. Check it
against the tool's docs before pasting. `.agents/skills` support is UNVERIFIED (only the legacy
`.windsurf/skills/` is mentioned).

## Unverified / gaps

- ChatGPT skills upload: accepted formats, size limit, Plus/Pro eligibility.
- ChatGPT developer mode: plan availability and the exact menu path.
- Windsurf/Devin: user MCP path (one FAQ mentions `~/.codeium/mcp_config.json`), env interpolation,
  `.agents/skills` support.
- Claude Desktop: env-variable expansion in `claude_desktop_config.json`.
- Hooks in Codex, Cursor and Copilot; Cursor rules format; Copilot coding agent MCP config.
- claude.ai zip size limit; its help page says `description` ≤ 200 while the Agent Skills spec allows 1024
  (kktest-dev uses 200 for zip targets).
- Gemini CLI was not run locally.

## Known limits

- Project-scope configs contain absolute paths to `~/.kktest-dev/servers/…`; do not commit them for a team.
- The bundled servers start with `python3` / `node`. On Windows, where only `python` may exist, edit the
  command in the written config.
- Skills that depend on the loop-ledger Stop hook (critique-gate, agent-loops) are advisory elsewhere.
- The PNG step of infographic-diagram needs playwright + Chromium, which sandboxed web hosts usually lack;
  SVG output works wherever python3 runs.

## Sources

- Agent Skills: https://agentskills.io/specification
- Codex: https://learn.chatgpt.com/docs/build-skills , https://learn.chatgpt.com/docs/extend/mcp?surface=cli ; local `codex mcp add --help` (0.165.0)
- ChatGPT: https://learn.chatgpt.com/docs/extend/mcp , https://developers.openai.com/api/docs/guides/tools-skills.md , https://help.openai.com/en/articles/20001066-skills-in-chatgpt (search snippet only)
- Gemini CLI: https://geminicli.com/docs/cli/skills/ , https://geminicli.com/docs/extensions/reference/ , https://geminicli.com/docs/tools/mcp-server/
- VS Code / Copilot: https://code.visualstudio.com/docs/copilot/customization/agent-skills , https://code.visualstudio.com/docs/agents/reference/mcp-configuration , https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- Cursor: https://cursor.com/docs/skills , https://cursor.com/docs/mcp
- Windsurf / Devin: https://docs.devin.ai/desktop/cascade/mcp
- Claude Desktop: https://modelcontextprotocol.io/docs/develop/connect-local-servers , https://support.claude.com/en/articles/10949351
- claude.ai: https://support.claude.com/en/articles/12512180-using-skills-in-claude , https://support.claude.com/en/articles/12512198-how-to-create-custom-skills
