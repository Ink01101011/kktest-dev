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
