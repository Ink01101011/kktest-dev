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
