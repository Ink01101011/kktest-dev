# tool-metrics — Design

**Date:** 2026-08-04
**Status:** Approved — implemented 2026-08-04
**Target:** new plugin `plugins/tool-metrics` in the `kktest-dev` marketplace

## Purpose

Count tool usage across all Claude Code sessions on this machine: which tools get
called and how often — built-in tools (Bash, Read, Edit…), MCP tools (grouped by
server), Skill invocations (which skill), and Agent spawns (which subagent type).
Viewable as a terminal table via `/tool-stats` and as an HTML dashboard.

## Data sources & dedupe strategy

Two sources, merged at read time:

1. **Session transcripts** (`~/.claude/projects/**/*.jsonl`) — authoritative for
   every session that still exists on disk. Each assistant message contains
   `tool_use` content blocks with `name`, `input`, and a block `id`. This gives
   full history for free, including Skill (`input.skill`) and Agent
   (`input.subagent_type`) detail. Limitation: transcripts are cleaned up after
   the retention period (`cleanupPeriodDays`, default ~30 days).

2. **Live event log** (`~/.claude/tool-metrics/events.jsonl`) — a PostToolUse
   hook appends one JSON line per tool call. This is the durable copy that
   survives transcript cleanup.

**Dedupe rule (session granularity):** when aggregating, if a `session_id` has a
transcript on disk, use only the transcript's events for that session and ignore
its rows in `events.jsonl`. Rows in `events.jsonl` are used only for sessions
whose transcripts no longer exist. This avoids double counting without needing
per-call IDs in the hook payload.

There is **no separate backfill step** — historical data is available immediately
because stats always read transcripts directly.

## Event model

Each aggregated event has:

| field     | source                                        | example                          |
|-----------|-----------------------------------------------|----------------------------------|
| `ts`      | transcript `timestamp` / hook wall clock (UTC ISO-8601) | `2026-08-04T09:12:33Z` |
| `session` | `session_id`                                  | `b15bfc20-…`                     |
| `project` | transcript dir name; hook `cwd` normalized to the same form (`/` and `.` → `-`) | `-Users-kktest-…-trader-platform`|
| `tool`    | tool name                                     | `Bash`, `mcp__claude_ai_Figma__get_screenshot` |
| `server`  | derived: `mcp__<server>__…` → server name, else `builtin` | `claude_ai_Figma`, `builtin` |
| `detail`  | `input.skill` when tool=Skill; `input.subagent_type` when tool=Agent; else empty | `superpowers:brainstorming` |

## Components

```
plugins/tool-metrics/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json                # PostToolUse, matcher "" (all tools)
│   └── scripts/log_event.py      # stdin hook JSON → append events.jsonl
├── scripts/metrics.py            # aggregator CLI (stdlib only, python3)
├── commands/
│   ├── tool-stats.md             # /tool-stats [filters]
│   └── tool-stats-dashboard.md   # /tool-stats-dashboard
└── README.md
```

### 1. Hook: `log_event.py` (PostToolUse)

- Reads hook JSON from stdin: `tool_name`, `tool_input`, `session_id`, `cwd`.
- Appends one line to `~/.claude/tool-metrics/events.jsonl` (creates dir on
  first run). Extracts `detail` for Skill/Agent calls.
- Must never block or fail the session: wrapped in a top-level `try/except` that
  always exits 0; no third-party deps; O(1) append.

### 2. Aggregator: `metrics.py`

`python3 metrics.py stats [--since 7d|30d|YYYY-MM-DD] [--project SUBSTR] [--group tool|server|project|day|skill|agent] [--json]`

- Walks `~/.claude/projects/**/*.jsonl` + `events.jsonl`, applies the dedupe
  rule, filters, aggregates counts.
- **Per-file cache:** parsing hundreds of transcripts on every call is wasteful.
  Cache per-transcript extracted events in
  `~/.claude/tool-metrics/cache/<sha1-of-path>.json`, keyed by `(mtime, size)`;
  re-parse only changed files. Active-session files change every turn, so this
  stays correct while cutting repeat work to near zero.
- Default output: text table sorted by count desc, with a summary header
  (total calls, sessions, date range). `--json` emits structured data for the
  dashboard command.
- Skill/agent grouping counts `detail` values of Skill/Agent events.

### 3. Commands

- **`/tool-stats`** — frontmatter `allowed-tools: Bash`; runs
  `metrics.py stats` passing `$ARGUMENTS` through (e.g. `/tool-stats --since 7d
  --group server`), shows the table, and adds a one-paragraph interpretation
  (top tools, anything unusual).
- **`/tool-stats-dashboard`** — runs `metrics.py stats --json` (a few group-bys),
  then instructs Claude to load the `dataviz` + `artifact-design` skills and
  build a self-contained HTML dashboard (bar chart per tool, per server,
  timeline per day, skills/agents breakdown) published via the Artifact tool.
  Data is embedded at generation time (static snapshot; re-run to refresh).

### 4. Marketplace registration

Add a `tool-metrics` entry to `.claude-plugin/marketplace.json` (version 0.1.0,
same author/license fields as siblings) and enable it in `~/.claude/settings.json`
`enabledPlugins`.

## Error handling

- Hook: swallow all exceptions, exit 0 (metrics must never break a session).
- Aggregator: skip malformed JSONL lines and unreadable files silently; count
  them and report `N lines skipped` in the summary footer.
- Missing `events.jsonl` / empty cache: fine — transcripts alone still work.

## Testing

- Unit-style smoke test in repo: run `metrics.py stats` against a fixture
  transcript file (checked into `plugins/tool-metrics/tests/fixtures/`) and
  assert expected counts (pytest not required — plain `python3 tests/test_metrics.py`).
- Hook test: pipe a sample PostToolUse JSON into `log_event.py`, assert the
  appended line.
- Manual: after install, run one session, `/tool-stats` should show this
  session's calls.

## Out of scope (YAGNI)

- Token/cost accounting per tool call
- OpenTelemetry export
- Cross-machine sync
- Automatic dashboard refresh / live charts
