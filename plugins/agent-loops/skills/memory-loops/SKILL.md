---
name: memory-loops
description: "Use this skill whenever an agent should learn across tasks instead of re-discovering the
  same mistake or re-deriving the same success every session — recall-before-acting, reflect-after,
  building an error/success library, or compressing recurring lessons into a durable pattern. Triggers
  include: 'remember this for next time', 'why did we hit this again', 'what have we learned about X',
  'compress these lessons', 'don't repeat that mistake'. Covers Reflexion, Memory Update, Error Library,
  Success Pattern, and Memory Compression. Do NOT use for one-off, non-generalizable task state (that's
  just working context, not memory) — and prefer the `reflexion` plugin's actual tools over hand-rolling
  these patterns if it's installed."
version: "0.1.0"
updated: "2026-07-02"
---

# Memory Loops

## Overview

Context resets every session; lessons don't have to. Memory loops turn "the agent forgets what it
learned" into a durable, queryable store: recall matching lessons before acting, write exactly one
lesson after acting, and periodically compress recurring lessons into higher-level patterns so the
store doesn't just grow forever.

**This category already has a working implementation: [`reflexion`](../../../reflexion).** It ships
`reflexion_recall` / `reflexion_reflect` / `reflexion_library` / `reflexion_compress` as MCP tools (or a
CLI) on top of `memory-keeper`'s file-based store. Read this skill for the *pattern shapes* and the
`loop-ledger` brake each one wires to; **use `reflexion`'s tools for the actual read/write/compress
operations** rather than re-implementing a memory store from these subsections. If `reflexion` isn't
installed, these patterns still apply to whatever memory store you do have (a file, a doc, a database) —
the loop shape and the brake wiring below are store-agnostic.

## When to Use

- ✅ A task resembles prior work (same bug class, same tool, same kind of design decision) — recall
  first.
- ✅ A task just ended, especially a failure that got fixed or a success worth repeating — reflect.
- ✅ Similar lessons are piling up (e.g. "failed on X" logged three times) — compress.
- ❌ The task's outcome is genuinely one-off with nothing generalizable — don't force a lesson that
  doesn't exist.
- ❌ You need in-session working memory (current plan state, scratch notes) — that's not a memory *loop*,
  it's just context; see `planning-loops` instead.

## Patterns

### Reflexion

Recall matching lessons before acting; reflect exactly one lesson after acting (what happened, why,
how to apply it next time). Use it as the default per-task memory loop — the two touch-points (before
and after) are cheap and the payoff compounds. Don't use it as a search loop over an *unbounded* result
set expecting `target`-style completion — it's inherently a "look until nothing new turns up" pattern
(dry), not a "reach N score" pattern.

**Shape:** `recall(task description)` → inject matches into context → do the task → `reflect(what, why,
how)`.

**Wire the brake:** for the *recall* half when scanning broadly (e.g. "pull every lesson relevant to
this feature area"), `loop_start { goal: "recall relevant lessons until none new surface", max_iterations:
6, exit_mode: "dry", dry_rounds: 2 }`, `progress: <cumulative distinct lessons found>` each `loop_tick`,
`state: <this round's search query/keyword set>`. Two consecutive rounds with no *new* lessons found ⇒
`converged` — stop searching, you have what's available. **Verified live**: `loop_start` with this exact
config produced `status:"continue"` at iterations 1–3 (progress 2→3→3) then `status:"converged"` at
iteration 4 once progress held at 3 for two rounds — see the dogfood run in the plugin's test evidence.

### Memory Update

Apply a queue of pending updates to the memory store (new facts supersede old ones, stale entries get
marked) until the queue is empty. Use it after a batch of new information arrives that should reconcile
with existing memory. Don't use it for a single ad hoc reflect — that's just Reflexion above.

**Shape:** gather pending updates → apply one → mark applied → repeat until queue empty.

**Wire the brake:** the total update count is known up front, so use `target`: `loop_start { goal:
"apply all pending memory updates", max_iterations: <queue length + 2>, exit_mode: "target",
target_value: <queue length>, direction: "increase" }`, `progress: <updates applied so far>`, `state:
<remaining update IDs>`.

### Error Library

