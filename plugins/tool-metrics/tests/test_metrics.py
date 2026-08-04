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
        # 8 from the top-level transcript + 1 from the nested subagent file
        assert out["total"] == 9
        assert out["sessions"] == 1
        assert out["skipped"] == 1


def test_group_server():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "server")
        assert out["counts"]["claude_ai_Figma"] == 2
        assert out["counts"]["builtin"] == 7  # includes nested subagent Grep


def test_group_skill_and_agent():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "skill")
        assert out["counts"] == {"superpowers:brainstorming": 1}
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "agent")
        assert out["counts"] == {"Explore": 1}


def test_since_filter():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--since", "2026-08-02")
        # only the 4 events on 2026-08-02 remain (3 top-level + nested Grep)
        assert out["total"] == 4
        out = run_stats(FIXTURE_PROJECTS, td, "--since", "1d")
        # fixture timestamps are far in the past relative to any run date
        assert out["total"] == 0


def test_project_filter():
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td, "--project", "test-proj")
        assert out["total"] == 9
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
        assert "9 calls" in proc.stdout
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
        assert out["total"] == 10
        assert out["sessions"] == 2


def test_cache_created_and_correct():
    with tempfile.TemporaryDirectory() as td:
        first = run_stats(FIXTURE_PROJECTS, td)
        cache_files = list((Path(td) / "cache").glob("*.json"))
        assert len(cache_files) == 2  # top-level transcript + nested subagent
        second = run_stats(FIXTURE_PROJECTS, td)  # served from cache
        assert second == first


def test_naive_timestamp_with_since():
    """An offset-naive transcript timestamp must not break --since."""
    with tempfile.TemporaryDirectory() as td:
        projects = Path(td) / "projects"
        (projects / "-naive-proj").mkdir(parents=True)
        line = {
            "sessionId": "naive-0001",
            "timestamp": "2026-08-01 10:00:00",
            "message": {"content": [{"type": "tool_use", "name": "Bash",
                                     "input": {}}]},
        }
        (projects / "-naive-proj" / "naive-0001.jsonl").write_text(
            json.dumps(line) + "\n")
        # run_stats asserts returncode == 0
        run_stats(projects, Path(td) / "metrics", "--since", "7d")


def test_bad_since_value_errors_cleanly():
    """An unparseable --since exits nonzero with an argparse-style message."""
    with tempfile.TemporaryDirectory() as td:
        env = dict(os.environ,
                   CLAUDE_PROJECTS_DIR=str(FIXTURE_PROJECTS),
                   TOOL_METRICS_DIR=str(td))
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "stats", "--json",
             "--since", "yesterday"],
            env=env, capture_output=True, text=True)
        assert proc.returncode != 0
        assert "invalid --since" in proc.stderr
        assert "Traceback" not in proc.stderr


def test_nested_subagent_transcript():
    """Subagent transcripts nest under <project>/<session>/subagents/."""
    with tempfile.TemporaryDirectory() as td:
        out = run_stats(FIXTURE_PROJECTS, td)
        assert out["counts"]["Grep"] == 1
        assert out["total"] == 9
        # nested file carries the parent sessionId -> still one session
        assert out["sessions"] == 1
    with tempfile.TemporaryDirectory() as td:
        # project name comes from the first component under the root, not the
        # containing directory ("subagents"), so the Grep lands in -test-proj
        out = run_stats(FIXTURE_PROJECTS, td, "--group", "project")
        assert out["counts"] == {"-test-proj": 9}


def test_unreadable_transcript_is_skipped():
    """chmod 000 transcripts are skipped silently and counted as skipped."""
    if os.geteuid() == 0:
        return  # root can read anything; the mode bits prove nothing
    with tempfile.TemporaryDirectory() as td:
        projects = Path(td) / "projects"
        (projects / "-perm-proj").mkdir(parents=True)
        good = {
            "sessionId": "good-0001",
            "timestamp": "2026-08-01T10:00:00.000Z",
            "message": {"content": [{"type": "tool_use", "name": "Bash",
                                     "input": {}}]},
        }
        (projects / "-perm-proj" / "good-0001.jsonl").write_text(
            json.dumps(good) + "\n")
        bad = projects / "-perm-proj" / "bad-0002.jsonl"
        bad.write_text(json.dumps(good) + "\n")
        bad.chmod(0o000)
        try:
            # run_stats asserts returncode == 0
            out = run_stats(projects, Path(td) / "metrics")
            assert out["counts"]["Bash"] == 1  # only the readable one
            assert out["skipped"] == 1  # unreadable file counted once
        finally:
            bad.chmod(0o600)  # so TemporaryDirectory can clean up


def test_tampered_cache_is_ignored():
    """A cache file holding valid-but-non-object JSON must not crash the run."""
    with tempfile.TemporaryDirectory() as td:
        first = run_stats(FIXTURE_PROJECTS, td)
        cache_files = list((Path(td) / "cache").glob("*.json"))
        assert cache_files
        for cache_file in cache_files:
            cache_file.write_text("[1,2,3]")
        second = run_stats(FIXTURE_PROJECTS, td)
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
    test_naive_timestamp_with_since()
    test_bad_since_value_errors_cleanly()
    test_nested_subagent_transcript()
    test_unreadable_transcript_is_skipped()
    test_tampered_cache_is_ignored()
    print("OK test_metrics")
