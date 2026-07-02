#!/usr/bin/env python3
"""pevolve — evolve a prompt against a test set: run/score it, rewrite from its failures, repeat.

Implements the data model and CLI from docs/proposals/PROMPT-EVOLVE_SPEC.md, with one correction:
this CLI never calls a model (no network, stdlib only). It supports two ways of producing "outputs":

  run    A fully self-contained, deterministic, OFFLINE loop for verification/demo purposes only.
         The prompt template is rendered with plain ``str.format(input=...)`` and the rendered text
         itself IS the "output" for a case — there is no model call. This intentionally only tests
         whether a *rendered template's literal text* satisfies a deterministic check (e.g. contains
         a required instruction). The improve step is a structured, deterministic rewrite: it appends
         one new fact (drawn from the first still-failing case's expected/rubric, by ascending case
         id) per generation, so it provably converges within a bounded number of generations.

  score  Score an already-produced outputs file (one JSON object per line: {"input":..., "output":...},
         in the same order as testset.jsonl) against a given prompt generation. This is the path used
         when *Claude itself* generated the outputs interactively (this CLI has no model client of its
         own) — see the ``prompt-evolve`` skill.

  report Render report.md from testset.jsonl + generations/scores.jsonl: a score curve, the best
         version highlighted, and a failure summary (which case ids fail most often).

One scoring function, ``score_output()``, is shared by both ``run`` and ``score`` — no duplicated
scoring logic. Three deterministic scorers, all stdlib:

  exact_match   trimmed string equality of the output against case["expected"].
  regex         re.search(case["rubric"], output) — case["rubric"] is a regex pattern string.
  schema        json.loads(output) must be a dict containing every key in case["rubric"] (a JSON
                array of required top-level key names). Deliberately narrow — NOT full JSON Schema.

Data model
----------
  prompt.tmpl                 current prompt template (only {input} placeholder allowed)
  testset.jsonl                {"input": ..., "expected"?: ..., "rubric"?: ...} one per line
  generations/v1.tmpl v2.tmpl  every prompt version, kept
  generations/scores.jsonl     {version, avg_score, per_case:[{id,score,note}], failures:[id...]}
  report.md                    score curve + best version + failure summary (generated)

Config (env, CLI flags override)
---------------------------------
  PEVOLVE_DIR (default for --dir, like memory-keeper's MEMCTL_DIR)
  PEVOLVE_TARGET      default 0.9   — run stops once avg_score >= target
  PEVOLVE_MAX_ITER    default 8     — run stops after this many generations regardless
  PEVOLVE_THRESHOLD   default 0.8   — per-case pass line used to build the failures list
  PEVOLVE_DRY_ROUNDS  default 2     — run stops if best_so_far hasn't improved in this many rounds

Exit codes: 0 success; 1 data/business-logic error; 2 --dir missing/not-a-directory.

Examples
--------
  python3 pevolve.py run    --dir ./prompt-evolve --target 0.9 --max-iter 8 --scorer regex
  python3 pevolve.py score  --dir ./prompt-evolve --version 2 --outputs outputs.jsonl --scorer exact_match
  python3 pevolve.py report --dir ./prompt-evolve
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from pathlib import Path

DEFAULT_TARGET = float(os.environ.get("PEVOLVE_TARGET", "0.9"))
DEFAULT_MAX_ITER = int(os.environ.get("PEVOLVE_MAX_ITER", "8"))
DEFAULT_THRESHOLD = float(os.environ.get("PEVOLVE_THRESHOLD", "0.8"))
DEFAULT_DRY_ROUNDS = int(os.environ.get("PEVOLVE_DRY_ROUNDS", "2"))
SCORER_CHOICES = ["exact_match", "regex", "schema"]

GENERATIONS_DIR = "generations"
SCORES_FILE = "scores.jsonl"
REPORT_FILE = "report.md"


# ── scoring (shared by run + score) ────────────────────────────────────────────
def score_output(output: str, case: dict, scorer: str) -> tuple[float, str]:
    """Score one rendered/generated output against a testset case. Never raises — always returns
    (score in {0.0, 1.0}, human-readable note), even for malformed input."""
    if scorer == "exact_match":
        expected = case.get("expected")
        if expected is None:
            return 0.0, "case has no 'expected' field"
        if output.strip() == str(expected).strip():
            return 1.0, "exact match"
        return 0.0, f"expected {str(expected)!r}, got {output!r}"

    if scorer == "regex":
        pattern = case.get("rubric")
        if not pattern:
            return 0.0, "case has no 'rubric' pattern"
        try:
            hit = re.search(str(pattern), output) is not None
        except re.error as e:
            return 0.0, f"invalid regex pattern: {e}"
        if hit:
            return 1.0, f"regex {pattern!r} matched"
        return 0.0, f"regex {pattern!r} did not match"

    if scorer == "schema":
        required = case.get("rubric")
        if not isinstance(required, list) or not required:
            return 0.0, "case's 'rubric' must be a JSON array of required key names"
        try:
            obj = json.loads(output)
        except json.JSONDecodeError:
            return 0.0, "output is not valid JSON"
        if not isinstance(obj, dict):
            return 0.0, "output is not a JSON object"
        missing = [k for k in required if k not in obj]
        if missing:
            return 0.0, f"missing keys: {missing}"
        return 1.0, "all required keys present"

    return 0.0, f"unknown scorer: {scorer}"


# ── testset / outputs / scores I/O ─────────────────────────────────────────────
def load_testset(path: Path) -> list[dict]:
    cases = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        line = line.strip()
        if not line:
            continue
        case = json.loads(line)
        case.setdefault("id", f"case-{i}")
        cases.append(case)
    return cases


def load_outputs(path: Path) -> list[dict]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        out.append(json.loads(line))
    return out


def append_score_entry(gen_dir: Path, entry: dict) -> None:
    gen_dir.mkdir(parents=True, exist_ok=True)
    with (gen_dir / SCORES_FILE).open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def load_scores(gen_dir: Path) -> list[dict]:
    scores_path = gen_dir / SCORES_FILE
    entries = []
    for line in scores_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            entries.append(json.loads(line))
    return entries


def best_so_far(entries: list[dict]) -> dict:
    """Highest avg_score; ties broken toward the EARLIEST version (a later regression never wins)."""
    return max(entries, key=lambda e: (e["avg_score"], -e["version"]))


# ── run: fully offline verification/demo loop ──────────────────────────────────
def hint_for(case: dict, scorer: str) -> str | None:
    """The deterministic fact to append to the template to try to fix this case, or None if the
    case carries nothing usable for this scorer."""
    if scorer == "exact_match":
        v = case.get("expected")
    elif scorer == "regex":
        v = case.get("rubric")
    elif scorer == "schema":
        required = case.get("rubric")
        if not isinstance(required, list) or not required:
            return None
        return "\n".join(f'"{k}": ...' for k in required)
    else:
        return None
    if v in (None, ""):
        return None
    return str(v)


def improve_prompt(template: str, testset: list[dict], failing_ids: set[str], scorer: str) -> str:
    """Append the FIRST new hint (by ascending case id / testset order) not already present in the
    template. Deterministic, adds at most one new fact per call, and is bounded by the number of
    distinct hints — so a `run` loop built on this always terminates. Returns `template` unchanged
    if no new hint is available."""
    for case in testset:
        if case["id"] not in failing_ids:
            continue
        hint = hint_for(case, scorer)
        if not hint or hint in template:
            continue
        sep = "" if template.endswith("\n") else "\n"
        return f"{template}{sep}{hint}\n"
    return template


def render_case(template: str, case: dict) -> str:
    return template.format(input=case["input"])


def score_generation(template: str, testset: list[dict], scorer: str, threshold: float,
                      version: int) -> dict:
    per_case = []
    for case in testset:
        output = render_case(template, case)
        score, note = score_output(output, case, scorer)
        per_case.append({"id": case["id"], "score": score, "note": note})
    avg = statistics.fmean(pc["score"] for pc in per_case) if per_case else 0.0
    failures = [pc["id"] for pc in per_case if pc["score"] < threshold]
    return {"version": version, "avg_score": avg, "per_case": per_case, "failures": failures}


def cmd_run(args) -> int:
    pdir = Path(args.dir)
    prompt_path = pdir / "prompt.tmpl"
    testset_path = pdir / "testset.jsonl"
    if not prompt_path.exists():
        print(f"error: {prompt_path} not found", file=sys.stderr)
        return 1
    if not testset_path.exists():
        print(f"error: {testset_path} not found", file=sys.stderr)
        return 1

    testset = load_testset(testset_path)
    if not testset:
        print(f"error: {testset_path} is empty", file=sys.stderr)
        return 1

    gen_dir = pdir / GENERATIONS_DIR
    scores_path = gen_dir / SCORES_FILE
    if scores_path.exists() and not args.force:
        print(f"error: {scores_path} already exists; pass --force to start a fresh evolution "
              f"(this deletes existing generations/v*.tmpl and scores.jsonl)", file=sys.stderr)
        return 1
    if args.force and gen_dir.is_dir():
        for p in gen_dir.glob("v*.tmpl"):
            p.unlink()
        if scores_path.exists():
            scores_path.unlink()
    gen_dir.mkdir(parents=True, exist_ok=True)

    template = prompt_path.read_text(encoding="utf-8")
    history: list[dict] = []
    version = 1
    reason = "max_iter"

    while True:
        try:
            entry = score_generation(template, testset, args.scorer, args.threshold, version)
        except (KeyError, IndexError, ValueError) as e:
            print(f"error: prompt.tmpl has a placeholder pevolve can't render ({e!r}); "
                  f"only a literal {{input}} placeholder is supported", file=sys.stderr)
            return 1

        (gen_dir / f"v{version}.tmpl").write_text(template, encoding="utf-8")
        append_score_entry(gen_dir, entry)
        history.append(entry)

        if entry["avg_score"] >= args.target:
            reason = "target"
            break
        if version >= args.max_iter:
            reason = "max_iter"
            break
        if len(history) >= args.dry_rounds + 1:
            best_now = best_so_far(history)
            best_then = best_so_far(history[: len(history) - args.dry_rounds])
            if best_now["avg_score"] <= best_then["avg_score"]:
                reason = "dry"
                break

        failing_ids = set(entry["failures"])
        new_template = improve_prompt(template, testset, failing_ids, args.scorer)
        if new_template == template:
            reason = "dry"
            break
        template = new_template
        version += 1

    best = best_so_far(history)
    result = {
        "stopped": reason,
        "generations": len(history),
        "best_version": best["version"],
        "best_avg_score": best["avg_score"],
    }
    print(json.dumps(result, indent=2))
    return 0


# ── score: score an externally-produced outputs file ───────────────────────────
def cmd_score(args) -> int:
    pdir = Path(args.dir)
    testset_path = pdir / "testset.jsonl"
    if not testset_path.exists():
        print(f"error: {testset_path} not found", file=sys.stderr)
        return 1
    testset = load_testset(testset_path)
    if not testset:
        print(f"error: {testset_path} is empty", file=sys.stderr)
        return 1

    outputs_path = Path(args.outputs)
    if not outputs_path.exists():
        print(f"error: outputs file {outputs_path} not found", file=sys.stderr)
        return 1
    outputs = load_outputs(outputs_path)
    if len(outputs) != len(testset):
        print(f"error: outputs file has {len(outputs)} line(s) but testset has {len(testset)} "
              f"case(s) — score requires one output per case, in the same order", file=sys.stderr)
        return 1

    per_case = []
    for case, out in zip(testset, outputs):
        if "output" not in out:
            print(f"error: outputs line for case {case['id']} has no 'output' field", file=sys.stderr)
            return 1
        score, note = score_output(out["output"], case, args.scorer)
        per_case.append({"id": case["id"], "score": score, "note": note})
    avg = statistics.fmean(pc["score"] for pc in per_case) if per_case else 0.0
    failures = [pc["id"] for pc in per_case if pc["score"] < args.threshold]
    entry = {"version": args.version, "avg_score": avg, "per_case": per_case, "failures": failures}

    gen_dir = pdir / GENERATIONS_DIR
    append_score_entry(gen_dir, entry)

    if args.save_prompt:
        save_path = Path(args.save_prompt)
        if not save_path.exists():
            print(f"error: --save-prompt file {save_path} not found", file=sys.stderr)
            return 1
        (gen_dir / f"v{args.version}.tmpl").write_text(
            save_path.read_text(encoding="utf-8"), encoding="utf-8"
        )

    print(f"scored version {args.version}: avg_score={avg:.3f}  failures={failures}")
    return 0


# ── report ──────────────────────────────────────────────────────────────────────
def render_report(entries: list[dict]) -> str:
    ordered = sorted(entries, key=lambda e: e["version"])
    best = best_so_far(entries)

    lines = ["# Prompt Evolution Report", "", "## Score curve", "", "| Version | Avg Score |", "|---|---|"]
    for e in ordered:
        marker = " (best)" if e["version"] == best["version"] else ""
        lines.append(f"| {e['version']} | {e['avg_score']:.3f}{marker} |")
    lines.append("")
    lines.append(f"Best version: **{best['version']}** (avg_score {best['avg_score']:.3f})")
    lines.append("")

    fail_counts: dict[str, int] = {}
    for e in entries:
        for cid in e.get("failures", []):
            fail_counts[cid] = fail_counts.get(cid, 0) + 1
    lines.append("## Failure summary")
    lines.append("")
    if fail_counts:
        lines.append("| Case | Times failed |")
        lines.append("|---|---|")
        for cid, count in sorted(fail_counts.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"| {cid} | {count} |")
    else:
        lines.append("No failures recorded.")
    lines.append("")
    return "\n".join(lines)


def cmd_report(args) -> int:
    pdir = Path(args.dir)
    gen_dir = pdir / GENERATIONS_DIR
    scores_path = gen_dir / SCORES_FILE
    if not scores_path.exists():
        print(f"error: {scores_path} not found — run `pevolve.py run` or `pevolve.py score` first",
              file=sys.stderr)
        return 1
    entries = load_scores(gen_dir)
    if not entries:
        print(f"error: {scores_path} is empty", file=sys.stderr)
        return 1

    content = render_report(entries)
    out_path = pdir / REPORT_FILE
    out_path.write_text(content, encoding="utf-8")
    print(f"wrote {out_path}")
    return 0


# ── cli ───────────────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dir", default=os.environ.get("PEVOLVE_DIR", "."),
                        help="prompt-evolve directory (default: $PEVOLVE_DIR or .)")

    p = argparse.ArgumentParser(prog="pevolve", description=__doc__, parents=[common],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", parents=[common],
                       help="fully offline, deterministic run+improve loop (verification/demo)")
    r.add_argument("--target", type=float, default=DEFAULT_TARGET, help="stop once avg_score >= target")
    r.add_argument("--max-iter", type=int, default=DEFAULT_MAX_ITER, help="max generations")
    r.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                  help="per-case pass line used to build the failures list")
    r.add_argument("--dry-rounds", type=int, default=DEFAULT_DRY_ROUNDS,
                  help="stop if best_so_far hasn't improved in this many rounds")
    r.add_argument("--scorer", choices=SCORER_CHOICES, default="exact_match")
    r.add_argument("--force", action="store_true",
                  help="delete any existing generations/ and start a fresh v1 evolution")
    r.set_defaults(fn=cmd_run)

    s = sub.add_parser("score", parents=[common],
                       help="score an externally-produced outputs file against a generation")
    s.add_argument("--version", type=int, required=True, help="generation version number")
    s.add_argument("--outputs", required=True,
                  help="path to a JSONL file, one {'input':..., 'output':...} per case, same order as testset")
    s.add_argument("--scorer", choices=SCORER_CHOICES, default="exact_match")
    s.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                  help="per-case pass line used to build the failures list")
    s.add_argument("--save-prompt", help="copy this prompt file into generations/v<version>.tmpl")
    s.set_defaults(fn=cmd_score)

    rep = sub.add_parser("report", parents=[common], help="render report.md from generations/scores.jsonl")
    rep.set_defaults(fn=cmd_report)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    pdir = Path(args.dir)
    if not pdir.is_dir():
        print(f"error: --dir {pdir} is not a directory", file=sys.stderr)
        return 2
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
