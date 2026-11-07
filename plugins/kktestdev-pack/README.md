# kktestdev-pack

Team onboarding for Claude Code. One plugin, two skills:

- **`/kk-onboard`**: inventories what you already have (plugins, MCP servers, claude.ai
  connectors, skills, hooks), **skips** pack items that are already there, installs the missing
  ones you pick, then **audits** everything for redundancy and risk and asks you, finding by
  finding, what to keep or remove. Options are presented neutrally, with no pre-picked answer.
- **`/kk-update`**: pulls the latest of everything the pack manages and shows versions
  before → after. Versions are never pinned.

The plugin itself installs nothing and adds no MCP server or hook. Every change goes through
`/kk-onboard` and your answers.

## Install

Inside Claude Code (2.1.275+), one step:

```
/plugin install kktestdev-pack --marketplace Ink01101011/kktest-dev
```

or from a shell:

```sh
claude plugin marketplace add Ink01101011/kktest-dev
claude plugin install kktestdev-pack@kktest-dev
```

Then start `claude` and run `/kk-onboard`.

Requirements: Node.js 22.22.2+ or 24+ (`node`, `npx`): typescript-language-server needs
22.22.2+, and chrome-devtools-mcp, shadcn and bantamkit-mcp need 20.19+ (the inventory script
alone runs on 18+). Optional per stack: Go (gopls), Java 21+ (jdtls), `uv` (Jira/Confluence on
Server/DC). TypeScript projects need `typescript` as a devDependency: the language server uses
the project's own `tsserver` (TypeScript 7, the native compiler, ships no `tsserver`).

Windows (native): stdio MCP servers are registered through `cmd /c` (each MCP item in
`pack.json` has `windows` steps, and `/kk-onboard` uses them). WSL and Git Bash work like Linux.

## Options and env (step 5 of `/kk-onboard`)

`/kk-onboard` asks which AI tools you use (Claude Code, Claude Desktop, Cursor, VS Code / GitHub
Copilot, Windsurf) and which model providers (Anthropic, Bedrock, Vertex, OpenAI-compatible, Azure
OpenAI, Gemini, OpenRouter, Ollama, LM Studio, ...). It then reads each pack item's options **from
the version installed on your machine** (`--help`, README/docs, `claude plugin configure`), with
nothing hard-coded in the pack. You pick which ones to set. Each picked option is explained step
by step, with neutral pros and cons per choice, and stored where your AI tool reads it. Secrets
stay in your credential store, and configs only get `${VAR}` references.

`scripts/options.mjs` does the reading: compact by default; `--item <id>` for full doc lines;
`--network` to read the latest README from npm for items that are not installed locally;
`--record` / `--diff` to save what was seen (names and versions only) so `/kk-update` asks only
about options a new version added, removed or changed. It never prints a value, only a state:
`literal` / `ref` / `empty`.

## What's in the pack

| Profile | Items |
|---|---|
| **core** | `superpowers`, `kkskills-essentials`, `context7`; LSP: `typescript-lsp`, `gopls-lsp`, `pyright-lsp`, `jdtls-lsp`; MCP: `bantamkit`, `playwright`, `chrome-devtools` |
| **frontend** | `impeccable`, `next-devtools` MCP (Next.js 16+), `shadcn` MCP (per project) |
| **investigate** | `sentry`, `grafana-mcp`, `serena` |
| **docs only** | [Jira / Confluence](docs/jira-confluence.md) (your own LDAP login), [Figma](docs/figma.md), [bantamkit hooks](docs/bantamkit-hooks.md) (opt-in) |

The catalog is [`skills/kk-onboard/pack.json`](skills/kk-onboard/pack.json). To change the pack,
edit that file: `detect` says how an item is recognised as already installed, `steps` /
`windows` / `plugin` say how to install it, and `overlapGroups` drive the redundancy audit. Its
`keys` field lists which keys the script reads; the script reports unknown `detect` keys in
`notes`.

## Who publishes what

Everything below runs with your user's permissions once installed. `npx`/`uvx` servers fetch
their newest release from the registry on each start (team policy: no pinned versions).

| Item | Publisher | How it runs |
|---|---|---|
| `superpowers` | obra (Jesse Vincent), `obra/superpowers` marketplace | plugin (skills) |
| `impeccable` | pbakaus (Paul Bakaus), `pbakaus/impeccable` marketplace | plugin (skills) |
| `kkskills-essentials`, this pack | Ink01101011, `Ink01101011/kktest-dev` marketplace (the pack author) | plugins (skills) |
| `bantamkit` | Ink01101011 / kktestdev (the pack author), npm `bantamkit-mcp` | global npm bin, stdio MCP |
| `context7` | Upstash, official plugin catalog | remote MCP: queries go to `mcp.context7.com` |
| `typescript-lsp`, `gopls-lsp`, `pyright-lsp`, `jdtls-lsp` | Anthropic official plugin catalog | plugins; the language servers come from typescript-language-server (community), Go team (`gopls`), Microsoft (`pyright`), Eclipse Foundation (`jdtls`) |
| `playwright` | Microsoft, npm `@playwright/mcp` | `npx` stdio MCP |
| `chrome-devtools` | Google (ChromeDevTools), npm `chrome-devtools-mcp` | `npx` stdio MCP |
| `next-devtools` | Vercel, npm `next-devtools-mcp` | `npx` stdio MCP |
| `shadcn` | shadcn-ui, npm `shadcn` | `npx`, writes the project's `.mcp.json` |
| `sentry` | Sentry, official plugin catalog | remote MCP (OAuth to your Sentry) |
| `grafana-mcp` | Grafana Labs, official plugin catalog | MCP with your Grafana token |
| `serena` | Oraios, community-managed entry in the official catalog | MCP |
| Jira / Confluence (docs) | Server/DC: `sooperset/mcp-atlassian` (community, PyPI via `uvx`; the npm package of the same name is a different project). Cloud: Atlassian | stdio MCP / remote MCP |
| Figma (docs) | Figma | claude.ai connector or official plugin |

## What the audit checks

The read-only script `skills/kk-onboard/scripts/inventory.mjs` reports (it always prints JSON;
anything it cannot read is listed in `notes`):

- **Redundancy**: the same MCP endpoint or package configured more than once (for example a
  claude.ai connector plus a synced plugin), the same skill name in several places, several
  tools doing the same job (browser automation, code review, planning, memory, ...), and plugins
  that are installed but disabled.
- **Risk**: credentials stored in plain text in MCP config (key names only, never values),
  servers or hooks that run code from a local path, hooks that run on every tool call, MCP
  servers not connected or not authenticated, third-party marketplaces, skills that ship
  executable scripts, and broad permission rules. Findings about the pack's own items are
  marked `packManaged`.
- **Info**: servers that fetch their newest release from the registry on each start.

Secret values never reach the output: env/header values are not read out, and URLs, args, hook
commands and CLI messages are redacted (`***`) before printing.

Run it yourself: `node skills/kk-onboard/scripts/inventory.mjs [--fast] [--full] [--pretty]`.
Tests (stdlib only, fake HOMEs in the temp dir):
`node --test plugins/kktestdev-pack/skills/kk-onboard/scripts/` from the repo root.
