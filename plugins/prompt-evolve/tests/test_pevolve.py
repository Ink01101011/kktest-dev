#!/usr/bin/env python3
"""Tests for pevolve.py — evolve a prompt against a test set (run/score/report).

score_output() is imported and unit-tested in-process (pure function, no I/O). run/score/report are
driven as a subprocess against a temporary --dir, matching plugins/reflexion/tests/test_reflexionctl.py's
convention: stdlib unittest, no mocking, real fixture files on disk.

Run: python3 -m unittest discover -s plugins/prompt-evolve/tests
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "pevolve.py"

_spec = importlib.util.spec_from_file_location("pevolve", SCRIPT)
pevolve = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(pevolve)


def run(args: list[str], pdir: Path | None = None) -> subprocess.CompletedProcess:
    argv = [sys.executable, str(SCRIPT), *args]
    if pdir is not None:
        argv += ["--dir", str(pdir)]
    return subprocess.run(argv, capture_output=True, text=True)


def write_prompt(pdir: Path, text: str) -> Path:
    p = pdir / "prompt.tmpl"
    p.write_text(text, encoding="utf-8")
    return p


def write_testset(pdir: Path, cases: list[dict]) -> Path:
    p = pdir / "testset.jsonl"
    p.write_text("\n".join(json.dumps(c) for c in cases) + "\n", encoding="utf-8")
    return p


def write_outputs(pdir_or_path, outputs: list[dict]) -> Path:
    p = pdir_or_path if isinstance(pdir_or_path, Path) and pdir_or_path.suffix else pdir_or_path / "outputs.jsonl"
    p.write_text("\n".join(json.dumps(o) for o in outputs) + "\n", encoding="utf-8")
    return p


def read_scores(pdir: Path) -> list[dict]:
    path = pdir / "generations" / "scores.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


class TestScoreFunction(unittest.TestCase):
    def test_exact_match_trimmed_equal_passes(self):
        score, note = pevolve.score_output("  hello  ", {"expected": "hello"}, "exact_match")
        self.assertEqual(score, 1.0, note)

    def test_exact_match_whitespace_only_difference_still_passes(self):
        score, _ = pevolve.score_output("hello\n", {"expected": "  hello"}, "exact_match")
        self.assertEqual(score, 1.0)

    def test_exact_match_mismatch_fails(self):
        score, note = pevolve.score_output("goodbye", {"expected": "hello"}, "exact_match")
        self.assertEqual(score, 0.0)
        self.assertIn("hello", note)

    def test_exact_match_missing_expected_scores_zero_with_note(self):
        score, note = pevolve.score_output("anything", {}, "exact_match")
        self.assertEqual(score, 0.0)
        self.assertIn("expected", note)

    def test_regex_hit_passes(self):
        score, note = pevolve.score_output("the answer is 42", {"rubric": r"\d+"}, "regex")
        self.assertEqual(score, 1.0, note)

    def test_regex_miss_fails(self):
        score, _ = pevolve.score_output("no numbers here", {"rubric": r"\d+"}, "regex")
        self.assertEqual(score, 0.0)

    def test_regex_invalid_pattern_scores_zero_not_raises(self):
        score, note = pevolve.score_output("text", {"rubric": "(unclosed"}, "regex")
        self.assertEqual(score, 0.0)
        self.assertIn("invalid", note.lower())

    def test_schema_valid_json_with_required_keys_passes(self):
        score, note = pevolve.score_output(
            json.dumps({"name": "a", "age": 1}), {"rubric": ["name", "age"]}, "schema"
        )
        self.assertEqual(score, 1.0, note)

    def test_schema_missing_key_fails(self):
        score, _ = pevolve.score_output(
            json.dumps({"name": "a"}), {"rubric": ["name", "age"]}, "schema"
        )
        self.assertEqual(score, 0.0)

    def test_schema_non_json_output_fails(self):
        score, note = pevolve.score_output("not json at all", {"rubric": ["name"]}, "schema")
        self.assertEqual(score, 0.0)
        self.assertIn("JSON", note)

    def test_schema_non_dict_json_fails(self):
        score, note = pevolve.score_output(json.dumps(["a", "b"]), {"rubric": ["name"]}, "schema")
        self.assertEqual(score, 0.0)
        self.assertIn("object", note)


class PdirTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.pdir = Path(self._tmp.name)


class TestRun(PdirTestCase):
    def test_reaches_target_with_strictly_increasing_curve(self):
        write_prompt(self.pdir, "Process: {input}")
        write_testset(self.pdir, [
            {"input": "a", "rubric": "foo"},
            {"input": "b", "rubric": "bar"},
        ])
        proc = run(["run", "--scorer", "regex", "--target", "0.99", "--max-iter", "5"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["stopped"], "target")

        entries = read_scores(self.pdir)
        self.assertGreaterEqual(len(entries), 2)
        avgs = [e["avg_score"] for e in entries]
        self.assertEqual(avgs, sorted(avgs))
        self.assertLess(avgs[0], avgs[-1])
        self.assertGreaterEqual(avgs[-1], 0.99)

        for e in entries:
            self.assertTrue((self.pdir / "generations" / f"v{e['version']}.tmpl").exists())

    def test_best_so_far_survives_a_later_regression(self):
        write_prompt(self.pdir, "T:{input}")
        write_testset(self.pdir, [
            {"input": "a", "expected": "T:a"},       # v1 already matches exactly
            {"input": "b", "expected": "FIXED"},      # structurally unfixable by appending
        ])
        v1_text = (self.pdir / "prompt.tmpl").read_text(encoding="utf-8")

        proc = run(["run", "--scorer", "exact_match", "--target", "0.99",
                    "--max-iter", "8", "--dry-rounds", "2"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        result = json.loads(proc.stdout)

        self.assertEqual(result["stopped"], "dry")
        self.assertEqual(result["best_version"], 1)
        self.assertAlmostEqual(result["best_avg_score"], 0.5)
        self.assertLessEqual(result["generations"], 4)

        entries = read_scores(self.pdir)
        self.assertAlmostEqual(entries[0]["avg_score"], 0.5)
        self.assertEqual(
            (self.pdir / "generations" / "v1.tmpl").read_text(encoding="utf-8"), v1_text
        )

    def test_missing_dir_exits_2_for_all_subcommands(self):
        missing = self.pdir / "does-not-exist"
        for sub in (["run"], ["score", "--version", "1", "--outputs", "x.jsonl"], ["report"]):
            proc = run(sub, pdir=missing)
            self.assertEqual(proc.returncode, 2, f"{sub}: {proc.stdout}{proc.stderr}")

    def test_missing_prompt_exits_1(self):
        write_testset(self.pdir, [{"input": "a", "expected": "a"}])
        proc = run(["run"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)

    def test_missing_testset_exits_1(self):
        write_prompt(self.pdir, "hi {input}")
        proc = run(["run"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)

    def test_rerun_without_force_refuses(self):
        write_prompt(self.pdir, "Process: {input}")
        write_testset(self.pdir, [{"input": "a", "rubric": "foo"}])
        proc1 = run(["run", "--scorer", "regex", "--target", "0.99", "--max-iter", "3"], pdir=self.pdir)
        self.assertEqual(proc1.returncode, 0, proc1.stdout + proc1.stderr)
        before = (self.pdir / "generations" / "scores.jsonl").read_bytes()

        proc2 = run(["run", "--scorer", "regex"], pdir=self.pdir)
        self.assertEqual(proc2.returncode, 1, proc2.stdout + proc2.stderr)
        after = (self.pdir / "generations" / "scores.jsonl").read_bytes()
        self.assertEqual(before, after)

        proc3 = run(["run", "--scorer", "regex", "--target", "0.99", "--max-iter", "3", "--force"],
                    pdir=self.pdir)
        self.assertEqual(proc3.returncode, 0, proc3.stdout + proc3.stderr)

    def test_template_with_json_literal_braces_errors_cleanly(self):
        # {"a": 1} is parsed by str.format as a field named '"a"' -> KeyError, already handled.
        write_prompt(self.pdir, "Return JSON like {\"a\": 1} for {input}")
        write_testset(self.pdir, [{"input": "x", "rubric": "a"}])
        proc = run(["run", "--scorer", "regex"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("placeholder", proc.stderr.lower())
        self.assertNotIn("Traceback", proc.stdout + proc.stderr)

    def test_template_with_unmatched_brace_errors_cleanly(self):
        # A genuinely unbalanced '{' makes str.format raise ValueError, not KeyError/IndexError.
        write_prompt(self.pdir, "Process { unmatched for {input}")
        write_testset(self.pdir, [{"input": "x", "rubric": "a"}])
        proc = run(["run", "--scorer", "regex"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("placeholder", proc.stderr.lower())
        self.assertNotIn("Traceback", proc.stdout + proc.stderr)


class TestScoreSubcommand(PdirTestCase):
    def test_score_exact_match_and_regex(self):
        write_testset(self.pdir, [
            {"input": "a", "expected": "A!"},
            {"input": "b", "expected": "B!"},
        ])
        outputs_path = self.pdir / "outputs.jsonl"
        write_outputs(outputs_path, [
            {"input": "a", "output": "A!"},
            {"input": "b", "output": "nope"},
        ])
        proc = run(["score", "--version", "1", "--outputs", str(outputs_path),
                    "--scorer", "exact_match"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

        entries = read_scores(self.pdir)
        self.assertEqual(len(entries), 1)
        self.assertAlmostEqual(entries[0]["avg_score"], 0.5)
        self.assertEqual(entries[0]["failures"], ["case-1"])

    def test_outputs_count_mismatch_exits_1(self):
        write_testset(self.pdir, [{"input": "a", "expected": "A"}, {"input": "b", "expected": "B"}])
        outputs_path = self.pdir / "outputs.jsonl"
        write_outputs(outputs_path, [{"input": "a", "output": "A"}])
        proc = run(["score", "--version", "1", "--outputs", str(outputs_path)], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)

    def test_save_prompt_copies_file_into_generations(self):
        write_testset(self.pdir, [{"input": "a", "expected": "A"}])
        outputs_path = self.pdir / "outputs.jsonl"
        write_outputs(outputs_path, [{"input": "a", "output": "A"}])
        prompt_path = self.pdir / "candidate.tmpl"
        prompt_path.write_text("candidate template {input}", encoding="utf-8")

        proc = run(["score", "--version", "3", "--outputs", str(outputs_path),
                    "--save-prompt", str(prompt_path)], pdir=self.pdir)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        saved = (self.pdir / "generations" / "v3.tmpl").read_text(encoding="utf-8")
        self.assertEqual(saved, "candidate template {input}")

    def test_two_versions_append_two_distinct_lines(self):
        write_testset(self.pdir, [{"input": "a", "expected": "A"}])
        outputs_path = self.pdir / "outputs.jsonl"
        write_outputs(outputs_path, [{"input": "a", "output": "A"}])

        run(["score", "--version", "1", "--outputs", str(outputs_path)], pdir=self.pdir)
        run(["score", "--version", "2", "--outputs", str(outputs_path)], pdir=self.pdir)
        entries = read_scores(self.pdir)
        self.assertEqual([e["version"] for e in entries], [1, 2])


class TestReport(PdirTestCase):
    def _write_scores(self, entries: list[dict]) -> None:
        gen_dir = self.pdir / "generations"
        gen_dir.mkdir(parents=True, exist_ok=True)
        (gen_dir / "scores.jsonl").write_text(
            "\n".join(json.dumps(e) for e in entries) + "\n", encoding="utf-8"
        )

    def test_report_has_curve_and_best_and_failure_summary(self):
        # deliberately not in ascending avg_score order
        self._write_scores([
            {"version": 1, "avg_score": 0.5, "per_case": [], "failures": ["case-0", "case-1"]},
            {"version": 2, "avg_score": 0.9, "per_case": [], "failures": ["case-1"]},
            {"version": 3, "avg_score": 0.6, "per_case": [], "failures": ["case-1", "case-0"]},
        ])
        proc = run(["report"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)

        report = (self.pdir / "report.md").read_text(encoding="utf-8")
        self.assertIn("| 1 | 0.500 |", report)
        self.assertIn("| 2 | 0.900 (best) |", report)
        self.assertIn("| 3 | 0.600 |", report)
        self.assertIn("Best version: **2**", report)

        idx_case1 = report.index("case-1")
        idx_case0 = report.index("case-0", report.index("Failure summary"))
        self.assertLess(idx_case1, idx_case0)  # case-1 fails 3x, case-0 fails 2x -> case-1 first

    def test_report_missing_scores_exits_1(self):
        proc = run(["report"], pdir=self.pdir)
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)


if __name__ == "__main__":
    unittest.main()
