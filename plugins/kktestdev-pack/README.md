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

Requirements: Node.js 18+ (`node`, `npx`). Optional per stack: Go (gopls), Java (jdtls),
`uv` (Jira/Confluence on Server/DC).

## What's in the pack

| Profile | Items |
|---|---|
| **core** | `superpowers`, `kkskills-essentials`, `context7`; LSP: `typescript-lsp`, `gopls-lsp`, `pyright-lsp`, `jdtls-lsp`; MCP: `bantamkit`, `playwright`, `chrome-devtools` |
| **frontend** | `impeccable`, `next-devtools` MCP (Next.js 16+), `shadcn` MCP (per project) |
| **investigate** | `sentry`, `grafana-mcp`, `serena` |
| **docs only** | [Jira / Confluence](docs/jira-confluence.md) (your own LDAP login), [Figma](docs/figma.md), [bantamkit hooks](docs/bantamkit-hooks.md) (opt-in) |

The catalog is [`skills/kk-onboard/pack.json`](skills/kk-onboard/pack.json). To change the pack,
edit that file: `detect` says how an item is recognised as already installed, `steps` /
`plugin` say how to install it, and `overlapGroups` drive the redundancy audit.

## What the audit checks

The read-only script `skills/kk-onboard/scripts/inventory.mjs` reports:

- **Redundancy**: the same MCP endpoint or package configured more than once (for example a
  claude.ai connector plus a synced plugin), the same skill name in several places, several
  tools doing the same job (browser automation, code review, planning, memory, ...), and plugins
  that are installed but disabled.
- **Risk**: credentials stored in plain text in MCP config (key names only, never values),
  servers or hooks that run code from a local path, hooks that run on every tool call, MCP
  servers not connected or not authenticated, third-party marketplaces, and skills that ship
  executable scripts.

Run it yourself: `node skills/kk-onboard/scripts/inventory.mjs [--fast]`.
