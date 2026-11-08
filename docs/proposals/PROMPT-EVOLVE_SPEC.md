# prompt-evolve — Specification

> **Historical (2026-11-08).** This is the proposal written before `prompt-evolve` shipped. It is kept as a
> design record and is not updated. What ships now: [plugins/prompt-evolve](../../plugins/prompt-evolve/README.md),
> [docs/prompt-evolve/SPEC.md](../prompt-evolve/SPEC.md).

Status: 0.1.0 (proposal) · Date: 2026-07-02 · Author: Ink

> Proposal spec. A dependency-light eval-harness for Loop Category 5 (System Optimization): run a prompt
> over a test set, score every output, rewrite the prompt to fix its failures, repeat. The best prompts
> in production aren't written — they're evolved.

## 1. Problem

Most engineers write a prompt once and never touch it. Prompt Optimization (#19) turns that into a
loop: score the prompt on a held-out test set, find where it fails, rewrite to fix those cases, rerun.
There's no small, reviewable, dependency-free tool in this ecosystem to do it — LangSmith/DSPy-class
harnesses are heavy and hosted. `prompt-evolve` fills the gap in the repo's house style (stdlib CLI +
plain files + git), reusing `critique-gate`'s scorer and `loop-ledger`'s brake.

## 2. Goals & non-goals

**Goals**
- Given a prompt template, a test set (inputs + optional expected/rubric), and a scorer, iteratively
  improve the prompt and report the score curve.
- Keep every generation of the prompt on disk, versioned and diffable (git-friendly).
- Reuse `critique-gate` as the default scorer and `loop-ledger` as the iteration backstop.
- Stay reviewable: prompts, test cases, and results are plain files; the loop is deterministic given a
  fixed model seed.

**Non-goals**
- Not a general fine-tuning tool (no weights; this is prompt-level, matching the "no human touched it"
  claim of #19).
- No hosted dashboard or DB — results are Markdown/JSON on disk (a static report is fine).
- Not a live production optimizer (#20 Workflow Optimization is a separate, larger concern — noted in
  roadmap).
- No guarantee of monotonic improvement — it keeps `best_so_far` and can stall.

## 3. Principles

1. **Evolve against ground truth.** Improvement is measured on a test set with a scorer, never on the
   model's opinion of its own prompt.
2. **Keep every generation.** Prompt v1…vN are files; you can diff, revert, and audit what changed and
   why (which failures drove the rewrite).
3. **Bounded and honest.** `loop-ledger` closes the loop on `target` (avg score ≥ goal), `dry` (no
   improvement for K rounds), or `budget_exhausted`; return `best_so_far`, not the last attempt.
4. **Reuse the scorer.** The same critic that gates single outputs (`critique-gate`) scores test-set
   outputs here — one definition of "good".

## 4. Data model

```
prompt-evolve/
├── prompt.tmpl                 # current prompt template ({input} placeholders)
├── testset.jsonl               # {"input": …, "expected"?: …, "rubric"?: …}
├── generations/
│   ├── v1.tmpl  v2.tmpl …      # every prompt version, kept
│   └── scores.jsonl            # {version, avg_score, per_case:[…], failures:[…]}
└── report.md                   # score curve + best version + failure summary (generated)
```

## 5. Flow

```
loop_start { goal:"avg score ≥ T", exit_mode:"target", target_value:T,
             direction:"increase", max_iterations:N }
for iteration:
  outputs = [ run(current_prompt, case.input) for case in testset ]
  scores  = [ score(o, case) for o, case in zip(outputs, testset) ]   // via critique-gate
  avg     = mean(scores)
  loop_tick { loop_id, state: hash(sorted failing case ids), progress: avg }
  if !should_continue: break        // target_reached | stalled | budget_exhausted
  failures       = [ case for case, s in ... if s < threshold ]
  current_prompt = improve_prompt(current_prompt, failures)   // rewrite driven by failing cases
  save generation
report best_so_far
```

`state = failing case ids` ⇒ if the same cases keep failing, the ledger flags `stalled` (the prompt
can't fix them — needs human insight or better test cases) instead of spinning.

## 6. Interfaces

### 6.1 CLI (`scripts/pevolve.py`, stdlib only)
`python3 pevolve.py <run|score|report> --dir <path> --target 0.9 --max-iter 8`. Mirrors
`memory-keeper`'s `memctl.py` conventions (env `PEVOLVE_DIR`, exit codes 0/1/2).

### 6.2 Skill (`prompt-evolve`)
Encodes the loop and the "rewrite from failures" step; triggers on "optimize/tune this prompt",
"my prompt fails on X".

### 6.3 Scorer plug-point
Default: `critique-gate` rubric scorer. Alternatives: exact-match / regex / JSON-schema validity for
extraction-style tasks (deterministic, no model call).

### 6.4 Config
`PEVOLVE_TARGET` (0.9), `PEVOLVE_MAX_ITER` (8), `PEVOLVE_THRESHOLD` (per-case pass line, 0.8),
`PEVOLVE_DRY_ROUNDS` (2).

## 7. Chaining

`prompt-evolve` is the **system-optimization** node of the self-improvement chain
(see [SELF-IMPROVEMENT-CHAIN SPEC](./SELF-IMPROVEMENT-CHAIN_SPEC.md)): it improves the very prompts the
other loops use, closing the outer loop ("the loop improves the loop"). Its failure summaries feed
[`reflexion`](./REFLEXION_SPEC.md) as durable lessons; its scorer is [`critique-gate`](./CRITIQUE-GATE_SPEC.md);
its brake is `loop-ledger`.

## 8. Design decisions

- **Files over a DB.** Prompt generations and scores as plain files make the whole evolution
  git-reviewable and revertable — matches `memory-keeper`'s "plain files + git" ethos.
- **Return `best_so_far`.** Prompt rewrites aren't monotonic; never ship the last attempt blindly.
- **Reuse one scorer.** Sharing `critique-gate`'s rubric avoids two competing definitions of quality.

## 9. Roadmap

1. **Prompt Optimization (#19)** — this spec.
2. **Workflow Optimization (#20)** — measure latency/cost/quality of a whole pipeline and modify the
   workflow (parallelize, swap in a cheaper model, add a critic). Larger; separate spec later.

## 10. Open questions

1. **Test-set overfitting.** Need a held-out split so the prompt doesn't just memorize the eval cases.
2. **Cost control.** N cases × M iterations × model calls — surface a token/cost budget via
   `loop-ledger`'s `max_tokens`.
3. **`improve_prompt` strategy.** Freeform rewrite vs structured (add few-shot from failing cases vs
   edit instructions). Start structured for reviewability.

## 11. Verification

- On a toy test set with a known-bad prompt, average score improves across generations and the report
  shows the curve; `best_so_far` is selected correctly.
- Stall case: unfixable cases trigger `stalled` and return the best prior version.
- CLI exit codes and `claude plugin validate` green.

## Provenance

System Optimization Loops (#19–20) from Rahul (@sairahul1), *"20 Loop Design Patterns Every AI Engineer
Should Know"* (x.com/sairahul1/status/2072258045460226373, Jul 1 2026).
