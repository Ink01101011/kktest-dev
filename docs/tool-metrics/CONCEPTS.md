# tool-metrics — Concepts & Usage

The [plugin README](../../plugins/tool-metrics/README.md) covers usage and the cache. The formal contract
is in [SPEC.md](./SPEC.md). The 2026-08-04 design and plan it was built from are in
[docs/superpowers](../superpowers) (historical).

## The question it answers

Which tools do I actually use? Built-in tools, MCP tools (grouped by server), skills and subagents,
across every Claude Code session on this machine. This tells you, for example, that an MCP server is
connected in every session but never called.

## Two sources, counted once

- **Transcripts** (`~/.claude/projects/**/*.jsonl`) give the full history, as far back as they go.
- **An event log** (`~/.claude/tool-metrics/events.jsonl`), written by a `PostToolUse` hook, keeps a
  copy that survives transcript cleanup.

A session that still has a transcript is counted from the transcript only. The log fills in sessions
whose transcript is gone. Calls are also de-duplicated by `tool_use` id, because resuming a session
replays earlier calls. Subagent calls count toward the parent session.

## Usage

```
/tool-stats [--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]
/tool-stats-dashboard [--since 30d] [--project SUBSTR]
```

`/tool-stats` prints a table. `/tool-stats-dashboard` builds an HTML dashboard and publishes it as an
Artifact.

## Claude Code only

It reads Claude Code's transcript format and uses a Claude Code hook, so it does not export to other AI
tools (tier "Claude-only").
