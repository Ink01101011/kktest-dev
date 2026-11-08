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
alone runs on 18+). Optional per stack: Go (gopls), Java 25+ (jdtls; the JDK in `$JAVA_HOME` if set), `uv` (Jira/Confluence on
Server/DC). TypeScript projects need `typescript` as a devDependency: the language server uses
the project's own `tsserver` (TypeScript 7, the native compiler, ships no `tsserver`).

Windows (native): stdio MCP servers are registered through `cmd /c` (each MCP item in
`pack.json` has `windows` steps, and `/kk-onboard` uses them). WSL and Git Bash work like Linux.

## Options and env (step 5 of `/kk-onboard`)

`/kk-onboard` asks which AI tools and model providers you use, then reads each pack item's options
**from the version installed on your machine**. Nothing is hard-coded in the pack. You pick which
options to set; each is explained with neutral pros and cons and stored where your AI tool reads it.
Secrets stay in your credential store; configs get only references (`${VAR}` in Claude Code,
`${env:VAR}` in Cursor and VS Code). Values are never printed. `/kk-update` later asks only about
options a new version added, removed or changed.

The steps are in the [kk-onboard SKILL](skills/kk-onboard/SKILL.md) (Step 5). What the script
reads and runs is in [docs/kktestdev-pack/SPEC.md](../../docs/kktestdev-pack/SPEC.md).

## What's in the pack

| Profile | Items |
|---|---|
| **core** | `superpowers`, `kkskills-essentials`, `context7`; LSP: `typescript-lsp`, `gopls-lsp`, `pyright-lsp`, `jdtls-lsp`; MCP: `bantamkit`, `playwright` |
| **frontend** | `impeccable`, `chrome-devtools` MCP (perf traces, Lighthouse), `next-devtools` MCP (Next.js 16+), `shadcn` MCP (per project) |
| **investigate** | `sentry`, `grafana-mcp` |
| **docs only** | [Jira / Confluence](docs/jira-confluence.md) (your own LDAP login), [Figma](docs/figma.md), [bantamkit hooks](docs/bantamkit-hooks.md) (opt-in) |

The catalog is [`skills/kk-onboard/pack.json`](skills/kk-onboard/pack.json). To change the pack,
edit that file: `detect` says how an item is recognised as already installed, `steps` /
`windows` / `plugin` say how to install it, and `overlapGroups` drive the redundancy audit. Its
`keys` field lists which keys the script reads; the script reports unknown `detect` keys in
`notes`.

## Routing: which tool for which job

Some pack items overlap on purpose. Nothing is uninstalled for this; the team default is:

| Job | Default | Use the other one only when |
|---|---|---|
| Browser: navigate, click, fill, screenshot, E2E | `playwright` (core) | `chrome-devtools` (frontend): perf traces, Lighthouse, network detail. Claude in Chrome (built in): the task needs your real logged-in browser |
| Planning | superpowers (`writing-plans` / `executing-plans`) for a plan that fits one session | bantamkit shiftwork (`shiftwork_plan`, `clock_in` / `clock_out`) for 2 or more units that fan out agents |
| Code review of a diff | built-in `/code-review` (and `/security-review`) | superpowers' `requesting-code-review`: only inside the superpowers TDD / subagent flow. `receiving-code-review` has no built-in equivalent and stays |
| Next.js docs | `next-devtools` while a Next.js dev server is running | `context7` otherwise (and for every other library) |
| Code navigation | the LSP plugins + Claude Code's built-in LSP tool | none: the pack dropped `serena` in 1.1.0 |

The audit still lists the planning overlap (and the browser one when `frontend` is installed) as
`packManaged`: these are the pack's own choices, not questions. An existing `serena` plugin is
no longer a pack item: the audit reports it (the plugin and the MCP server it starts) under
`overlap:code-nav` and asks whether to keep it.
`chrome-devtools` moved from `core` to `frontend` in 1.1.0; a copy installed earlier keeps working
and `/kk-update` keeps it current.

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
| Jira / Confluence (docs) | Server/DC: `sooperset/mcp-atlassian` (community, PyPI via `uvx`; the npm package of the same name is a different project). Cloud: Atlassian | stdio MCP / remote MCP |
| Figma (docs) | Figma | claude.ai connector or official plugin |

## What the audit checks

The read-only script `skills/kk-onboard/scripts/inventory.mjs` reports **redundancy** (the same
server, package or skill in several places; several tools doing one job; installed-but-disabled
plugins), **risk** (plain-text credentials, by key name only; code run from a local path; hooks on
every tool call; servers not connected; third-party marketplaces; skills with scripts; broad
permission rules) and **info** (servers that fetch their newest release on each start). Findings
about the pack's own items are marked `packManaged`. Secret values never reach the output.

The full list of checks, the output shape and the flags are in
[docs/kktestdev-pack/SPEC.md](../../docs/kktestdev-pack/SPEC.md).

Run it yourself: `node skills/kk-onboard/scripts/inventory.mjs [--fast] [--full] [--pretty]`.
Tests (stdlib only, fake HOMEs in the temp dir), from the repo root:
`node --test "plugins/kktestdev-pack/skills/kk-onboard/scripts/*.test.mjs"`.
