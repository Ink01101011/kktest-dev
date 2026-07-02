#!/usr/bin/env python3
"""Tests for reflexionctl.py — recall / reflect / library / compress over a memory-keeper store.

Drives the CLI as a subprocess (black-box, matches real usage) against a temporary store. Does not
set MEMCTL_PATH — this also exercises reflexionctl's fallback resolution of memory-keeper's memctl.py
via the in-repo sibling path (plugins/memory-keeper/scripts/memctl.py).

Run: python3 -m unittest discover -s plugins/reflexion/tests
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "reflexionctl.py"


def run(args: list[str], store: Path | None = None) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(SCRIPT), *args]
    if store is not None:
        argv += ["--dir", str(store)]
    return subprocess.run(argv, capture_output=True, text=True)


def write_lesson(store: Path, name: str, description: str, loop: str,
                  what: str = "what", why: str = "why", how: str = "how",
                  status: str = "active") -> Path:
    content = (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "metadata:\n"
        "  type: feedback\n"
        f"  loop: {loop}\n"
        f"  status: {status}\n"
        "---\n\n"
        f"**What happened:** {what}\n"
        f"**Why it failed / worked:** {why}\n"
        f"**How to apply next time:** {how}\n"
    )
    path = store / f"{name}.md"
    path.write_text(content, encoding="utf-8")
    return path


class StoreTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = Path(self._tmp.name)


class TestRecall(StoreTestCase):
    def test_ranks_matching_lesson_first(self):
        write_lesson(self.store, "lesson-stop-hook", "Stop hooks must fail open",
                     loop="error", what="a Stop hook trapped the session on misconfig")
        write_lesson(self.store, "lesson-unrelated", "Use UTC in the database",
                     loop="success", what="storing naive datetimes caused off-by-N-hours bugs")

        proc = run(["recall", "writing a stop hook"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        idx_hook = proc.stdout.find("lesson-stop-hook")
        idx_unrelated = proc.stdout.find("lesson-unrelated")
        self.assertNotEqual(idx_hook, -1, proc.stdout)
        self.assertTrue(idx_unrelated == -1 or idx_hook < idx_unrelated, proc.stdout)

    def test_empty_store_does_not_crash(self):
        proc = run(["recall", "anything"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_filters_by_loop(self):
        write_lesson(self.store, "lesson-e", "an error lesson", loop="error", what="stop hook trap")
        write_lesson(self.store, "lesson-s", "a success lesson", loop="success", what="stop hook worked")
        proc = run(["recall", "stop hook", "--loop", "success"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("lesson-s", proc.stdout)
        self.assertNotIn("lesson-e", proc.stdout)

    def test_top_k_limits_results(self):
        for i in range(5):
            write_lesson(self.store, f"lesson-{i}", f"lesson {i}", loop="error", what="stop hook trap")
        proc = run(["recall", "stop hook", "--top-k", "2"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(sum(proc.stdout.count(f"lesson-{i}") for i in range(5)), 2)


class TestReflect(StoreTestCase):
    def test_writes_valid_feedback_lesson_and_regenerates_index(self):
        proc = run([
            "reflect", "--name", "lesson-test",
            "--what", "forgot to check env var before running",
            "--why", "assumed default was always set",
            "--how", "verify env vars exist before using them",
        ], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)

        path = self.store / "lesson-test.md"
        self.assertTrue(path.exists())
        text = path.read_text(encoding="utf-8")
        self.assertIn("type: feedback", text)
        self.assertIn("loop: reflexion", text)
        self.assertIn("forgot to check env var", text)

        index = (self.store / "MEMORY.md").read_text(encoding="utf-8")
        self.assertIn("lesson-test", index)

    def test_skips_when_name_already_exists(self):
        write_lesson(self.store, "lesson-dup", "existing", loop="reflexion", what="original")
        proc = run([
            "reflect", "--name", "lesson-dup",
            "--what", "different content entirely",
            "--why", "y", "--how", "h",
        ], store=self.store)
        self.assertEqual(proc.returncode, 1, proc.stdout)
        text = (self.store / "lesson-dup.md").read_text(encoding="utf-8")
        self.assertIn("original", text)  # not overwritten

    def test_force_overwrites_existing_name(self):
        write_lesson(self.store, "lesson-dup", "existing", loop="reflexion", what="original")
        proc = run([
            "reflect", "--name", "lesson-dup", "--force",
            "--what", "replaced content",
            "--why", "y", "--how", "h",
        ], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        text = (self.store / "lesson-dup.md").read_text(encoding="utf-8")
        self.assertIn("replaced content", text)

    def test_skips_near_duplicate_content_under_different_name(self):
        write_lesson(self.store, "lesson-a", "env var lesson",
                     loop="error", what="forgot to check env var before running the deploy script")
        proc = run([
            "reflect", "--name", "lesson-b",
            "--what", "forgot to check env var before running the deploy script",
            "--why", "y", "--how", "h",
        ], store=self.store)
        self.assertEqual(proc.returncode, 1, proc.stdout)
        self.assertFalse((self.store / "lesson-b.md").exists())

    def test_auto_generated_name_from_what(self):
        proc = run([
            "reflect", "--what", "always run tests before committing",
            "--why", "y", "--how", "h",
        ], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        matches = list(self.store.glob("lesson-*.md"))
        self.assertEqual(len(matches), 1, matches)


class TestLibrary(StoreTestCase):
    def test_filters_by_loop(self):
        write_lesson(self.store, "lesson-e", "error one", loop="error")
        write_lesson(self.store, "lesson-s", "success one", loop="success")
        write_lesson(self.store, "lesson-r", "reflexion one", loop="reflexion")

        proc = run(["library", "--loop", "error"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("lesson-e", proc.stdout)
        self.assertNotIn("lesson-s", proc.stdout)
        self.assertNotIn("lesson-r", proc.stdout)

    def test_no_filter_lists_all_active_feedback(self):
        write_lesson(self.store, "lesson-e", "error one", loop="error")
        write_lesson(self.store, "lesson-s", "success one", loop="success")
        proc = run(["library"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("lesson-e", proc.stdout)
        self.assertIn("lesson-s", proc.stdout)

    def test_excludes_archived(self):
        write_lesson(self.store, "lesson-old", "old one", loop="error", status="archived")
        proc = run(["library"], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertNotIn("lesson-old", proc.stdout)


class TestCompress(StoreTestCase):
    def test_merges_two_lessons_and_archives_originals(self):
        write_lesson(self.store, "lesson-a", "first", loop="error", what="failed on X once")
        write_lesson(self.store, "lesson-b", "second", loop="error", what="failed on X again")

        proc = run([
            "compress", "--names", "lesson-a", "lesson-b",
            "--name", "pattern-x",
            "--pattern", "Pattern: X -> do Y first",
            "--how", "check Y before X",
        ], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

        pattern_path = self.store / "pattern-x.md"
        self.assertTrue(pattern_path.exists())
        text = pattern_path.read_text(encoding="utf-8")
        self.assertIn("[[lesson-a]]", text)
        self.assertIn("[[lesson-b]]", text)

        self.assertFalse((self.store / "lesson-a.md").exists())
        self.assertFalse((self.store / "lesson-b.md").exists())
        self.assertTrue((self.store / "archive" / "lesson-a.md").exists())
        self.assertTrue((self.store / "archive" / "lesson-b.md").exists())

        index = (self.store / "MEMORY.md").read_text(encoding="utf-8")
        self.assertIn("pattern-x", index)
        self.assertNotIn("lesson-a", index)

    def test_dry_run_makes_no_changes(self):
        write_lesson(self.store, "lesson-a", "first", loop="error")
        write_lesson(self.store, "lesson-b", "second", loop="error")

        proc = run([
            "compress", "--names", "lesson-a", "lesson-b",
            "--name", "pattern-x", "--pattern", "p", "--how", "h",
            "--dry-run",
        ], store=self.store)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertIn("DRY RUN", proc.stdout)
        self.assertTrue((self.store / "lesson-a.md").exists())
        self.assertTrue((self.store / "lesson-b.md").exists())
        self.assertFalse((self.store / "pattern-x.md").exists())

    def test_unknown_name_errors(self):
        write_lesson(self.store, "lesson-a", "first", loop="error")
        proc = run([
            "compress", "--names", "lesson-a", "lesson-missing",
            "--pattern", "p", "--how", "h",
        ], store=self.store)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)

    def test_requires_at_least_two_sources(self):
        write_lesson(self.store, "lesson-a", "first", loop="error")
        proc = run(["compress", "--names", "lesson-a", "--pattern", "p", "--how", "h"], store=self.store)
        self.assertEqual(proc.returncode, 2, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main()
