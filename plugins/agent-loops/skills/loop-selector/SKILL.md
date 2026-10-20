---
name: loop-selector
description: "Use this skill whenever a task sounds like it needs a loop but it's not yet clear which
  kind — 'make this better', 'fix the failing suite', 'explore N designs', 'don't repeat that mistake',
  'find a plan that works', 'optimize this prompt'. It's a router: read the task description, pick the
  matching category skill (quality-loops / memory-loops / planning-loops / exploration-loops /
  system-optimization-loops) and pattern, and produce the concrete loop_start config. Do NOT use this
  once you already know which category and pattern apply — go straight to that category skill instead;
  this is only for the ambiguous 'which loop do I even want' moment."
version: "0.1.2"
updated: "2026-10-20"
---

# Loop Selector

## Overview

Five categories, twenty patterns — this skill is the router that gets you from a task description to
the right one without reading all five category skills every time. It is prose and a decision tree, not
code: given a task, it names the category, the specific pattern within it, and hands you the exact
`loop_start` call. The actual pattern detail (when-to-use nuance, minimal shape, full brake rationale)
lives in the category skill this one points you to — read that too before wiring the loop for real.

## When to Use

- ✅ You have a task that clearly wants iteration/looping but you haven't picked a pattern yet.
- ✅ You want a second opinion on whether a task is even loop-shaped at all (some aren't).
- ❌ You already know the category and pattern — skip straight to that category skill.
- ❌ The task is a single pass with no evaluation step conceivable — don't force a loop onto it; not
  every task benefits from one (see the "when NOT to loop at all" check below).

## Step 0 — Is this loop-shaped at all?

Before picking a category, confirm three things; if any is "no," don't loop:

1. **Is there a way to tell progress apart from no-progress?** A `state` string that changes when work
   actually advances, or a numeric `progress` metric. No signal, no loop — you'd just be guessing when
   to stop.
2. **Is one pass plausibly insufficient?** If a single generation is reliably good enough, a loop adds
   cost for no benefit.
3. **Is there a natural stopping point** (a score, a count, a "nothing new found," or an explicit
   human/ground-truth confirmation)? If genuinely none of these apply even in principle, this isn't a
   loop-ledger-shaped problem.

If all three hold, proceed to the decision tree.

## Step 1 — Decision tree

Match the task description against these buckets, in order (first match wins — some tasks could
plausibly fit two categories; pick by what you're fundamentally doing: improving one thing, remembering
across sessions, adapting a plan, choosing among options, or tuning a reusable artifact):

1. **"Make this one thing better / is this good enough / grade it / stress-test it."**
   → **`quality-loops`**. You're improving a single output in place against a score.
   - Single rubric, one critic → *Generate→Critique→Rewrite*.
   - Automated scorer, no structured feedback → *Score-and-Retry*.
   - Several independent quality dimensions (correctness/style/safety) → *Multi-Critic*.
   - Needs to survive hostile scrutiny, not just a rubric score → *Adversarial Critique*.
   - High-stakes, one critic's opinion isn't enough → *Judge Ensemble*.
   - Companion: `critique-gate` if you want this enforced (Stop hook blocks until threshold clears).

2. **"Remember this / don't repeat that mistake / what have we learned / compress these lessons."**
   → **`memory-loops`** (implemented today by bantamkit's memory tools — use them, don't hand-roll the store).
   - Default recall-before / reflect-after on a task → *Reflexion*.
   - A batch of new facts needs to reconcile with existing memory → *Memory Update*.
   - Backfilling/growing a failure-lesson library → *Error Library*.
   - Same, for successes worth repeating → *Success Pattern*.
   - Library has recurring near-duplicate lessons → *Memory Compression*.

3. **"Execute this and adapt the plan as we learn / break this big goal down / are we on track / find a
   plan satisfying everything."**
   → **`planning-loops`**. You're adapting or building *one* evolving plan.
   - Standard adapt-as-you-go execution → *Plan→Execute→Replan*.
   - Next step genuinely branches on live state, no fixed step list → *Dynamic Workflow*.
   - Goal too large to plan concretely yet → *Goal Decomposition* (do this first, before executing).
   - Need a periodic objective checkpoint layered on another pattern → *Progress Evaluation*.
   - Multiple constraints must hold simultaneously, fixes trade off against each other →
     *Constraint Satisfaction*.

4. **"Explore N designs / give me options and pick one / debate this / search the possibilities."**
   → **`exploration-loops`**. You're branching into multiple candidates, not refining one.
   - Fixed set of candidates, evaluate once, pick best → *Branch-and-Explore*.
   - Quality only clear after expanding a branch several levels deep → *Tree Search*.
   - Two genuine opposing positions need to stress-test a decision → *Debate*.

5. **"Optimize this prompt / improve this workflow's success rate or latency / tune this pipeline."**
   → **`system-optimization-loops`**. You're tuning a *reusable* artifact against a held-out metric,
     not producing one output.
   - The artifact is a prompt template → *Prompt Optimization* (companion: `prompt-evolve`).
   - The artifact is a multi-step workflow/pipeline → *Workflow Optimization*.

If the task still doesn't fit cleanly, it's probably not loop-shaped (go back to Step 0) or it's a
composite of two categories run in sequence (e.g. Goal Decomposition, then per-subgoal
Plan→Execute→Replan, then a final Quality-loop pass on the deliverable) — say so explicitly rather than
forcing a single pattern.

## Step 2 — Produce the concrete config

Once a pattern is chosen, don't just name it — state the actual `loop_start` call (category skills give
the full rationale; this is the terse version to hand to the caller):

