# tool-metrics Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `tool-metrics` plugin for the kktest-dev marketplace that counts tool/MCP/skill/agent usage across all Claude Code sessions, viewable via `/tool-stats` (terminal table) and `/tool-stats-dashboard` (HTML artifact).

**Architecture:** Two data sources merged at read time — session transcripts in `~/.claude/projects/**/*.jsonl` (authoritative while they exist) and a durable `events.jsonl` appended by a PostToolUse hook (used only for sessions whose transcripts were cleaned up). A stdlib-only Python aggregator with a per-file cache renders tables/JSON; slash commands wrap it.

**Tech Stack:** Python 3 stdlib only (no pip deps). Claude Code plugin format (hooks.json, commands/*.md).

**Spec:** `docs/superpowers/specs/2026-08-04-tool-metrics-design.md`

## Global Constraints

- Python stdlib only; entry via `python3` (user has 3.12).
- Hook must NEVER fail or block a session: top-level try/except, always exit 0.
- Data dir: `~/.claude/tool-metrics/` (`events.jsonl`, `cache/`). Overridable via env `TOOL_METRICS_DIR`; transcripts root overridable via `CLAUDE_PROJECTS_DIR` (both exist for tests).
- Event fields (exact names): `ts`, `session`, `project`, `tool`, `server`, `detail`.
- Timestamps stored as UTC ISO-8601; day-grouping converts to local time for display.
- Transcript line fields (verified 2026-08-04): top-level `timestamp`, `sessionId`, `cwd`; tool calls are `message.content[]` blocks with `type: "tool_use"`, `name`, `input`.
- MCP server derivation: tool name `mcp__<server>__<tool>` → `server`; everything else → `builtin`.
- `detail` = `input.skill` when tool is `Skill`; `input.subagent_type` (default `general-purpose`) when tool is `Agent`; else `""`.
- Aggregator skips malformed lines silently and reports `(N lines skipped)` in the footer.
- Commit style: conventional commits, `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.
- All paths below are relative to repo root `/Users/kktest/Projects/kktest-dev`.

---

### Task 1: Plugin scaffold + marketplace registration

**Files:**
- Create: `plugins/tool-metrics/.claude-plugin/plugin.json`
- Create: `plugins/tool-metrics/README.md`
- Modify: `.claude-plugin/marketplace.json` (append to `plugins` array)

**Interfaces:**
- Consumes: nothing
- Produces: plugin identity `tool-metrics` v0.1.0 that later tasks put files into

- [ ] **Step 1: Create plugin.json**

```json
{
  "name": "tool-metrics",
  "version": "0.1.0",
  "description": "Count Claude Code tool usage across all sessions: built-in tools, MCP tools (grouped by server), skill invocations, and subagent spawns. Merges session transcripts with a durable PostToolUse event log, viewable via /tool-stats (terminal table) and /tool-stats-dashboard (HTML artifact).",
  "author": {
    "name": "Ink",
    "email": "supakit.kitj@gmail.com"
  },
  "homepage": "https://github.com/Ink01101011/kktest-dev/tree/main/plugins/tool-metrics",
  "repository": "https://github.com/Ink01101011/kktest-dev",
  "license": "MIT",
  "keywords": ["metrics", "monitoring", "usage", "mcp", "hooks", "statistics"]
}
```

Write to `plugins/tool-metrics/.claude-plugin/plugin.json`.

- [ ] **Step 2: Create README stub**

```markdown
# tool-metrics

Count Claude Code tool usage across all sessions — built-in tools, MCP tools
(grouped by server), skill invocations, and subagent spawns.

- `/tool-stats [--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]` — terminal table
- `/tool-stats-dashboard` — HTML dashboard published as an Artifact

How it works: session transcripts (`~/.claude/projects/**/*.jsonl`) are parsed
directly for full history; a PostToolUse hook appends `~/.claude/tool-metrics/events.jsonl`
as a durable copy that survives transcript cleanup. Sessions with a transcript on
disk are counted from the transcript only (no double counting).
```

Write to `plugins/tool-metrics/README.md`.

- [ ] **Step 3: Register in marketplace.json**

In `.claude-plugin/marketplace.json`, append this object to the `plugins` array (after the last existing entry):

```json
    {
      "name": "tool-metrics",
      "source": "./plugins/tool-metrics",
      "description": "Count Claude Code tool usage across all sessions: built-in tools, MCP tools by server, skill invocations, and subagent spawns — /tool-stats terminal table plus an HTML dashboard.",
      "version": "0.1.0",
      "author": {
        "name": "Ink",
        "email": "supakit.kitj@gmail.com"
      },
      "homepage": "https://github.com/Ink01101011/kktest-dev/tree/main/plugins/tool-metrics",
      "repository": "https://github.com/Ink01101011/kktest-dev",
      "license": "MIT",
      "category": "productivity",
      "keywords": ["metrics", "monitoring", "usage", "mcp", "hooks", "statistics"],
      "tags": ["metrics", "monitoring", "usage", "hooks", "dx"]
    }
```

- [ ] **Step 4: Validate JSON**

Run: `python3 -m json.tool /Users/kktest/Projects/kktest-dev/.claude-plugin/marketplace.json > /dev/null && python3 -m json.tool /Users/kktest/Projects/kktest-dev/plugins/tool-metrics/.claude-plugin/plugin.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
cd /Users/kktest/Projects/kktest-dev
git add plugins/tool-metrics .claude-plugin/marketplace.json
git commit -m "feat(tool-metrics): scaffold plugin and register in marketplace

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: PostToolUse hook logger

**Files:**
- Create: `plugins/tool-metrics/hooks/scripts/log_event.py`
- Create: `plugins/tool-metrics/hooks/hooks.json`
- Test: `plugins/tool-metrics/tests/test_log_event.py`

**Interfaces:**
- Consumes: PostToolUse hook JSON on stdin (`tool_name`, `tool_input`, `session_id`, `cwd`)
- Produces: appended lines in `$TOOL_METRICS_DIR/events.jsonl` (default `~/.claude/tool-metrics/events.jsonl`), one JSON object per call with fields `ts`, `session`, `project`, `tool`, `server`, `detail`

- [ ] **Step 1: Write the failing test**

```python
#!/usr/bin/env python3
"""Tests for log_event.py — run: python3 tests/test_log_event.py"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "hooks" / "scripts" / "log_event.py"


def run_hook(payload, metrics_dir):
    env = dict(os.environ, TOOL_METRICS_DIR=str(metrics_dir))
    return subprocess.run(
        [sys.executable, str(SCRIPT)],
        input=json.dumps(payload), env=env,
        capture_output=True, text=True,
    )


def read_events(metrics_dir):
    events_file = Path(metrics_dir) / "events.jsonl"
    if not events_file.exists():
        return []
    return [json.loads(l) for l in events_file.read_text().splitlines() if l.strip()]


def test_logs_builtin_tool():
    with tempfile.TemporaryDirectory() as td:
        proc = run_hook({
            "tool_name": "Bash",
            "tool_input": {"command": "ls"},
            "session_id": "sess-1",
            "cwd": "/Users/kktest/Projects/demo.app",
        }, td)
        assert proc.returncode == 0, proc.stderr
        events = read_events(td)
        assert len(events) == 1
        ev = events[0]
        assert ev["tool"] == "Bash"
        assert ev["server"] == "builtin"
        assert ev["session"] == "sess-1"
        assert ev["project"] == "-Users-kktest-Projects-demo-app"
        assert ev["detail"] == ""
        assert ev["ts"].startswith("20")


def test_logs_mcp_skill_agent():
    with tempfile.TemporaryDirectory() as td:
        run_hook({"tool_name": "mcp__claude_ai_Figma__get_screenshot",
                  "tool_input": {}, "session_id": "s", "cwd": "/x"}, td)
        run_hook({"tool_name": "Skill",
                  "tool_input": {"skill": "superpowers:brainstorming"},
                  "session_id": "s", "cwd": "/x"}, td)
        run_hook({"tool_name": "Agent",
                  "tool_input": {"prompt": "hi"}, "session_id": "s", "cwd": "/x"}, td)
        events = read_events(td)
        assert events[0]["server"] == "claude_ai_Figma"
        assert events[1]["detail"] == "superpowers:brainstorming"
        assert events[2]["detail"] == "general-purpose"


def test_never_fails_on_garbage():
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ, TOOL_METRICS_DIR=str(td))
        proc = subprocess.run([sys.executable, str(SCRIPT)],
                              input="not json at all", env=env,
                              capture_output=True, text=True)
        assert proc.returncode == 0


if __name__ == "__main__":
    test_logs_builtin_tool()
    test_logs_mcp_skill_agent()
    test_never_fails_on_garbage()
    print("OK test_log_event")
```

Write to `plugins/tool-metrics/tests/test_log_event.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_log_event.py`
Expected: FAIL — `AssertionError` (returncode 2, script not found) or FileNotFoundError.

- [ ] **Step 3: Write log_event.py**

```python
#!/usr/bin/env python3
"""PostToolUse hook: append one event per tool call to events.jsonl.

Must NEVER fail or block the session: top-level try/except, always exit 0.
Stdlib only. Helpers are duplicated from scripts/metrics.py on purpose —
the hook must be runnable standalone with no import path assumptions.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone


def metrics_dir():
    return os.environ.get("TOOL_METRICS_DIR") or os.path.join(
        os.path.expanduser("~"), ".claude", "tool-metrics")


def server_of(tool):
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        if len(parts) >= 3:
            return parts[1]
    return "builtin"


def detail_of(tool, tool_input):
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Skill":
        return str(tool_input.get("skill", ""))
    if tool == "Agent":
        return str(tool_input.get("subagent_type", "") or "general-purpose")
    return ""


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name") or "?"
    event = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "session": data.get("session_id", ""),
        "project": re.sub(r"[/.]", "-", data.get("cwd", "")),
        "tool": tool,
        "server": server_of(tool),
        "detail": detail_of(tool, data.get("tool_input")),
    }
    target = metrics_dir()
    os.makedirs(target, exist_ok=True)
    with open(os.path.join(target, "events.jsonl"), "a") as fh:
        fh.write(json.dumps(event) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
```

Write to `plugins/tool-metrics/hooks/scripts/log_event.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_log_event.py`
Expected: `OK test_log_event`

- [ ] **Step 5: Create hooks.json**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/log_event.py"
          }
        ]
      }
    ]
  }
}
```

Write to `plugins/tool-metrics/hooks/hooks.json`. Validate: `python3 -m json.tool plugins/tool-metrics/hooks/hooks.json > /dev/null && echo OK` → `OK`

- [ ] **Step 6: Commit**

```bash
cd /Users/kktest/Projects/kktest-dev
git add plugins/tool-metrics/hooks plugins/tool-metrics/tests
git commit -m "feat(tool-metrics): add PostToolUse event logger hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Aggregator — transcript parsing, filters, grouping, output

**Files:**
- Create: `plugins/tool-metrics/scripts/metrics.py`
- Create: `plugins/tool-metrics/tests/fixtures/projects/-test-proj/aaaa-1111.jsonl`
- Test: `plugins/tool-metrics/tests/test_metrics.py`

**Interfaces:**
- Consumes: transcript `.jsonl` files under `$CLAUDE_PROJECTS_DIR/<project>/`
- Produces: CLI `python3 scripts/metrics.py stats [--since V] [--project S] [--group G] [--json]`. JSON shape: `{"group": str, "total": int, "sessions": int, "skipped": int, "counts": {name: int}}`. Task 4 will extend `collect()` (signature: `collect() -> (list[event], int)`) with events.jsonl merge and caching.

- [ ] **Step 1: Create fixture transcript**

One transcript for session `aaaa-1111` in project `-test-proj`: 3 Bash, 1 Read, 2 Figma MCP calls, 1 Skill, 1 Agent, plus one malformed line and one non-tool line. Timestamps span two days (UTC).

```jsonl
{"type":"user","sessionId":"aaaa-1111","timestamp":"2026-08-01T10:00:00.000Z","cwd":"/test/proj","message":{"role":"user","content":"hello"}}
{"type":"assistant","sessionId":"aaaa-1111","timestamp":"2026-08-01T10:00:05.000Z","cwd":"/test/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_01","name":"Bash","input":{"command":"ls"}}]}}
{"type":"assistant","sessionId":"aaaa-1111","timestamp":"2026-08-01T10:01:00.000Z","cwd":"/test/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_02","name":"Bash","input":{"command":"pwd"}},{"type":"tool_use","id":"toolu_03","name":"Read","input":{"file_path":"/x"}}]}}
this line is not valid json {{{
{"type":"assistant","sessionId":"aaaa-1111","timestamp":"2026-08-01T10:02:00.000Z","cwd":"/test/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_04","name":"mcp__claude_ai_Figma__get_screenshot","input":{}},{"type":"tool_use","id":"toolu_05","name":"mcp__claude_ai_Figma__get_metadata","input":{}}]}}
{"type":"assistant","sessionId":"aaaa-1111","timestamp":"2026-08-02T09:00:00.000Z","cwd":"/test/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_06","name":"Skill","input":{"skill":"superpowers:brainstorming"}}]}}
{"type":"assistant","sessionId":"aaaa-1111","timestamp":"2026-08-02T09:05:00.000Z","cwd":"/test/proj","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_07","name":"Agent","input":{"subagent_type":"Explore","prompt":"look"}},{"type":"tool_use","id":"toolu_08","name":"Bash","input":{"command":"date"}}]}}
```

Write to `plugins/tool-metrics/tests/fixtures/projects/-test-proj/aaaa-1111.jsonl` (7 lines, exactly as above).

- [ ] **Step 2: Write the failing test**

```python
#!/usr/bin/env python3
"""Tests for metrics.py — run: python3 tests/test_metrics.py"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "metrics.py"
FIXTURE_PROJECTS = Path(__file__).resolve().parent / "fixtures" / "projects"


def run_stats(projects_dir, metrics_dir, *args):
    env = dict(os.environ,
               CLAUDE_PROJECTS_DIR=str(projects_dir),
               TOOL_METRICS_DIR=str(metrics_dir))
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "stats", "--json", *args],
        env=env, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def test_counts_by_tool():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td)
        assert out["counts"]["Bash"] == 3
        assert out["counts"]["Read"] == 1
        assert out["counts"]["mcp__claude_ai_Figma__get_screenshot"] == 1
        assert out["total"] == 8
        assert out["sessions"] == 1
        assert out["skipped"] == 1


def test_group_server():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "server")
        assert out["counts"]["claude_ai_Figma"] == 2
        assert out["counts"]["builtin"] == 6


def test_group_skill_and_agent():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "skill")
        assert out["counts"] == {"superpowers:brainstorming": 1}
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "agent")
        assert out["counts"] == {"Explore": 1}


def test_since_filter():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--since", "2026-08-02")
        # only the 3 events on 2026-08-02 remain
        assert out["total"] == 3
        out = run_stats(FIXTURE_PROJECTS, td, "--since", "1d")
        # fixture timestamps are far in the past relative to any run date
        assert out["total"] == 0


def test_project_filter():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--project", "test-proj")
        assert out["total"] == 8
        out = run_stats(FIXTURE_PROJECTS, td, "--project", "no-such")
        assert out["total"] == 0


def test_table_output():
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ,
                   CLAUDE_PROJECTS_DIR=str(FIXTURE_PROJECTS),
                   TOOL_METRICS_DIR=str(td))
        proc = subprocess.run([sys.executable, str(SCRIPT), "stats"],
                              env=env, capture_output=True, text=True)
        assert proc.returncode == 0, proc.stderr
        assert "Bash" in proc.stdout
        assert "8 calls" in proc.stdout
        assert "(1 lines skipped)" in proc.stdout


if __name__ == "__main__":
    test_counts_by_tool()
    test_group_server()
    test_group_skill_and_agent()
    test_since_filter()
    test_project_filter()
    test_table_output()
    print("OK test_metrics")
```

Write to `plugins/tool-metrics/tests/test_metrics.py`.

Note: `--since 2026-08-02` is interpreted as local midnight; fixture events on 2026-08-02 are 09:00 UTC. In timezones ahead of UTC (e.g. Asia/Bangkok, +7 → local midnight = 2026-08-01T17:00Z) all 3 pass; the assertion holds for any timezone between UTC-9 and UTC+14, which covers this machine (Asia/Bangkok). Do not run tests with TZ overridden west of UTC-9.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_metrics.py`
Expected: FAIL — `AssertionError` in `run_stats` (script missing, returncode != 0).

- [ ] **Step 4: Write metrics.py**

```python
#!/usr/bin/env python3
"""tool-metrics aggregator: count Claude Code tool usage.

