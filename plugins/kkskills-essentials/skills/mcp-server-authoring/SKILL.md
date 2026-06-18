---
name: mcp-server-authoring
description: "Use this skill when building, structuring, or reviewing a Model Context Protocol (MCP) server — exposing tools/resources to MCP-aware hosts (Claude Desktop, Claude Code, Cursor, Copilot, Augment, claude.ai).
  Triggers include: 'MCP server', 'expose as a tool', 'stdio transport', 'Streamable HTTP', 'tool schema', '@modelcontextprotocol/sdk', 'tools/list', 'register a tool', 'host config json', 'how do I let Claude call my X'.
  Also use when writing host-config examples or deciding stdio vs HTTP transport.
  Do NOT use for *calling* an existing MCP server, or for plain REST API design with no MCP involvement."
version: "0.1.0"
updated: "2026-06-19"
---

# Reference — MCP Server Authoring

## Overview

An MCP server exposes **tools** (callable actions) and **resources** (readable data) to any MCP-aware
host over a standard protocol, so you wire the integration once and every host can use it. The two
decisions that shape everything: which **transport** (stdio vs Streamable HTTP) and how you keep the
**tool surface small** so hosts don't drown in schemas.

## When to Use

- ✅ Making a local capability (a script, a data library, an internal API) callable by Claude/agents.
- ✅ Choosing stdio vs HTTP transport for a server.
- ✅ Designing tool schemas and error semantics.
- ✅ Writing per-host config examples.
- ❌ Consuming someone else's MCP server, or pure REST/GraphQL design.

## Process / Steps

### Step 1 — Pick the transport

| Transport | Use when | Notes |
|---|---|---|
| **stdio** | Local host spawns the server as a subprocess (Claude Desktop, Claude Code, Cursor) | Simplest; one client; no network. Host launches `command + args`. |
| **Streamable HTTP** | Remote / multi-user / CI / claude.ai remote connectors | Server is a long-running process at a URL; supports multiple clients; needs auth. |

Support **both** when you can — same tool registrations, two entrypoints. stdio for local dev, HTTP for
shared/remote use.

### Step 2 — Design the tool surface

- ☐ Each tool: a clear `name`, a one-sentence description of *when to use it*, and a JSON Schema for
  inputs (types, required, enums). The description is how the model decides to call it — write it like a
  trigger, not a label.
- ☐ Keep the surface **small**. Many hosts load every tool's schema into context; 20 tools is a lot of
  tokens. Group related actions; prefer a few rich tools over many thin ones.
- ☐ If the host supports tool-search / deferred schemas (e.g. `enableToolSearch`), enable it so schemas
  load on demand instead of all upfront.
- ☐ Return structured, bounded results. Cap large payloads; summarize or paginate.

### Step 3 — Error and lifecycle semantics

- ☐ Distinguish a *tool error* (return an error result the model can read and recover from) from a
  *protocol error* (malformed request). Don't crash the server on a bad tool input.
- ☐ Validate inputs against the schema before acting; return a clear message on violation.
- ☐ Make tools idempotent where possible; never let one failed call take down the process.
- ☐ Log to stderr (stdio) — stdout is the protocol channel; writing logs to stdout corrupts it.

### Step 4 — Ship config examples per host

Provide copy-paste config for each host you support. Shapes differ:

```jsonc
// Claude Desktop / Claude Code — stdio
"my-server": {
  "command": "node",
  "args": ["/absolute/path/to/dist/index.js"]
}
```

```bash
# Some hosts have a CLI to add servers (e.g. Augment):
auggie mcp add-json my-server '{"command":"node","args":["..."]}'
auggie mcp list   # verify
```

- ☐ Document required env vars (API keys via env, not args — see [[secret-hygiene]]).
- ☐ For HTTP, document the URL + auth header.
- ☐ Publish as an npm package so `npx` works without a local build, when distribution matters.

## Rules & Constraints

- ALWAYS: support stdio for local; add Streamable HTTP when it needs to be remote/multi-user.
- ALWAYS: log to stderr — stdout is reserved for the protocol on stdio.
- ALWAYS: write tool descriptions as "when to use", and keep input schemas strict.
- ALWAYS: keep the tool surface small; enable tool-search/deferred schemas if the host supports it.
- ALWAYS: secrets via env, never hardcoded in config args ([[secret-hygiene]]).
- NEVER: crash on bad tool input — return a readable tool error.
- NEVER: dump unbounded payloads into a tool result.

## Examples

**Scenario:** A local skill library you want Claude Desktop and Cursor to use.
**Right:** Build a stdio server registering a few tools (`search`, `get`, `list`); log to stderr; ship a
`claude_desktop_config.json` snippet and a Cursor snippet. Add an HTTP entrypoint later for claude.ai.

**Scenario:** Host complains about context bloat from 19 tools.
**Right:** Enable the host's tool-search (`enableToolSearch: true`) so schemas load on demand; consolidate
overlapping tools; keep descriptions tight.

**Scenario:** Server occasionally prints a debug line and the host shows protocol errors.
**Right:** The debug line went to stdout and corrupted the stdio stream — route all logging to stderr.

## Changelog

- 0.1.0 (2026-06-19) — initial version; transport choice, tool-surface design, error/lifecycle, per-host config. Source: "MCP stdio spec design" session.
