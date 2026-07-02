---
name: planning-loops
description: "Use this skill whenever a task needs a plan that adapts as execution reveals new
  information — not a fixed to-do list run top-to-bottom. Triggers include: 'plan and execute this',
  'the plan needs to change now that we know X', 'break this goal into subgoals', 'check if we're on
  track', 'find a plan that satisfies all these constraints'. Covers Plan→Execute→Replan, Dynamic
  Workflow, Goal Decomposition, Progress Evaluation, and Constraint Satisfaction. Do NOT use for a
  simple linear plan with no expected surprises — plain execution is fine there — or for picking among
  multiple candidate plans (see exploration-loops)."
version: "0.1.1"
updated: "2026-07-02"
---

# Planning Loops

## Overview

A plan made before execution starts is a hypothesis, not a guarantee — execution surfaces facts the
plan didn't anticipate (a dependency doesn't exist, a step is harder than expected, a constraint was
missed). Planning loops make replanning a normal part of the cycle instead of a failure: execute a
step, evaluate what changed, replan if needed, repeat until the goal is actually met — with
`loop-ledger` as the objective judge of "is this working or are we spinning."

## When to Use

- ✅ The plan is likely to need revision mid-execution (unknowns, external dependencies, exploratory
  work).
- ✅ A large goal needs to be broken into executable subgoals before work can start.
- ✅ You need an objective checkpoint ("are we actually making progress toward the goal") separate from
  "did the last step succeed."
- ✅ Multiple constraints must all hold simultaneously and satisfying one can break another.
- ❌ The plan is simple, linear, and unlikely to need revision — just execute it; a loop adds ceremony
  with no payoff.
- ❌ You're choosing between fundamentally different *plans*, not refining one — see `exploration-loops`
  (Debate, Tree Search).

## Patterns

### Plan → Execute → Replan

Execute the next step of the current plan, observe the result, and either continue the plan or revise
it based on what execution revealed. Use it as the default planning loop whenever new information from
execution could invalidate later steps. Don't use it when the plan is fully determined in advance and
execution can't teach you anything new about it.

**Shape:** plan → execute next step → observe result → if result invalidates a later step, replan
(revise remaining steps) → repeat until goal met or plan exhausted.

