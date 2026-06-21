---
name: plan-decompose-orchestrate
description: "Use this skill whenever you plan before implementing — entering plan-mode, or any 'let me plan first / วางแผนก่อน / อย่าเพิ่งลงมือ' moment for a non-trivial feature or bugfix.
  Triggers include: EnterPlanMode/ExitPlanMode, the user says 'plan first', 'แตก task', 'วางแผน', 'design before coding', a multi-step change that touches more than one file, or any plan that lists steps you're about to execute as one blob.
  Also use when a bug surfaces during execution and you need a deep-down (root-cause, not symptom) debugging pass.
  Do NOT use for a single trivial one-line edit, or a pure question with no implementation."
version: "0.1.0"
updated: "2026-06-21"
---

# Plan → Decompose → Orchestrate (Implement / Test / Review)

## Overview

A plan is not a to-do list you run top-to-bottom in one pass. Every plan item carries **three
obligations**: make it work (implement), prove it works (test), confirm it's right (review). This skill
turns a flat plan into an **orchestrated task graph** — each item exploded into an implement→test→review
triad, parallelised where items are independent — and adds a **deep-down debugging** discipline for when
a test or review fails.

Core principle: **no plan item is "done" until it has been implemented, tested, AND reviewed.** Skipping
test or review is not finishing faster — it's deferring the failure to a worse moment.

## When to Use

- ✅ Entering plan-mode, or about to call ExitPlanMode with a plan.
- ✅ User asks to plan/design first before any code ('วางแผนก่อน', 'plan first', 'อย่าเพิ่งลงมือ').
- ✅ Any change spanning 2+ files or 2+ steps.
- ✅ A bug appears mid-execution → switch to the deep-down debugging pass below.
- ❌ A trivial one-line edit, or a question with no implementation.

## Step 1 — Decompose each plan item into a triad

> **Pre-flight first:** read the real code the plan will touch (actual files, signatures, test setup) before decomposing. Each triad must bind to what exists, not to assumed structure — don't plan against a file you haven't opened. Verify with real data ([[feedback-verify-with-real-data]]).

For **every** item in the plan, write the three tasks explicitly. A plan item without all three is incomplete.

| Task | Question it answers | Output |
|---|---|---|
| **Implement** | How is it built? | The code change, scoped to this item only |
| **Test** | How do we know it works? | A test (or repro) that fails before, passes after |
| **Review** | Is it correct & clean? | Spec-compliance check, then code-quality check |

Rules:
- ☐ Write the **Test** task before the Implement task whenever feasible — test-first (TDD): the test fails first, then code makes it pass. See [[reference-clean-architecture]] for where logic should sit. *(Deeper, optional: if you also run the `superpowers` plugin, `superpowers:test-driven-development`.)*
- ☐ **Review is two passes, not one**: (1) does it do what the plan said? (2) is the code clean/reuse-correct? Don't collapse them.
- ☐ Keep each Implement task **additive** unless deletion is explicitly the goal (see [[feedback-additive-changes]]).

## Step 2 — Orchestrate: decide parallel vs sequential

Map dependencies between items, then choose the execution shape:

| Situation | Shape | How |
|---|---|---|
| Items are independent (no shared state/files) | **Parallel** | One agent/task per item, run concurrently |
| Item B needs item A's output | **Sequential pipeline** | A's implement→test→review, then B |
| Within a single item | **Always sequential** | implement → test → review, in that order |
| Items touch the same files in parallel | **Worktree isolation** | Give each agent its own git worktree (or branch) so concurrent edits don't clobber each other, then merge |

- ☐ State the orchestration shape **in the plan itself** so the user can see what runs concurrently.
- ☐ Independent items → fan out. Don't serialise work that has no dependency just because it's "tidier".
- ☐ Register any item you defer or branch you don't take ([[proactive-task-reminders]]) — orchestration drops things silently otherwise.
- *Deeper, optional: with the `superpowers` plugin, `superpowers:dispatching-parallel-agents` (fan-out) and `superpowers:using-git-worktrees` (isolation) go further.*

## Step 3 — Deep-down debugging (when test or review fails)

When an item's test fails or review finds a defect, **do not patch the symptom.** Go deep-down to root cause. The 7 steps below are self-contained.
*(Deeper, optional: with the `superpowers` plugin, `superpowers:systematic-debugging` is the fuller anchor.)*

1. ☐ **Reproduce** deterministically. No fix without a reliable repro.
2. ☐ **Read the actual error** — full stack/log, not the summary. Verify with real data, not assumption ([[feedback-verify-with-real-data]]).
3. ☐ **Trace to the source** — follow the failing value backward to where it was first wrong, not where it surfaced.
4. ☐ **Form one hypothesis, test it** — change one variable, observe. Don't shotgun multiple fixes at once.
5. ☐ **Confirm the root cause** — explain *why* it broke before fixing. If you can't explain it, you haven't found it.
6. ☐ **Fix at the root**, then **re-run the failing test** — green is the only proof. Watch the output, don't assume.
7. ☐ **Check siblings** — the same root cause often hides in adjacent code (concurrency: [[concurrency-race-conditions]]; time: [[timezone-handling]]).

Deep-down means: surface symptom → layer below → layer below → root. Stop only when the next "why" has no
deeper answer.

## Rules & Constraints

- ALWAYS: explode every plan item into implement + test + review before executing any of it.
- ALWAYS: run review as two passes (spec compliance, then code quality).
- ALWAYS: state the orchestration shape (what's parallel, what's sequential) in the plan.
- ALWAYS: on a failure, root-cause it before fixing; re-run the test to prove the fix.
- NEVER: mark an item done with implement-only (no test, no review).
- NEVER: patch a symptom you can't explain.
- NEVER: parallelise items that share mutable state without worktree isolation.

## Examples

**Scenario:** Plan-mode for "add rate-limit + cache to the API client" (2 items).
→ Item A (rate-limit): test(429 backoff) → implement → review×2. Item B (cache): test(hit/miss) → implement → review×2. A and B touch different modules → **parallel agents**. Orchestration shape stated in plan. ✅

**Scenario:** Mid-execution the cache test fails intermittently.
→ Switch to deep-down: reproduce (it's flaky → suspect concurrency), trace to a shared dict written by two requests, confirm it's a lost-update race ([[concurrency-race-conditions]]), fix at the root with a lock, re-run until consistently green. Don't add a retry to mask it. ✅

**Scenario:** User says "วางแผนก่อนนะ อย่าเพิ่งแก้".
→ Don't jump to code. Produce the decomposed, orchestrated plan (triads + parallel/sequential map) and present it via ExitPlanMode for approval. ✅

## Changelog

- 0.1.0 (2026-06-21) — initial version; plan→triad decomposition (implement/test/review), parallel-vs-sequential orchestration map, and a 7-step deep-down (root-cause) debugging checklist. Core is self-contained; superpowers skills are referenced only as optional deeper reading (graceful degradation if that plugin isn't installed), matching this plugin's self-contained convention. Sibling essentials skills cross-linked via [[…]]. Pressure-tested with subagents (A/B, RED vs GREEN): baseline planned flat with no review/orchestration; with the skill, agents produced full triads + a parallel-worktree orchestration map. Added a pre-flight "read the real code first" note from a gap the test surfaced (agents planned against assumed signatures).