Sources: session transcripts under ~/.claude/projects (authoritative while
present) + events.jsonl written by the PostToolUse hook (durable copy, used
in Task 4 for sessions whose transcripts were cleaned up). Stdlib only.
"""
import argparse
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path


def projects_dir():
    return Path(os.environ.get("CLAUDE_PROJECTS_DIR")
                or Path.home() / ".claude" / "projects")


def metrics_dir():
    return Path(os.environ.get("TOOL_METRICS_DIR")
                or Path.home() / ".claude" / "tool-metrics")


def server_of(tool):
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        if len(parts) >= 3:
            return parts[1]
    return "builtin"


def detail_of(tool, tool_input):
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Skill":
        return str(tool_input.get("skill", ""))
    if tool == "Agent":
        return str(tool_input.get("subagent_type", "") or "general-purpose")
    return ""


def extract_transcript_events(path):
    """Parse one transcript file -> (session_id, [events], skipped_lines)."""
    events, session, skipped = [], None, 0
    project = path.parent.name
    with open(path, errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            session = obj.get("sessionId") or session
            msg = obj.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool = block.get("name") or "?"
                    events.append({
                        "ts": obj.get("timestamp", ""),
                        "session": session or path.stem,
                        "project": project,
                        "tool": tool,
                        "server": server_of(tool),
                        "detail": detail_of(tool, block.get("input")),
                    })
    return session or path.stem, events, skipped


def collect():
    """Gather events from all transcripts -> (events, skipped_lines)."""
    all_events, skipped = [], 0
    root = projects_dir()
    if root.is_dir():
        for path in sorted(root.glob("*/*.jsonl")):
            _session, events, s = extract_transcript_events(path)
            all_events.extend(events)
            skipped += s
    return all_events, skipped


def parse_since(value):
    """'7d' / '12h' / '2w' relative, or 'YYYY-MM-DD' local midnight."""
    m = re.fullmatch(r"(\d+)([dhw])", value)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {"d": timedelta(days=n), "h": timedelta(hours=n),
                 "w": timedelta(weeks=n)}[unit]
        return datetime.now(timezone.utc) - delta
    return datetime.fromisoformat(value).astimezone()


def event_time(ev):
    ts = str(ev.get("ts", ""))
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def group_key(ev, group):
    """Grouping key for an event, or None to exclude it from this grouping."""
    if group == "server":
        return ev.get("server", "builtin")
    if group == "project":
        return ev.get("project", "?")
    if group == "day":
        t = event_time(ev)
        return t.astimezone().strftime("%Y-%m-%d") if t else "unknown"
    if group == "skill":
        return ev.get("detail") or None if ev.get("tool") == "Skill" else None
    if group == "agent":
        return ev.get("detail") or None if ev.get("tool") == "Agent" else None
    return ev.get("tool", "?")


def render_table(counter, total, sessions, skipped, group):
    lines = [f"Tool usage — {total} calls, {sessions} sessions (group: {group})", ""]
    width = max((len(k) for k in counter), default=4)
    for name, n in counter.most_common():
        lines.append(f"{name:<{width}}  {n:>6}")
    if skipped:
        lines.append("")
        lines.append(f"({skipped} lines skipped)")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="metrics.py",
                                 description="Claude Code tool usage stats")
    sub = ap.add_subparsers(dest="cmd")
    st = sub.add_parser("stats", help="aggregate usage counts")
    st.add_argument("--since", help="7d / 12h / 2w / YYYY-MM-DD")
    st.add_argument("--project", help="substring filter on project name")
    st.add_argument("--group", default="tool",
                    choices=["tool", "server", "project", "day", "skill", "agent"])
    st.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd != "stats":
        ap.print_help()
        return 1

    events, skipped = collect()
    if args.since:
        cutoff = parse_since(args.since)
        events = [e for e in events
                  if (t := event_time(e)) is not None and t >= cutoff]
    if args.project:
        needle = args.project.lower()
        events = [e for e in events if needle in str(e.get("project", "")).lower()]

    counter = Counter()
    sessions = set()
    for ev in events:
        key = group_key(ev, args.group)
        if key is None:
            continue
        sessions.add(ev.get("session"))
        counter[key] += 1

    total = sum(counter.values())
    if args.json:
        print(json.dumps({"group": args.group, "total": total,
                          "sessions": len(sessions), "skipped": skipped,
                          "counts": dict(counter.most_common())}, indent=2))
    else:
        print(render_table(counter, total, len(sessions), skipped, args.group))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Write to `plugins/tool-metrics/scripts/metrics.py`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_metrics.py && python3 tests/test_log_event.py`
Expected: `OK test_metrics` then `OK test_log_event`

- [ ] **Step 6: Commit**

```bash
cd /Users/kktest/Projects/kktest-dev
git add plugins/tool-metrics/scripts plugins/tool-metrics/tests
git commit -m "feat(tool-metrics): add aggregator with filters and grouping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: events.jsonl merge (session dedupe) + per-file cache

**Files:**
- Modify: `plugins/tool-metrics/scripts/metrics.py` (replace `collect()`, add two functions, add `hashlib` import)
- Test: `plugins/tool-metrics/tests/test_metrics.py` (append two tests)

**Interfaces:**
- Consumes: `collect() -> (events, skipped)` from Task 3; `events.jsonl` lines with fields `ts`, `session`, `project`, `tool`, `server`, `detail` (as written by Task 2's `log_event.py`)
- Produces: same `collect()` signature, now merging both sources with session-level dedupe and caching transcript parses in `$TOOL_METRICS_DIR/cache/<sha1>.json`

- [ ] **Step 1: Append failing tests**

Append to `plugins/tool-metrics/tests/test_metrics.py` (before the `if __name__ == "__main__":` block), and add the two calls to `__main__`:

```python
def test_events_jsonl_dedupe():
    """events.jsonl rows count only for sessions with no transcript on disk."""
    with tempfile.TemporaryDirectory() as td:
        events_file = Path(td) / "events.jsonl"
        rows = [
            # same session as fixture transcript -> must be IGNORED
            {"ts": "2026-08-01T10:00:05+00:00", "session": "aaaa-1111",
             "project": "-test-proj", "tool": "Bash", "server": "builtin", "detail": ""},
            # unknown session (transcript cleaned up) -> must be COUNTED
            {"ts": "2026-07-01T08:00:00+00:00", "session": "gone-9999",
             "project": "-old-proj", "tool": "Edit", "server": "builtin", "detail": ""},
        ]
        events_file.write_text("".join(json.dumps(r) + "\n" for r in rows))
        out = run_stats(FIXTURE_PROJECTS, td)
        assert out["counts"].get("Edit") == 1
        assert out["counts"]["Bash"] == 3  # unchanged, no double count
        assert out["total"] == 9
        assert out["sessions"] == 2


def test_cache_created_and_correct():
    with tempfile.TemporaryDirectory() as td:
        first = run_stats(FIXTURE_PROJECTS, td)
        cache_files = list((Path(td) / "cache").glob("*.json"))
        assert len(cache_files) == 1
        second = run_stats(FIXTURE_PROJECTS, td)  # served from cache
        assert second == first
```

And extend the `__main__` block to:

```python
if __name__ == "__main__":
    test_counts_by_tool()
    test_group_server()
    test_group_skill_and_agent()
    test_since_filter()
    test_project_filter()
    test_table_output()
    test_events_jsonl_dedupe()
    test_cache_created_and_correct()
    print("OK test_metrics")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_metrics.py`
Expected: FAIL — `AssertionError` in `test_events_jsonl_dedupe` (`counts.get("Edit") == 1` is None: events.jsonl not read yet).

- [ ] **Step 3: Implement merge + cache**

In `plugins/tool-metrics/scripts/metrics.py`:

(a) Add `import hashlib` to the imports (alphabetical order, after `argparse`).

(b) Add these two functions directly above `collect()`:

```python
def cached_transcript_events(path):
    """extract_transcript_events() with a (mtime, size)-keyed JSON cache."""
    cache_dir = metrics_dir() / "cache"
    cache_file = cache_dir / (hashlib.sha1(str(path).encode()).hexdigest() + ".json")
    st = path.stat()
    stamp = [st.st_mtime, st.st_size]
    if cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            if cached.get("stamp") == stamp:
                return cached["session"], cached["events"], cached.get("skipped", 0)
        except (json.JSONDecodeError, KeyError, OSError):
            pass
    session, events, skipped = extract_transcript_events(path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = cache_file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"stamp": stamp, "session": session,
                               "events": events, "skipped": skipped}))
    tmp.replace(cache_file)
    return session, events, skipped


def live_events(transcript_sessions):
    """Rows from events.jsonl for sessions with no transcript on disk."""
    events, skipped = [], 0
    events_file = metrics_dir() / "events.jsonl"
    if not events_file.exists():
        return events, skipped
    with open(events_file, errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if ev.get("session") not in transcript_sessions:
                events.append(ev)
    return events, skipped
```

(c) Replace the whole `collect()` function with:

```python
def collect():
    """Gather events from transcripts + events.jsonl -> (events, skipped).

    Dedupe rule: a session with a transcript on disk is counted from the
    transcript only; events.jsonl covers sessions whose transcripts were
    cleaned up by retention.
    """
    all_events, skipped = [], 0
    transcript_sessions = set()
    root = projects_dir()
    if root.is_dir():
        for path in sorted(root.glob("*/*.jsonl")):
            session, events, s = cached_transcript_events(path)
            transcript_sessions.add(session)
            all_events.extend(events)
            skipped += s
    extra, s = live_events(transcript_sessions)
    all_events.extend(extra)
    skipped += s
    return all_events, skipped
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_metrics.py && python3 tests/test_log_event.py`
Expected: `OK test_metrics` then `OK test_log_event`

- [ ] **Step 5: Commit**

```bash
cd /Users/kktest/Projects/kktest-dev
git add plugins/tool-metrics/scripts plugins/tool-metrics/tests
git commit -m "feat(tool-metrics): merge live event log with session dedupe and cache

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Slash commands

**Files:**
- Create: `plugins/tool-metrics/commands/tool-stats.md`
- Create: `plugins/tool-metrics/commands/tool-stats-dashboard.md`

**Interfaces:**
- Consumes: `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats [...]` CLI from Tasks 3–4
- Produces: user-facing `/tool-stats` and `/tool-stats-dashboard`

- [ ] **Step 1: Create tool-stats.md**

```markdown
---
description: Show tool/MCP/skill/agent usage counts across all Claude Code sessions
allowed-tools: Bash
argument-hint: [--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]
---

Tool usage stats (all sessions on this machine):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats $ARGUMENTS`

Show the table above to the user verbatim in a code block, then add ONE short
paragraph of interpretation: the top 3 entries, and anything notable (e.g. an
MCP server that is connected but never used, or an unusually dominant tool).
Do not re-run the command with different flags unless the user asks.
```

Write to `plugins/tool-metrics/commands/tool-stats.md`.

- [ ] **Step 2: Create tool-stats-dashboard.md**

```markdown
---
description: Build an HTML dashboard of tool/MCP/skill/agent usage and publish it as an Artifact
allowed-tools: Bash, Read, Write, Edit, Skill, Artifact
argument-hint: [--since 30d] [--project SUBSTR]
---

Build a usage dashboard. Steps:

1. Collect data (pass through any user arguments such as `--since` / `--project`):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json --group server $ARGUMENTS`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json --group day $ARGUMENTS`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json --group skill $ARGUMENTS`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json --group agent $ARGUMENTS`

2. Load the `dataviz` skill (chart form/colors) and the `artifact-design` skill
   (page design) BEFORE writing any HTML.

3. Write a single self-contained HTML file to the scratchpad directory with the
   JSON data embedded inline (no external requests): summary stat tiles (total
   calls, sessions, distinct tools), a horizontal bar chart of top tools, a bar
   chart per MCP server, a daily timeline, and skills/agents breakdowns. Must
   work in light and dark themes.

4. Publish via the Artifact tool (favicon "📊", title "Tool Usage Dashboard").
   Note in the page footer that data is a static snapshot with its generation
   date, and that re-running /tool-stats-dashboard refreshes it. When
   re-running in a later conversation, update the existing artifact URL
   (Artifact action:"list" to find it) instead of minting a new one.
```

Write to `plugins/tool-metrics/commands/tool-stats-dashboard.md`.

- [ ] **Step 3: Verify frontmatter parses (eyeball) and commit**

Check both files start with `---` frontmatter and reference `${CLAUDE_PLUGIN_ROOT}` (not a hard-coded path). Then:

```bash
cd /Users/kktest/Projects/kktest-dev
git add plugins/tool-metrics/commands
git commit -m "feat(tool-metrics): add /tool-stats and /tool-stats-dashboard commands

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Enable plugin + end-to-end smoke test

**Files:**
- Modify: `/Users/kktest/.claude/settings.json` (add to `enabledPlugins`)
- Modify: `docs/superpowers/specs/2026-08-04-tool-metrics-design.md` (status line)

**Interfaces:**
- Consumes: everything above
- Produces: working plugin in the live environment

- [ ] **Step 1: Enable in settings.json**

In `/Users/kktest/.claude/settings.json`, add to the `enabledPlugins` object:

```json
    "tool-metrics@kktest-dev": true
```

(keep existing entries; validate with `python3 -m json.tool ~/.claude/settings.json > /dev/null && echo OK` → `OK`)

- [ ] **Step 2: Run full test suite once more**

Run: `cd /Users/kktest/Projects/kktest-dev/plugins/tool-metrics && python3 tests/test_metrics.py && python3 tests/test_log_event.py`
Expected: `OK test_metrics`, `OK test_log_event`

- [ ] **Step 3: Smoke test against real data**

Run: `python3 /Users/kktest/Projects/kktest-dev/plugins/tool-metrics/scripts/metrics.py stats | head -25`
Expected: a table with real counts (Bash/Read/Edit near the top, hundreds+ of calls across all local projects). Also run `... stats --group server` and confirm MCP servers appear.

- [ ] **Step 4: Update spec status + commit**

Change the spec's `**Status:** Draft (pending user approval)` line to `**Status:** Approved — implemented 2026-08-04`. Then:

```bash
cd /Users/kktest/Projects/kktest-dev
git add docs/superpowers/specs/2026-08-04-tool-metrics-design.md
git commit -m "docs(tool-metrics): mark spec implemented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Tell the user to restart**

The hook and commands load at session start — tell the user: restart Claude Code (or start a new session), then `/tool-stats` works and the PostToolUse logger begins appending events. Note that `/tool-stats` already shows full history from transcripts even before the hook has logged anything.
