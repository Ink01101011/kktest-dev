# tool-metrics

Count Claude Code tool usage across all sessions — built-in tools, MCP tools
(grouped by server), skill invocations, and subagent spawns.

- `/tool-stats [--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]` — terminal table
- `/tool-stats-dashboard` — HTML dashboard published as an Artifact

How it works: session transcripts (`~/.claude/projects/**/*.jsonl`) are parsed
directly for full history; a PostToolUse hook appends `~/.claude/tool-metrics/events.jsonl`
as a durable copy that survives transcript cleanup. Sessions with a transcript on
disk are counted from the transcript only (no double counting).
