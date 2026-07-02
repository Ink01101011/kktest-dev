---
name: system-optimization-loops
description: "Use this skill whenever you're tuning a reusable system artifact — a prompt, a workflow,
  a pipeline — against a held-out metric, rather than producing one output. Triggers include: 'optimize
  this prompt', 'improve the workflow's success rate', 'tune this pipeline for latency/cost', 'A/B this
  prompt variant', 'reduce the number of steps without hurting quality'. Covers Prompt Optimization and
  Workflow Optimization. Do NOT use for improving a single piece of content (see quality-loops) — the
  distinguishing feature here is that the thing being optimized is reused across many future runs, and
  the metric must be measured on held-out cases, not the same cases used to tune it."
version: "0.1.1"
updated: "2026-07-02"
---

# System Optimization Loops

## Overview

Prompt and workflow optimization loops don't produce one output — they tune a **reusable artifact**
(a prompt template, a multi-step pipeline) so that *future* runs score better on some metric. The
critical discipline this category adds beyond `quality-loops` is **held-out evaluation**: optimizing
against the same cases you tune on overfits (the prompt learns the eval set, not the task), so every
pattern here evaluates on a validation set distinct from whatever was used to propose each change.

**Prompt Optimization has a planned turnkey implementation: `prompt-evolve`** (see
`docs/proposals/PROMPT-EVOLVE_SPEC.md`). Read this skill for the pattern shape and brake wiring; use
`prompt-evolve` for a ready-made held-out-eval harness once it ships, rather than hand-rolling the eval
loop from scratch each time.

## When to Use

- ✅ You're tuning something that will run many times in the future (a prompt template, a pipeline
  config, a workflow's step sequence), not producing a single deliverable.
- ✅ You have (or can construct) a held-out set of cases to measure the metric on, separate from
  whatever informs each candidate change.
- ✅ The metric is something you can hold steady or improve while changing an unrelated dimension
  (e.g. cut latency without dropping accuracy).
- ❌ You're improving one piece of content that won't be reused as a template — that's `quality-loops`.
- ❌ You have no held-out set and would be evaluating on the same cases you're tuning against —
  fix that first; a loop over overfit numbers is worse than no loop.

## Patterns

### Prompt Optimization

Iteratively revise a prompt template (instructions, examples, structure) and re-measure its performance
on a held-out eval set, keeping revisions that improve the metric and reverting ones that don't. Use it
when a prompt's actual failure modes are visible in eval-set errors (misparses, wrong format, missed
instructions) that a rewrite can plausibly fix. Don't use it as a substitute for fixing an underlying
model/tooling limitation that no prompt wording can work around — check that first.

**Shape:** current prompt + eval set → run it → measure metric (accuracy, format-adherence, whatever's
being tracked) → propose a targeted revision based on the failure cases → re-run on the *same* held-out
set → keep if improved, revert if not.

**Wire the brake:** `loop_start { goal: "prompt metric ≥ target on held-out set", max_iterations: 6,
exit_mode: "target", target_value: <target metric value>, direction: "increase" }`, `progress: <metric
on the held-out set this round>`, `state: <the current failure-case summary the revision is targeting>`.
If the metric plateaus rather than crossing the target (a realistic outcome — not every prompt can hit
an arbitrary bar), prefer `exit_mode: "dry"` instead: `dry_rounds: 2` so two rounds with no metric
improvement ends the loop as `converged` (accept the best prompt found) rather than grinding on
`budget_exhausted`. Pick `target` when you know an achievable bar in advance, `dry` when you're
searching for "as good as this gets."

### Workflow Optimization

Iteratively revise a multi-step workflow (reorder steps, cut redundant ones, parallelize independent
ones, swap a slow step for a faster equivalent) and re-measure an operational metric (latency, cost,
step count, error rate) on representative runs, keeping changes that help. Use it once a workflow is
functionally correct and the goal shifts to efficiency without regressing correctness. Don't use it
before correctness is established — optimizing a workflow that doesn't work yet just makes broken
things faster.

**Shape:** current workflow + representative runs → measure the operational metric and re-confirm
correctness held → propose one structural change (reorder/cut/parallelize/swap) → re-measure both
metric and correctness → keep if the metric improved *and* correctness held, revert otherwise.