Extract failure lessons into a queryable library (one entry per distinct error/root-cause) as they
occur, deduplicating against existing entries. Use it specifically for the failure half of the ledger —
pair with Success Pattern below for the success half. Don't log every failure verbatim; dedupe by root
cause or the library becomes noise nobody reads.

**Shape:** on failure → check library for a matching root cause → if new, write an entry; if it matches,
bump a recurrence counter instead of duplicating.

**Wire the brake:** when doing a sweep to backfill the library from a batch of past failures, `loop_start
{ goal: "extract distinct error patterns until none new", max_iterations: 8, exit_mode: "dry",
dry_rounds: 2 }`, `progress: <distinct error entries written>`, `state: <the failure currently being
triaged>`.

### Success Pattern

Same shape as Error Library but for successes worth repeating — what worked and why, so it can be
reused deliberately instead of accidentally. Use it when a task went unusually well and the "why" isn't
obvious from the artifact alone. Don't log routine successes with nothing generalizable in them.

**Shape:** on a notable success → check for a matching existing pattern → if new, write it; if it
matches, reinforce the existing entry.

**Wire the brake:** same as Error Library: `loop_start { goal: "extract distinct success patterns until
none new", max_iterations: 8, exit_mode: "dry", dry_rounds: 2 }`, `progress: <distinct patterns
written>`.

### Memory Compression

Merge N recurring, near-duplicate lessons into one higher-level pattern lesson, archiving the originals.
Use it periodically (not every task) once the library shows repetition — three "failed on X" entries
that are really one root cause. Don't compress unrelated lessons just to shrink the count; only merge
what's genuinely the same pattern (`reflexion_compress` defaults to a dry run for exactly this reason —
preview before applying).

**Shape:** identify a cluster of similar lessons → propose one merged pattern lesson → preview (dry run)
→ apply: write the pattern, archive the originals.

**Wire the brake:** compression across the whole library is itself a dry-until-no-more-merges loop:
`loop_start { goal: "compress recurring lessons until no more clusters found", max_iterations: 6,
exit_mode: "dry", dry_rounds: 2 }`, `progress: <cumulative lessons merged>`, `state: <the current
candidate cluster>`. A single compression pass (one cluster) doesn't need the ledger at all — just call
`reflexion_compress` and confirm before applying.

## Rules & Constraints

- ALWAYS recall before acting on a task that resembles prior work; don't skip it because you're
  confident.
- ALWAYS reflect exactly one lesson after a task with something generalizable — not zero (lost lesson),
  not several (fragments the library).
- ALWAYS dedupe before writing (`reflexion_reflect` does this by name/content similarity) — a lesson
  library with duplicates is worse than no library.
- ALWAYS preview (dry run) before a compression merge actually archives originals.
- NEVER treat `stalled` in a memory-search loop as "keep searching the same way" — it means the search
  strategy itself needs to change (different keywords, broaden scope, or accept you've found what's
  findable).
- Prefer `reflexion`'s tools over reimplementing recall/reflect/library/compress from scratch.

## Examples

**Scenario:** Starting a task that resembles a prior Stop-hook bug.
→ Reflexion: `recall("writing a Stop hook")` first, get 2 matching lessons injected into context, do the
task informed by them, `reflect` afterward only if something new was learned this time.

**Scenario:** Backfilling an error library from six months of postmortems.
→ Error Library with a dry-mode sweep: `dry_rounds: 2`, `progress` climbs as distinct root causes are
found, `converged` once two consecutive postmortems add nothing new — remaining postmortems are
duplicates of causes already captured.

**Scenario:** The library has three lessons all saying "forgot to check X before Y" in slightly
different words.
→ Memory Compression: cluster the three, propose one pattern lesson ("always check X before Y, because
Z"), dry-run preview, confirm, apply — three lessons become one, archived not deleted.

## Changelog

- 0.1.0 (2026-07-02) — initial version; 5 Memory-category patterns (Reflexion, Memory Update, Error
  Library, Success Pattern, Memory Compression), each with a real `loop-ledger` `loop_start` wiring.
  Reflexion's dry-mode brake verified live against the real `loop-ledger` MCP server (see plugin test
  evidence: converged at iteration 4 with `dry_rounds: 2`). Points to `reflexion` as the working
  implementation of this whole category rather than duplicating its store logic here.
