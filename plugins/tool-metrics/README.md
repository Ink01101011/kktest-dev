# tool-metrics

Count Claude Code tool usage across all sessions — built-in tools, MCP tools
(grouped by server), skill invocations, and subagent spawns.

- `/tool-stats [--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]` — terminal table
- `/tool-stats-dashboard` — HTML dashboard published as an Artifact

How it works: session transcripts (`~/.claude/projects/**/*.jsonl`) are parsed
directly for full history; a PostToolUse hook appends `~/.claude/tool-metrics/events.jsonl`
as a durable copy that survives transcript cleanup. Sessions with a transcript on
disk are counted from the transcript only (no double counting).

Subagent tool calls are attributed to the parent session: nested transcripts
(`<project>/<session>/subagents/*.jsonl`) carry the parent `sessionId`, and the
hook logs the parent `session_id` too — so session dedupe holds for both sources.

Duplicate tool calls: resuming a session replays earlier `tool_use` blocks, both
inline and into a newly forked transcript. Events are deduped globally by
`tool_use` id, so a replayed call counts once. Blocks without an id are left
alone.

Parse cache: `~/.claude/tool-metrics/cache/` holds one JSON entry per transcript,
keyed by `sha1(path)` and stamped with `(mtime, size, CACHE_VERSION)`. Entries
whose transcript no longer exists are pruned automatically on each `stats` run
(orphans younger than 24h are left alone). Prune manually with:

    python3 scripts/metrics.py gc [--dry-run] [--grace-hours N]

GC is skipped entirely when the projects root is missing, so a bad
`CLAUDE_PROJECTS_DIR` cannot empty the cache. The cache is pure derived data —
rebuilding it from scratch costs ~2s.