**Wire the brake:** direction depends on the metric. For a metric you want to shrink (latency, cost,
step count): `loop_start { goal: "reduce <metric> without regressing correctness", max_iterations: 6,
exit_mode: "target", target_value: <target latency/cost/step-count>, direction: "decrease" }` — `target`
mode's `targetReached()` genuinely honors `direction`, so `progress: <the operational metric this
round>` (the raw, un-negated number) is correct here. For a metric you want to grow (throughput, success
rate): use `direction: "increase"` with the equivalent target and the raw metric as `progress`. If you
don't have a principled target and fall back to `exit_mode: "dry"` (see the general rule below), the
raw-metric approach breaks for a shrink-direction metric: **negate it before reporting**, e.g.
`progress: -latency_ms`, so a genuine drop in latency reads as *rising* `progress` — see the dry-mode
caveat under Rules & Constraints for why. Either way, treat a correctness regression as an immediate
revert *before* the next `loop_tick` — don't let the ledger see a "progress" number from a run that
broke correctness, since it has no separate correctness channel. `state: <the structural change just
tried>` — the same change being retried after a revert (rather than a new one) is `stalled`.

## Rules & Constraints

- ALWAYS measure on a held-out set distinct from whatever informed the proposed change — this is the
  one rule specific to this category and the easiest to accidentally skip.
- ALWAYS re-confirm correctness alongside the operational metric in Workflow Optimization; a faster
  broken workflow is not progress.
- ALWAYS revert a change that didn't help before proposing the next one — don't accumulate untested
  changes.
- NEVER report `progress` from a run that regressed correctness (Workflow Optimization) or format
  validity (Prompt Optimization) even if the target metric improved — that's optimizing the wrong thing.
- Prefer `exit_mode: "dry"` over `"target"` when you don't have a principled target value in advance —
  "converged, this is as good as it gets" is an honest exit; forcing an arbitrary target number and
  hitting `budget_exhausted` is not more rigorous, just noisier.
- **`dry` mode is direction-blind — verified in `ledger.js`: its convergence tracking is
  `improved = progress > loop.best_progress`, hardcoded to "higher progress is better," and it never
  looks at `exit.direction` at all.** For an increase-direction metric (accuracy, throughput — Prompt
  Optimization's default case) this is harmless: higher really is better, so raw progress works. For a
  decrease-direction metric (latency, cost, step count — the common case in Workflow Optimization) it is
  **not** harmless: reporting the raw shrinking number will fire a false `converged` even while the
  metric keeps improving every round, because the ledger only ever compares against the *highest* value
  seen. The fix is to negate before reporting whenever you combine `exit_mode: "dry"` with a metric you
  want to shrink: report `progress: -latency_ms` (or `-cost`, `-step_count`), never the raw value, so a
  real improvement shows up as a rising number the ledger can track correctly.

## Examples

**Scenario:** "This extraction prompt gets the format wrong on 15% of held-out cases — fix it."
→ Prompt Optimization, `exit_mode: target`, `target_value: 0.98` (98% format-adherence),
`direction: increase`, measured on the held-out set each round, not the cases used to spot the failure
mode.

**Scenario:** "This 6-step review workflow takes too long; cut latency without losing quality."
→ Workflow Optimization, `exit_mode: target`, `target_value: <target seconds>`, `direction: decrease`,
correctness (review quality) re-checked every round before accepting a latency win; a step-parallelization
that saved time but dropped a check gets reverted, not counted as progress.

**Scenario:** "Optimize this prompt as much as reasonably possible" (no known achievable bar).
→ Prompt Optimization with `exit_mode: dry`, `dry_rounds: 2` — stop once two consecutive revisions fail
to move the held-out metric, and report the best-performing version found, rather than chasing an
arbitrary target.

## Changelog

- 0.1.1 (2026-07-02) — fix: documented `exit_mode: "dry"`'s direction-blindness. Live-verified against
  `loop-ledger` that `dry` mode's convergence tracking (`improved = progress > best_progress`) is
  hardcoded to "higher is better" and ignores `exit.direction` — combining `dry` with a
  decrease-direction metric (latency/cost, the natural fit for Workflow Optimization with no known
  target) previously fired a false `converged` while the metric was genuinely still improving every
  round. Added the negate-before-reporting workaround (`progress: -latency_ms`) to Workflow
  Optimization's brake and to the general rule recommending `dry` mode.
- 0.1.0 (2026-07-02) — initial version; 2 System-Optimization-category patterns (Prompt Optimization,
  Workflow Optimization), each with a real `loop-ledger` `loop_start` wiring (both `target` and `dry`
  variants covered). Cross-references `prompt-evolve` as the turnkey implementation of Prompt
  Optimization.