- **Quality**: `exit_mode: "target"`, `direction: "increase"` (or `"decrease"` for Adversarial's
  unrebutted-objection count), a numeric `target_value` threshold, `max_iterations` sized to the retry
  budget you're willing to spend (typically 3–6).
- **Memory**: `exit_mode: "dry"`, `dry_rounds: 2` (searching until nothing new) or `exit_mode: "target"`
  (a known queue length, e.g. Memory Update).
- **Planning**: `exit_mode: "manual"` with `done:true` on ground-truth goal confirmation (most patterns),
  or `exit_mode: "target"` when a completion count/score is known (Constraint Satisfaction, Progress
  Evaluation).
- **Exploration**: `exit_mode: "manual"` almost always — the exit is "we picked one," not a threshold;
  Tree Search may use `target` if a leaf-quality bar is known in advance.
- **System Optimization**: `exit_mode: "target"` with a known achievable bar, or `exit_mode: "dry"` when
  searching for "as good as this gets" with no principled target. Caveat: `dry` mode's convergence check
  only ever tracks "higher progress is better" and ignores `direction` entirely — if you're shrinking a
  metric (latency, cost) and fall back to `dry`, report the *negated* metric (`progress: -latency_ms`),
  not the raw value, or you'll get a false `converged` while real progress is still happening (see
  `system-optimization-loops` for the verified detail).

Always include `max_iterations` (required by `loop_start`) sized to how much budget you're actually
willing to spend before accepting `budget_exhausted` as the answer.

## Rules & Constraints

- ALWAYS run the Step 0 loop-shaped check before routing — not every task should become a loop.
- ALWAYS name both the category *and* the specific pattern — "use quality-loops" alone isn't a
  recommendation, "use quality-loops → Multi-Critic" is.
- ALWAYS hand off to the matching category skill for the full "Wire the brake" rationale — this skill
  gives the terse config, the category skill gives the reasoning and the failure-mode notes.
- NEVER force a task into a category it doesn't fit just to produce an answer — say "this is a composite
  of X then Y" or "this isn't loop-shaped" when that's the truth.

## Examples

**Task:** "Make this draft better."
→ `quality-loops` → Generate→Critique→Rewrite (single rubric implied). `loop_start { exit_mode:
"target", target_value: 8, direction: "increase", max_iterations: 4 }`.

**Task:** "Fix the failing test suite."
→ Loop-shaped check: progress = failing-test count (clear signal), one pass insufficient (that's why
it's still failing), natural stop = 0 failing. → `planning-loops` → Plan→Execute→Replan is the closest
fit if the fix strategy may need to change per failure, but if failing-count is a clean numeric target,
a simpler `target` loop applies directly: `loop_start { exit_mode: "target", target_value: 0,
direction: "decrease", max_iterations: 8 }`, `progress: <# failing tests>`, `state: <failing test names
+ error text>`.

**Task:** "Explore 3 designs for the new caching layer."
→ `exploration-loops` → Branch-and-Explore. `loop_start { exit_mode: "manual", max_iterations: 5 }`,
tick per candidate, `done:true` on the tick that commits to a winner.

**Task:** "Don't let us make the same deployment mistake twice."
→ `memory-loops` → Error Library (backfill) + Reflexion (going forward). Use bantamkit's memory tools
directly rather than a fresh loop-ledger config for the day-to-day recall/reflect; wire a `dry`-mode
loop only for a one-time backfill sweep.

**Task:** "Optimize our classification prompt for accuracy on the held-out set."
→ `system-optimization-loops` → Prompt Optimization. `loop_start { exit_mode: "target", target_value:
0.95, direction: "increase", max_iterations: 6 }` if 0.95 is an achievable, known bar; `exit_mode: "dry",
dry_rounds: 2` if you're just trying to find the ceiling.

## Changelog

- 0.1.2 (2026-10-20) — the Memory category now points at bantamkit's memory tools; `reflexion` was folded
  into bantamkit.
- 0.1.1 (2026-07-02) — fix: added the `dry`-mode direction-blindness caveat (negate the metric when
  shrinking a value under `exit_mode: "dry"`) to the System Optimization config line, matching the
  verified fix in `system-optimization-loops`.
- 0.1.0 (2026-07-02) — initial version; Step 0 loop-shaped gate, a 5-category decision tree with
  pattern-level routing, and a terse `loop_start` config generator per category. Points to each category
  skill for full rationale rather than duplicating it.
