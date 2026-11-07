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
2 refused (nothing was written) or failed while writing (one `ERROR:` line naming any backup).

## What carries over

Only skills and MCP servers are portable. Claude Code **hooks** (focus-notify, loop-ledger's Stop
gate, memory-keeper's auto-compact, tool-metrics) and **slash commands** have no equivalent in the
other tools' documented formats and are skipped with a reason line.

| Plugin | Tier | Skills | MCP server | Claude Code only |
|---|---|---|---|---|
| kkskills-situational | portable | 10 | - | - |
| kkskills-essentials | with fallbacks | 4 | - | - |
| kkskills-personal | with fallbacks (opt-in: `--plugin kkskills-personal`) | 2 | - | - |
| agent-loops | with fallbacks | 6 | - | - |
| infographic-diagram | with fallbacks (needs python3; PNG needs playwright) | 1 | - | - |
| prompt-evolve | with fallbacks (python3; script bundled into the skill) | 1 | - | slash commands |
| critique-gate | partly Claude-only (advisory elsewhere) | 1 | - | slash commands, Stop-hook enforcement |
| memory-keeper | partly Claude-only | 1 | `memory-keeper` (python3) | hooks, slash commands |
| reflexion | partly Claude-only | 1 | `reflexion` (python3) | slash commands |
| loop-ledger | Claude-only (its MCP server is portable) | - | `loop-ledger` (node) | Stop hook |
| focus-notify, tool-metrics | Claude-only | - | - | everything |
| kktestdev-pack | Claude-only (onboarding pack: its skills install Claude Code plugins) | 2 (not exported) | - | everything |

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
- Each target folder gets a `.kktest-dev-export` manifest of the files written. A re-export deletes only
  those files; anything else in the folder (a skill you added) is kept, and a file the manifest does not
  list is never overwritten. `--out` may not be your home folder or a folder a tool reads live
  (`~/.agents`, `~/.codex`, `~/.cursor`, …); use `install` for those.
- MCP targets (codex, cursor, vscode, claude-desktop, windsurf) write a config that points at the
  `servers/` folder inside the export with absolute paths. Keep that folder where it is, or move it first
  and fix the paths, or use `install`, which copies the servers to `~/.kktest-dev/servers/`.

### How `install` writes

- Dry run unless `--apply`. With `--apply` it asks before writing (or `--yes`); without a terminal and
  without `--yes` it refuses.
- Every config file it changes is first copied to a new `<file>.kktest-dev.bak-<timestamp>-<random>`.
  JSON is merged (other servers and settings are kept) and written atomically: a temp file with a random
  name, created exclusively (a file or link already at that name is never followed), then a rename. The
  file keeps its permissions (a 0600 config stays 0600); a new config is created 0600. A UTF-8 BOM and
  CRLF line endings are kept.
- A server or skill with the same name is a collision: refused unless `--force`. `--force` applies to
  JSON configs and skill folders only; an existing Codex TOML table is never replaced. A replaced skill
  folder is moved to `~/.kktest-dev/backups/<timestamp>-<random>/` (not next to it, where the tool would
  load it twice); across drives it is copied, then deleted. If the new folder cannot be moved into place
  (on Windows a rename is retried for about a second first), the old folder is put back and the command
  ends with one `ERROR:` line and exit 2.
- Symlinks: with `--scope project`, any link on the way to a file or folder it would write (for example
  `.codex/config.toml` or `.agents/skills` pointing elsewhere) is refused, in the dry run too, because a
  cloned repo can point a link at your files. For user scope, a config that is a link into your home
  folder (dotfiles) is updated where it points and the link is kept; a link that leads outside is refused
  with the snippet to paste.
- Right before writing it re-checks every target; if a config changed since the plan was printed, nothing
  is written. `~/.kktest-dev/install.lock` keeps two installs from running at once.
- JSON files that contain comments (VS Code allows them) are never rewritten: the snippet to paste is
  printed instead. Invalid JSON is refused the same way.
- Codex `config.toml`: new `[mcp_servers.<name>]` tables are appended only when absent. There is no TOML
  parser here, so an existing table, or any layout it cannot read safely (`[mcp_servers]`, dotted keys,
  inline tables), is refused with the table to add by hand.
- MCP server files are copied to `~/.kktest-dev/servers/<plugin>/` and configs point there with absolute
  paths, so nothing depends on the npx cache.
- Secret values are never printed or written: env values that are references stay references in each
  tool's syntax. The three bundled servers need no secrets; their only env values are file paths.

## Per tool

Facts below come from each vendor's documentation (checked 2026-11-07; Windsurf/Devin, Claude Desktop,
claude.ai and ChatGPT re-checked 2026-11-08 for issues #24 and #25; sources at the end). Items
marked **UNVERIFIED** could not be confirmed from an official page; for those kktest-dev only prints
text for you to check, it never writes them.

### Codex CLI (and the ChatGPT desktop app, which shares its config)

- Skills: `.agents/skills/` in the repo, `~/.agents/skills/` for the user.
- MCP: `[mcp_servers.<name>]` in `~/.codex/config.toml` (user; `$CODEX_HOME/config.toml` when
  `CODEX_HOME` is set, which the installer honours) or `.codex/config.toml` (trusted projects). No
  `${VAR}` interpolation; variables are forwarded with `env_vars = ["NAME"]`.
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
  On Windows it prints two forms: one for cmd.exe, and one for PowerShell that adds the stop-parsing
  token `--%` (PowerShell does not treat `\"` as an escape). REASONED: not run on Windows.
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
  Windows `%APPDATA%\Claude\` (`%USERPROFILE%\AppData\Roaming` when APPDATA is unset), Linux
  `$XDG_CONFIG_HOME/Claude/` or `~/.config/Claude/`. Restart the app afterwards. The same rule as the
  kktestdev-pack onboarding scan (`hosts.mjs`).
- Env references: the official page (modelcontextprotocol.io, re-checked 2026-11-08) documents only
  literal `env` values and documents no `${VAR}` expansion; its Windows troubleshooting tells you to put
  the expanded value of `%APPDATA%` into `env`. So a secret is written as a `<set NAME here>`
  placeholder with a note to fill it in by hand (the bundled servers have none). Not tested against the
  app itself.
- The page lists only `~/.config/Claude/` for Linux; honouring `$XDG_CONFIG_HOME` is REASONED (it matches
  `hosts.mjs`), not documented.
- Skills: upload the claude.ai zips (below). Desktop Extensions (`.mcpb`) are not generated.

```bash
npx kktest-dev install --target claude-desktop
```

### claude.ai

- Upload: Customize > Skills > + > Create skill > Upload a skill. One zip per skill, the skill folder at
  the zip root (the folder name matching the skill name), `name` at most 64 and `description` at most 200
  characters, code execution enabled. Zip size and file-count limits: not documented (UNVERIFIED); the
  exporter keeps every zip within the OpenAI API limits below.
- MCP: only remote connectors; the bundled stdio servers cannot run there.

```bash
npx kktest-dev export --target claude-ai     # kktest-dev-export/claude-ai/<skill>.zip
```

### ChatGPT

What the official pages say (re-checked 2026-11-08):

- Custom GPTs are being retired. OpenAI's guide "Moving your custom GPT workflows to plugins"
  (learn.chatgpt.com/docs/migrate-custom-gpts) says that at retirement custom GPTs stop running and
  leave the GPT directory, that new GPT creation stops, and that migrating a GPT copies its
  knowledge files into the new plugin. So kktest-dev does not target custom GPT knowledge files.
  The dates (retirement on 2026-12-11; 2027-02-11 for Enterprise workspaces with a deferral) come
  from the ChatGPT release notes as quoted in search results; help.openai.com answers automated reads
  with HTTP 403, so the dates are UNVERIFIED here.
- Skills: "Build skills" (learn.chatgpt.com/docs/build-skills) documents a skill as a folder with a
  `SKILL.md` (with `name` and `description`) plus optional `scripts/`, `references/` and `assets/`,
  and says plugins are the way to share skills with other people. That is the folder each export
  zip holds.
- The OpenAI **API** documents its skill-bundle limits: a zip of at most 50 MB with one top-level
  folder, at most 500 files, at most 25 MB per file, exactly one `SKILL.md`. The exporter refuses a
  zip over any of these, so an export fits the API and is the best bound we have for the app.
- UNVERIFIED: the upload steps in the ChatGPT app (the menu path below and a `chatgpt.com/skills`
  page come from search snippets of help articles that return 403), the app's own size limit, and
  which plans can upload. The pages above document neither.
- Project files (not used by kktest-dev): UNVERIFIED. The File uploads FAQ
  (https://help.openai.com/en/articles/8555545-file-uploads-faq) returns 403; its search snippet says
  Projects take up to 20 files on Plus and 40 on Pro, Team, Edu and Business.
- MCP (web): remote servers only (developer mode / apps); stdio is not possible. The desktop app shares
  Codex's config, so use the Codex target there.

To upload: try Plugins > Skills > Create > Upload from your computer (UNVERIFIED path), one zip per
skill.

```bash
npx kktest-dev export --target chatgpt
```

### Windsurf (now Devin Local): export only

The Windsurf docs redirect to Devin Local. Its customization page lists `.devin/mcp_config.json`
(project, committed), `.devin/mcp_config.local.json` (personal, gitignored) and
`~/.config/devin/mcp_config.json` (user), and links to the Devin CLI MCP page for the format. That page
(re-checked 2026-11-08) documents a top-level `mcpServers` object with `command`, `args`, `env` and
`disabled`, and the Windows user file `%APPDATA%\devin\mcp_config.json`. Skills: `.devin/skills/` and
`.agents/skills/` (workspace), `~/.config/devin/skills/` and `~/.agents/skills/` (global), so
`install --target agents` already covers Devin's skills. Rules (not written by kktest-dev): `AGENTS.md`, `.devin/rules/*.md`,
`.devin/global_rules.md` (project), `~/.devin/rules/*.md`, `~/.devin/global_rules.md` (user); the legacy
`.windsurf/rules/*.md`, `.windsurf/global_rules.md` and `.windsurfrules` are still imported. Hooks:
`.devin/hooks.v1.json`. MCP config moved from `config.json` to `mcp_config.json` in Devin CLI v3000.3
(old entries are migrated on startup).

Still UNVERIFIED, so `install --target windsurf` refuses and `export --target windsurf` writes an
`mcpServers` snippet (with placeholders for any secrets) for you to paste:

- env interpolation inside `env`: `${env:VAR}` is documented only for the OAuth fields;
- that Devin Local reads exactly the CLI's files (its page says customizations "work in the other" and
  lists the same paths, but does not say so for MCP in so many words);
- the legacy Windsurf editor's own `~/.codeium/windsurf/mcp_config.json`, which kktest-dev never writes.

## Unverified / gaps

- ChatGPT skills upload (app): menu path, size limit and plan eligibility (the API limits are documented;
  the app's are not). Custom GPT retirement dates (the retirement itself is documented).
- ChatGPT developer mode: plan availability and the exact menu path.
- Windsurf/Devin: env interpolation inside `env`; whether Devin Local reads the CLI's `mcp_config.json`
  files (paths and format are documented, so only these two block `install`).
- Claude Desktop: no env-variable expansion is documented, so none is used; not tested against the app.
- Hooks in Codex, Cursor and Copilot; Cursor rules format; Copilot coding agent MCP config.
- claude.ai zip size limit; its help page says `description` ≤ 200 (and `name` ≤ 64) while the Agent
  Skills spec allows 1024 (kktest-dev uses 200 for zip targets).
- Gemini CLI was not run locally.

## Known limits

- Project-scope configs contain absolute paths to `~/.kktest-dev/servers/…`; do not commit them for a team.
- The bundled servers start with `python3` / `node`. On stock Windows `python3` is often only the
  Microsoft Store alias: change the command to `py` with `-3` as the first argument, or to `python`
  (the installer prints this note on Windows). The repo's own `npm test` picks `python3`, `python` or
  `py -3` by itself.
- GUI apps (Claude Desktop, Cursor started from the Dock or Start menu) may not see the shell `PATH` set up
  by nvm, mise or pyenv; if a server does not start, put the full path to `node` / `python3` in the config.
- WSL: run kktest-dev on the side where the tool runs. Claude Desktop, Cursor and VS Code run on Windows
  and read `%APPDATA%` / `%USERPROFILE%`, not the Linux home, so install them from Windows (the installer
  prints a note when it detects WSL). Codex, Gemini CLI and `.agents/skills` inside WSL are fine.
- Skills that depend on the loop-ledger Stop hook (critique-gate, agent-loops) are advisory elsewhere.
- The PNG step of infographic-diagram needs playwright + Chromium, which sandboxed web hosts usually lack;
  SVG output works wherever python3 runs.

## Releasing (maintainers)

`.github/workflows/publish.yml` publishes to npm when a `v*` tag is pushed. It checks that the tag is
`v<package.json version>` and that the tagged commit is on master (an ancestor of `origin/master`; a tag on a
side branch is refused), runs the same three test suites as CI and `npm pack --dry-run`, skips a version
that is already on the registry (a registry lookup that fails for another reason, such as the network, stops
the run), then runs `npm publish --provenance --access public`. Provenance (signed
with the job's `id-token: write` OIDC token) links the tarball on npmjs.com to the commit and workflow run;
it needs a GitHub-hosted runner and a public repo (this one is). Node is the latest LTS (`lts/*`).

Manual run: Actions > Publish > Run workflow. `dry_run` defaults to true and ends in
`npm publish --dry-run` (nothing is uploaded); a real publish from a manual run is refused unless it runs on
a `v*` tag.

One-time setup by the package owner, before the first tagged release:

1. Create an npm token that can publish `kktest-dev` (granular access token, or an automation token) and
   save it in GitHub > Settings > Secrets and variables > Actions as `NPM_TOKEN` (a repository secret, or a
   secret of the `npm-publish` environment).
2. GitHub > Settings > Environments > `npm-publish` (created on the first run): add required reviewers
   (each publish waits for approval) and, under Deployment branches and tags, allow only the `v*` tag
   pattern. The workflow's own checks run inside the job; anyone who can push a tag can start that job, so
   these two settings are what keep `NPM_TOKEN` from being used without a maintainer. They cannot be set
   from the repository files: the owner sets them once.

Without `NPM_TOKEN` the publish step fails and nothing is published; publish by hand (`pnpm publish`) as
before, and the workflow then skips that version. npm trusted publishing (OIDC, no stored token,
docs.npmjs.com/trusted-publishers, checked 2026-11-08) would also work: it needs npm 11.5.1 or later and a
trusted publisher entry for workflow `publish.yml` on npmjs.com; the workflow does not use it yet.

## Sources

- Agent Skills: https://agentskills.io/specification
- Codex: https://learn.chatgpt.com/docs/build-skills , https://learn.chatgpt.com/docs/extend/mcp?surface=cli ; local `codex mcp add --help` (0.165.0)
- ChatGPT: https://learn.chatgpt.com/docs/extend/mcp , https://developers.openai.com/api/docs/guides/tools-skills.md , https://help.openai.com/en/articles/20001066-skills-in-chatgpt (search snippet only), https://help.openai.com/en/articles/8555545-file-uploads-faq (search snippet only; both 403 on 2026-11-08), https://learn.chatgpt.com/docs/migrate-custom-gpts , https://learn.chatgpt.com/docs/build-skills (2026-11-08)
- Gemini CLI: https://geminicli.com/docs/cli/skills/ , https://geminicli.com/docs/extensions/reference/ , https://geminicli.com/docs/tools/mcp-server/
- VS Code / Copilot: https://code.visualstudio.com/docs/copilot/customization/agent-skills , https://code.visualstudio.com/docs/agents/reference/mcp-configuration , https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
- Cursor: https://cursor.com/docs/skills , https://cursor.com/docs/mcp
- Windsurf / Devin: https://docs.devin.ai/desktop/cascade/mcp , https://docs.devin.ai/cli/extensibility/mcp/configuration (2026-11-08)
- Claude Desktop: https://modelcontextprotocol.io/docs/develop/connect-local-servers (2026-11-08) , https://support.claude.com/en/articles/10949351
- claude.ai: https://support.claude.com/en/articles/12512180-using-skills-in-claude , https://support.claude.com/en/articles/12512198-how-to-create-custom-skills (2026-11-08)
- npm provenance and trusted publishing: https://docs.npmjs.com/generating-provenance-statements , https://docs.npmjs.com/trusted-publishers (2026-11-08)
