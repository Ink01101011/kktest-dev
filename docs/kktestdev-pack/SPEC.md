# kktestdev-pack — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).
Paths below are under `plugins/kktestdev-pack/`.

## 1. Components

| File | Role |
|---|---|
| `skills/kk-onboard/SKILL.md` | the onboarding flow (Steps 1-7) |
| `skills/kk-update/SKILL.md` | the update flow |
| `skills/kk-onboard/pack.json` | the catalog: `items`, `overlapGroups`, `marketplaces`, notes |
| `skills/kk-onboard/pack.schema.json` | JSON Schema for `pack.json` |
| `skills/kk-onboard/scripts/inventory.mjs` | inventory + audit, read-only |
| `skills/kk-onboard/scripts/options.mjs` | options discovery; writes only its state file |
| `skills/kk-onboard/scripts/hosts.mjs` | reads other AI tools' MCP configs (names and states only) |
| `skills/kk-onboard/scripts/redact.mjs` | secret redaction for every printed string |
| `skills/kk-onboard/scripts/common.mjs` | shared helpers |
| `docs/*.md` | docs-only items: Jira/Confluence, Figma, bantamkit hooks |

Node stdlib only, no dependencies. Tests: `scripts/*.test.mjs` (CI on Linux, macOS, Windows).

## 2. `inventory.mjs`

`node inventory.mjs [--fast] [--full] [--pretty]`

- `--fast` skips `claude mcp list` (the slow health check; claude.ai connectors are then not seen).
- `--full` also prints the installed lists (plugins, marketplaces, MCP, skills, hooks).
- `--pretty` indents the JSON.

It always prints one JSON document, also on an internal error (`error: true` plus `notes`). Top-level
keys: `generatedAt`, `cwd`, `platform`, `node`, `mode`, `healthChecked`, `counts`, `pack` (each item's
status, where it was found, missing bins, `requiresNotes`), `findings`, `packageManagers` (when found),
`installed` (with `--full`), `notes`.

Processes it may start: `claude` (plugin, marketplace and MCP lists), and for an item whose `requires`
names a Java version, one `java -version` (10 s timeout).

### Findings

Each finding has a type, an id, a message and evidence. Findings about the pack's own items carry
`packManaged: true`.

| Type | Id | Fires when |
|---|---|---|
| redundancy | `same-endpoint` | several MCP entries point at one endpoint |
| redundancy | `same-package` | one package is configured more than once |
| redundancy | `same-skill-name` | one skill name exists in several sources |
| redundancy | `overlap:<group>` | 2 or more tools match an overlap group (`browser`, `code-review`, `commit`, `planning`, `frontend-design`, `memory`, `security`, `code-nav`, `lsp-ts`) |
| redundancy | `disabled-installed` | a plugin is installed but disabled |
| risk | `inline-secret` | an MCP config stores a credential in plain text (key names only) |
| risk | `local-path-mcp`, `local-path-hook` | a server or hook runs code from a local path |
| risk | `hook-every-tool` | a hook with no matcher (or `*`) runs on every tool call |
| risk | `mcp-unhealthy` | MCP servers not connected or not authenticated |
| risk | `third-party-marketplace` | a marketplace not from Anthropic |
| risk | `skill-with-scripts` | skills that ship executable scripts |
| risk | `node-version-path` | a server or hook runs from a version-manager node that is gone or not active |
| risk | `broad-permission` | a broad permission rule |
| info | `runs-latest-from-registry` | a server fetches its newest release on each start |

In an overlap group, a plugin, the servers it starts and the skills it ships count as one tool. A group with
`with` fires only when a tool matching `match` and a different tool matching `with` are both on.

### Hosts read

Claude Code (user, project, local, managed `managed-mcp.json`, and plugin MCP servers), Claude Desktop
(including the MSIX path on Windows, reasoned, not documented), Cursor, VS Code (plus Insiders, VSCodium,
profiles, Flatpak/Snap), Windsurf/Devin, Codex CLI (`config.toml`), Gemini CLI (settings and extensions),
and the Windows side from WSL. Only names and states leave the readers. Global package folders are found
for npm, pnpm, yarn, bun, Volta and mise without running any package manager.

## 3. `options.mjs`

`node options.mjs [--item <id>]... [--detail] [--run-help] [--network] [--record [--pending A,B] [--force]] [--diff] [--pretty]`

| Flag | Effect |
|---|---|
| (none) | options of every pack item, compact |
| `--item id`, `--detail` | only these items, with full context |
| `--run-help` | also run the installed package's `--help`; only for a copy in a trusted place (npm global root, other managers' global folders, the npx cache, a user-scope AI tool config outside the current folder), with a scrubbed environment, a 1 MB output cap and a process-tree kill on timeout |
| `--network` | ask the npm registry for the latest README; with `--diff`, compare against `@latest` |
| `--record` | save item, version, option names, flags and description hashes; `--pending` keeps deferred options; `--force` replaces a corrupt state file after copying it aside |
| `--diff` | compare now with the state file: added, removed, changed, pending |

State file: `<CLAUDE_CONFIG_DIR or ~/.claude>/kktestdev-pack/options-seen.json`. Nothing else is
written. Values are never printed, only `literal`, `ref` or `empty`.

## 4. `pack.json`

The key list the scripts read is in the file's own `keys` field; `pack.schema.json` is the full shape.
Item fields: `id`, `profile` (`core`, `frontend`, `investigate`, `docs`), `kind` (`plugin`, `mcp`,
`docs`), `detect`, `steps` and `windows` (install commands), `plugin`, `requires`, `options`
(`package`, `bin`, `envPrefix`), `scope`, `doc` (docs items), `publisher`, `what`. `overlapGroups[]`:
`id`, `label`, `match`, optional `with`, `note`. `packManaged` is set by the inventory, not stored. The inventory reports unknown `detect` keys in `notes`.

## 5. Guarantees

- The plugin installs nothing and adds no MCP server or hook by itself.
- Both scripts are read-only apart from the options state file.
- Every string from configs, CLIs and packages passes through `redact.mjs` before it is printed.
- On Windows, stdio MCP servers are registered through `cmd /c` (the `windows` steps).
- Versions are never pinned.
