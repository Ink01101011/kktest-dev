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
