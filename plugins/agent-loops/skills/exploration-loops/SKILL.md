---
name: exploration-loops
description: "Use this skill whenever the task is to consider multiple genuinely different candidates
  and pick the best one, rather than iteratively improving a single output. Triggers include: 'explore
  N designs', 'give me a few different approaches and pick one', 'search the solution space', 'debate
  both sides of this', 'what are the tradeoffs between these options'. Covers Branch-and-Explore, Tree
  Search, and Debate. Do NOT use for improving one draft in place (see quality-loops) or for refining a
  single plan as you execute it (see planning-loops)."
version: "0.1.0"
updated: "2026-07-02"
---

# Exploration Loops

## Overview

Some problems don't have a single output to iteratively polish — they have a *space* of candidate
solutions, and the job is to explore enough of it to pick well. Exploration loops branch into multiple
candidates, evaluate them, and converge on a choice — rather than refining one candidate in place
(that's `quality-loops`) or adapting one plan as you execute it (that's `planning-loops`). Because the
"success" condition here is usually "we picked one" rather than a numeric score crossing a threshold,
most exploration loops arm `loop-ledger` in `manual` mode: the loop ends when `done:true` is asserted
after a candidate is actually selected, with `max_iterations` as the branching-budget backstop.

## When to Use

- ✅ There are multiple structurally different candidates worth generating and comparing (designs,
  architectures, arguments, next moves in a search).
- ✅ The right answer isn't known well enough to write a single draft and refine it — you need
  divergence before convergence.
- ✅ You want a bounded exploration budget (don't branch forever) with an explicit pick-one endpoint.
- ❌ There's one candidate and the question is "is it good," not "which is best" — that's
  `quality-loops`.
- ❌ You're refining one evolving plan against new execution facts — that's `planning-loops`.

## Patterns

### Branch-and-Explore

Generate several candidate solutions in parallel (or breadth-first), evaluate each on the same
criteria, and pick the strongest — with no deeper recursive search into any one branch. Use it as the
default exploration pattern: a fixed, moderate branching factor evaluated once. Don't use it when a
branch might need to be explored several levels deep before its quality is clear — that's Tree Search
below.

**Shape:** generate K candidates → score each independently on shared criteria → pick the best (or
prune the weak ones and stop).

**Wire the brake:** `loop_start { goal: "select best of K candidates", max_iterations: <K + 2>,
exit_mode: "manual" }`. Tick once per candidate evaluated: `state: <candidate id + its score summary>`,
`progress: <best score seen so far>` (informational — the exit is `manual`, not `target`, because
"best of K" isn't a fixed threshold). Call `loop_tick { done: true }` on the tick where you commit to
the winner. If two candidates keep scoring identically and neither pulls ahead after re-evaluation,
that's `stalled` — the criteria themselves may be underspecified; escalate rather than generating more
near-identical candidates.

### Tree Search

Recursively explore branches to a variable depth, expanding the most promising nodes further and
abandoning weak ones — unlike Branch-and-Explore, quality only becomes clear after expanding a branch
some number of levels. Use it for problems with real sequential structure (a plan/argument/design that
compounds across steps) where a shallow look at a branch is misleading. Don't use it when one level of
comparison is already decisive — that's needless depth for Branch-and-Explore's job.

**Shape:** root state → expand the most promising unexplored node into children → score children →
select the next node to expand (best-first) or prune → repeat until a leaf meets the goal or the search
budget is spent.

**Wire the brake:** if there's a known target quality for a leaf, use `target`: `loop_start { goal:
"find a leaf meeting target quality", max_iterations: <node-expansion budget>, exit_mode: "target",
target_value: <leaf score threshold>, direction: "increase" }`, `progress: <best leaf score found so
far>`. If there's no fixed target and the goal is "search until the budget runs out, then report the
best found," use `exit_mode: "manual"` and let `budget_exhausted` (from `max_iterations`) be the
expected, successful exit — report the best node found at that point. `state: <the frontier of
currently-open nodes>` each tick.

### Debate

Two (or more) positions argue against each other, each side responding to the other's strongest point,
until one side concedes, a synthesis emerges, or neither can advance new arguments. Use it to
stress-test a decision by construction rather than by having one model self-critique (which tends to
be too agreeable) — see `quality-loops`'s Adversarial Critique for the closely related single-artifact
version of this idea. Don't use it when there's no genuine second position — a debate against a straw
man produces false confidence, not insight.

**Shape:** position A states its case → position B rebuts with its strongest counter → A responds →
repeat until a side concedes, a synthesis is reached, or no new arguments surface.

**Wire the brake:** `loop_start { goal: "debate reaches concession or synthesis", max_iterations: 6,
exit_mode: "manual" }`. `state: <the current round's new arguments, summarized>` — identical arguments
recurring (each side just restating itself) is `stalled`: the debate isn't advancing, stop and either
force a synthesis manually or accept "genuinely contested, no resolution" as the answer. Call
`loop_tick { done: true }` only when a side actually concedes or a synthesis is reached — not merely
because `max_iterations` is close.

## Rules & Constraints

- ALWAYS evaluate candidates on the *same* criteria — comparing branches scored on different rubrics
  isn't exploration, it's noise.
- ALWAYS treat `budget_exhausted` as an acceptable exit for Tree Search when there's no fixed target —
  "best found within budget" is a legitimate answer; report it, don't disguise it as failure.
- ALWAYS let `stalled` in Debate mean "stop debating," not "restate the argument more firmly."
- NEVER pick a "winner" in Branch-and-Explore or Tree Search without a `loop_tick { done: true }` that
  records which candidate and why — otherwise the exploration has no auditable endpoint.
- NEVER run Debate against a position nobody actually holds; if there's no real second side, this
  pattern doesn't apply.

## Examples

**Scenario:** "Give me 3 different architectures for this service and recommend one."
→ Branch-and-Explore, `max_iterations: 5` (3 candidates + slack), score each on the same criteria
(complexity, cost, latency), `loop_tick { done: true }` on the tick that commits to the recommendation.

**Scenario:** "Search for the best next move, several moves deep."
→ Tree Search, `exit_mode: manual`, best-first expansion, `budget_exhausted` after the iteration cap is
the expected exit — report the best leaf found, not a failure.

**Scenario:** "Argue both sides of whether we should deprecate this API now."
→ Debate, two positions, each round's new arguments as `state`. Round 4: both sides just restate round
2's points → `stalled` → conclude "genuinely contested; recommend a time-boxed pilot instead of a binary
decision" rather than forcing a fake consensus.

## Changelog

- 0.1.0 (2026-07-02) — initial version; 3 Exploration-category patterns (Branch-and-Explore, Tree
  Search, Debate), each with a real `loop-ledger` `loop_start` wiring.
