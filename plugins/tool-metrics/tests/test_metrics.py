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