**Wire the brake:** `loop_start { goal: "<the end goal>", max_iterations: <plan step budget, e.g. 10>,
exit_mode: "manual" }`. Report `done: true` only when ground truth confirms the goal (not "the plan
finished" — the plan finishing and the goal being met are different claims). `state: <remaining plan
steps, serialized>` — if replanning produces the *same* remaining steps twice in a row (a false
replan that changes nothing), that's `stalled`: stop iterating on the plan and escalate.

### Dynamic Workflow

The sequence and choice of steps themselves are decided per-iteration based on current state, rather
than following a plan drafted up front — closer to a state machine than a checklist. Use it when the
right next step genuinely depends on what the previous step returned (branching logic), not just
whether it succeeded. Don't use it when a static ordered plan already covers the branches adequately —
Plan→Execute→Replan is simpler.

**Shape:** observe current state → decide the next step dynamically (no fixed plan document) → execute →
observe → repeat until goal state reached.

**Wire the brake:** if the total step count toward the goal is knowable in advance, use `target`:
`loop_start { goal: "<goal state>", max_iterations: <cap>, exit_mode: "target", target_value: <total
steps or checkpoints>, direction: "increase" }`, `progress: <steps completed toward goal>`. If it's not
knowable in advance, fall back to `exit_mode: "manual"` with `done:true` on ground-truth goal
confirmation, same as Plan→Execute→Replan.

### Goal Decomposition

Recursively break a large goal into smaller subgoals until each is directly executable, before any
execution happens. Use it as the first pass on a goal too large to plan concretely in one step — the
loop is over *decomposition*, not execution. Don't use it once subgoals are already small enough to
execute directly — decomposing further is busywork.

**Shape:** goal → propose subgoals → for each subgoal too large to execute directly, decompose again →
repeat until every leaf subgoal is directly executable.

**Wire the brake:** decomposition converges when a decomposition pass finds nothing left to split —
that's a dry pattern: `loop_start { goal: "decompose until every subgoal is directly executable",
max_iterations: 6, exit_mode: "dry", dry_rounds: 2 }`, `progress: <cumulative leaf (executable) subgoals
identified>`, `state: <current non-leaf subgoal being split>`.

### Progress Evaluation

A separate checkpoint step that measures actual progress toward the goal (not "did the last action
succeed" but "are we closer to done"), independent of the execution/replanning cycle. Use it as a
periodic sanity check layered on top of any of the other planning patterns, especially for long-running
plans where local success can mask global drift. Don't use it as a standalone loop with nothing driving
execution — it's an evaluator, not an executor; pair it with Plan→Execute→Replan or Dynamic Workflow.

**Shape:** execute some steps (via another pattern) → periodically evaluate: score current state against
the goal → if the score isn't improving, trigger a replan rather than more of the same steps.

**Wire the brake:** `loop_start { goal: "progress metric reaches goal threshold", max_iterations: <cap>,
exit_mode: "target", target_value: <goal-completion score>, direction: "increase" }`, `progress: <goal-
completion score at each checkpoint>`, `state: <what the checkpoint measured, e.g. the metric
breakdown>`. If progress stalls (`stalled` status), that's the trigger to hand control back to a
Plan→Execute→Replan cycle with a revised plan, not to keep executing the same steps.

### Constraint Satisfaction

Iterate until all constraints hold simultaneously, where satisfying one constraint can violate another
(scheduling, resource allocation, competing requirements). Use it when the goal is "find a state where
every constraint holds" rather than "maximize one metric." Don't use it for a single constraint with no
interaction — that's just Score-and-Retry from `quality-loops` or a plain `target` loop.

**Shape:** candidate solution → check all constraints → for each violated constraint, adjust the
solution (may re-violate a previously-satisfied constraint) → recheck all → repeat until all hold.

**Wire the brake:** `loop_start { goal: "all constraints satisfied", max_iterations: <cap, e.g. 8>,
exit_mode: "target", target_value: <total constraint count>, direction: "increase" }`, `progress:
<count of currently-satisfied constraints>` (can go up *and* down between ticks as fixes trade off —
that's expected and fine here: `target` mode's exit check is a direct, stateless comparison of the
*current* tick's `progress` against `target_value` — `targetReached()` in `ledger.js` doesn't consult
`best_progress` or `dry_count` at all, and this pattern doesn't use `exit_mode: "dry"`, so those
counters play no role in the exit decision either way. A dip on one tick simply means that tick doesn't
cross the target, so the loop continues; it costs nothing beyond an iteration). `state: <which
constraints are currently violated>` — the same violated set recurring ⇒ `stalled`: the constraints may
be genuinely unsatisfiable together, escalate rather than keep trading them off.

## Rules & Constraints

- ALWAYS distinguish "the plan finished" from "the goal is met" — only report `done:true` on the latter.
- ALWAYS replan (don't just retry) when execution reveals the current plan can't reach the goal as
  written.
- ALWAYS use Goal Decomposition *before* execution starts on an oversized goal, not interleaved with it.
- NEVER treat a dip in Constraint Satisfaction's satisfied-count as failure by itself — trade-offs are
  normal; only `stalled` (same violated set repeating) means something's actually wrong.
- Pair Progress Evaluation with an executor pattern; it never runs alone.

## Examples

**Scenario:** "Migrate this service to the new API, adapting as we discover breaking changes."
→ Plan→Execute→Replan, `exit_mode: manual`, execute the next migration step, observe test results,
replan remaining steps when a breaking change is found. `done:true` only when the full test suite is
green on the new API, not when the plan's steps are exhausted.

**Scenario:** "Ship a v1 of a whole new subsystem" (goal too large to plan concretely).
→ Goal Decomposition first: dry-mode loop splitting the goal into subgoals until every leaf is a single
PR-sized task, `converged` when a decomposition pass adds no new leaves. Then execute each leaf via
Plan→Execute→Replan.

**Scenario:** "Schedule these five jobs onto three machines respecting memory and deadline constraints."
→ Constraint Satisfaction, `target_value: 5` (all five constraints/jobs placed validly), `progress`
oscillates as reassignments trade off memory vs. deadline; `stalled` on the same infeasible-conflict pair
recurring ⇒ escalate ("no valid schedule exists under current constraints"), don't keep reshuffling.

## Changelog

- 0.1.1 (2026-07-02) — fix: corrected Constraint Satisfaction's "Wire the brake" explanation for why
  progress dips are tolerated. It previously credited `best_progress`/dry tracking; verified in
  `ledger.js` that this pattern's `exit_mode: "target"` never consults `best_progress` or `dry_count` —
  the exit check is a stateless per-tick comparison of `progress` against `target_value`. Dips are
  tolerated simply because a non-crossing tick just continues the loop, not because of dry/best-progress
  bookkeeping. The practical guidance (dips are fine, only `stalled` matters) is unchanged.
- 0.1.0 (2026-07-02) — initial version; 5 Planning-category patterns (Plan→Execute→Replan, Dynamic
  Workflow, Goal Decomposition, Progress Evaluation, Constraint Satisfaction), each with a real
  `loop-ledger` `loop_start` wiring.
