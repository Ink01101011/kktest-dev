# reflexion — Specification

Status: 0.1.0 (proposal) · Date: 2026-07-02 · Author: Ink

> Proposal spec. Self-improving agent memory (Loop Category 2) built **on top of** `memory-keeper`'s
> file store and driven under `loop-ledger`'s brake. Turns "the model forgets what it learned" into a
> durable, grep-able, budget-bounded loop.

## 1. Problem

An agent that fails, fixes, and succeeds today will make the same mistake next session — its lessons
lived in context, and context is gone. The Memory Loops from the loop patterns catalog (Reflexion,
Error Library, Success Pattern, Memory Compression) fix this, but only if the lessons are stored
somewhere durable and kept small enough to stay loadable. The repo already has that substrate:
`memory-keeper` (one-fact-per-file store + budgeted index + archive). `reflexion` is the loop that
*writes to* and *reads from* that store so the system in month 6 is smarter than in month 1.

## 2. Goals & non-goals

**Goals**
- Implement four Memory Loops as a workflow over an existing `memory-keeper` store:
  Reflexion (#6), Memory Update (#7), Error Library (#8), Success Pattern (#9), Memory Compression (#10).
- Before a task: retrieve relevant lessons (error library + success patterns) into context.
- After a task: extract and persist a lesson as a `memory-keeper` topic file (`type: feedback`).
- Keep the memory index under budget as lessons accumulate (delegate to `memory-keeper` compact/archive).
- Be deterministic and reviewable — lessons are plain Markdown files under git.

**Non-goals**
- No new store format — reuse `memory-keeper`'s topic-file + index model exactly.
- No vector DB / embeddings (retrieval is grep + index for now; RAG is `memory-keeper`'s future item).
- Not the loop runner — `loop-ledger` decides when the reflect loop stops (`dry` mode: no new lessons).
- No automatic skill rewriting — that hand-off goes to the `kkskills-essentials` meta-skill
  (see [§7](#7-chaining)).

## 3. Principles

1. **Lessons are memories, not logs.** Each lesson is one `memory-keeper` topic file with frontmatter,
   so it's indexed, budgeted, archivable, and linkable (`[[name]]`) — not an append-only text blob.
2. **Retrieve before acting; reflect after.** The two touch-points of every task: pull the error
   library first, write the lesson last.
3. **Store wins too, not just failures.** Success Pattern (#9) is the most-skipped loop; give it equal
   weight to the Error Library.
4. **Compression keeps memory usable.** Many "failed on X" lessons collapse into one "Pattern: X → do
   Y first" — this is `memory-keeper`'s archive/compact plus a semantic merge step.

## 4. Data model (reuses memory-keeper)

A lesson topic file:

```markdown
---
name: <stable-id>                         # e.g. lesson-verify-env-before-run
description: <one-line hook for the index>
metadata:
  type: feedback                          # groups under "feedback" in MEMORY.md
  loop: reflexion | error | success       # which memory loop produced it
  status: active | archived
---
**What happened:** …
**Why it failed / worked:** …
**How to apply next time:** …
Related: [[other-lesson]]
```

The `feedback` type and the index/archive machinery are exactly `memory-keeper`'s
(see [memory-keeper SPEC](../memory-keeper/SPEC.md)).

## 5. Operations

| Operation | Reads | Writes | Notes |
|---|---|---|---|
| `recall` | store index + files | — | Before a task: surface `error`/`success` lessons matching the task (grep + type filter), inject into context. |
| `reflect` | task transcript | one topic file | After a task: extract What/Why/How, write a `feedback` lesson. |
| `library` | store | — | Query the Error Library / Success Patterns explicitly. |
| `compress` | store | merged files + both indexes | Collapse N specific lessons into a higher-level pattern; archive the originals via `memory-keeper`. |

`reflect` runs once per task; the *reflexion loop* (fail → reflect → retry) is a `loop-ledger` loop that
ticks on each attempt and exits `dry` when an attempt produces no new lesson.

## 6. Interfaces

### 6.1 Skill (`reflexion`)
Encodes the recall-before / reflect-after workflow; triggers on task start/end and on failure phrasing.

### 6.2 Slash commands
`reflexion-recall`, `reflexion-reflect`, `reflexion-library`, `reflexion-compress` — explicit invocation.

### 6.3 Engine
Shell out to `memory-keeper`'s `memctl.py` for all index/archive/compact operations (single source of
truth). `reflexion` adds only the retrieve/extract/merge logic; it does not reimplement the store.

### 6.4 Config
`MEMCTL_DIR` (the memory store), `REFLEXION_TOP_K` (how many lessons `recall` injects, default 5).

## 7. Chaining

`reflexion` is the memory node of the self-improvement chain
(see [SELF-IMPROVEMENT-CHAIN SPEC](./SELF-IMPROVEMENT-CHAIN_SPEC.md)):

```
loop-ledger (brake)
   └─ reflexion.recall  → context primed with past lessons
   └─ <task runs; may use critique-gate to evaluate>
   └─ reflexion.reflect → new lesson file (memory-keeper)
   └─ memory-keeper.compact/archive → index stays under budget
   └─ kkskills-essentials meta-skill → durable lessons fold into skills (versioned)
```

## 8. Design decisions

- **Build on `memory-keeper`, don't fork it.** Reuse its budgeted index and archive so lessons can't
  bloat the hot context — the exact failure mode `memory-keeper` exists to prevent.
- **`feedback` type for lessons.** Groups them in the index and lets `memory-keeper --auto` archive
  stale ones by the same heuristics.
- **Hand skill-rewriting to the meta-skill.** Memory is durable facts; codifying them into behavior is
  a different concern owned by `kkskills-essentials`.

## 9. Open questions

1. **When does a lesson graduate to a skill edit?** Threshold (e.g. same lesson recalled 3×) vs manual.
2. **Retrieval quality without embeddings.** Is grep + type filter + naming convention enough at
   >100 lessons, or does this force `memory-keeper`'s RAG item sooner?
3. **De-dup on `reflect`.** Detect "we already have this lesson" before writing a near-duplicate.

## 10. Verification

- On a fixture store: `reflect` writes a valid `feedback` file; `memory-keeper lint` stays green after
  N reflections; `compress` merges 3 lessons → 1 and archives originals.
- Reflexion loop under `loop-ledger`: a deliberately-failing task improves across attempts and exits
  `dry` when no new lesson is produced.

## Provenance

Memory Loops (#6–10) from Rahul (@sairahul1), *"20 Loop Design Patterns Every AI Engineer Should
Know"* (x.com/sairahul1/status/2072258045460226373, Jul 1 2026). Store substrate from the repo's
`memory-keeper` plugin.
