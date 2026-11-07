# tool-metrics — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).

## 1. Components

| File | Role |
|---|---|
| `hooks/hooks.json` | `PostToolUse` (every tool) runs `hooks/scripts/log_event.py` |
| `hooks/scripts/log_event.py` | appends one event per tool call; never fails or blocks (always exit 0) |
| `scripts/metrics.py` | `stats` and `gc`; stdlib only |
| `commands/tool-stats.md` | runs `metrics.py stats $ARGUMENTS` and shows the table |
| `commands/tool-stats-dashboard.md` | runs `stats --json` per grouping and publishes an HTML Artifact |
| `tests/` | `test_metrics.py`, `test_log_event.py` with fixtures (not run in CI) |

## 2. CLI

```
python3 scripts/metrics.py stats [--since 7d|12h|2w|YYYY-MM-DD] [--project SUBSTR]
                                 [--group tool|server|project|day|skill|agent] [--json]
python3 scripts/metrics.py gc [--dry-run] [--grace-hours N] [--json]
```

## 3. Event record

One JSON line per tool call in `<metrics dir>/events.jsonl`:

| Field | Value |
|---|---|
| `ts` | UTC ISO time |
| `session` | `session_id` (a subagent call carries the parent's) |
| `project` | `cwd` with `/` and `.` replaced by `-` |
| `tool` | tool name |
| `server` | the MCP server for `mcp__<server>__<tool>`, else `builtin` |
| `detail` | skill name for `Skill`, `subagent_type` for `Agent` (default `general-purpose`), else empty |

No tool input or output is stored.

## 4. Counting rules

- Sessions with a transcript on disk are counted from the transcript only; the event log covers the
  rest.
- Nested subagent transcripts (`<project>/<session>/subagents/*.jsonl`) count toward the parent session.
- Calls are de-duplicated globally by `tool_use` id (resumed sessions replay earlier calls). Blocks
  without an id are kept.

## 5. Cache

`<metrics dir>/cache/`: one JSON entry per transcript, keyed by `sha1(path)` and stamped with
`(mtime, size, CACHE_VERSION)` (currently 2). Each `stats` run prunes entries whose transcript is gone
and that are older than 24 h. `gc` does the same by hand. GC is skipped when the projects folder is
missing, so a wrong `CLAUDE_PROJECTS_DIR` cannot empty the cache.

## 6. Environment

| Variable | Default |
|---|---|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` |
| `TOOL_METRICS_DIR` | `~/.claude/tool-metrics` |
