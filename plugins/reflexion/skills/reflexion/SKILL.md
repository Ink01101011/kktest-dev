---
name: reflexion
description: >
  This skill should be used when starting a task that resembles past work ("recall before acting"),
  when a task just finished — especially a failure that got fixed or a success worth repeating
  ("reflect after acting") — or when the user asks to "check the error library", "what have we
  learned", "compress these lessons", or otherwise wants to use a file-based agent memory store as a
  self-improving loop rather than a one-off note. Builds on the memory-keeper store; does not
  replace it.
metadata:
  version: "0.1.0"
  author: "Ink"
---

# Reflexion

Turn "the agent forgets what it learned" into a durable, grep-able loop. Every lesson is a normal
`memory-keeper` topic file (`metadata.type: feedback`, plus `metadata.loop: reflexion|error|success`) —
this skill only adds the retrieve-before / extract-after workflow on top of the store you already have.

Operate through the `reflexion` tools. Prefer the MCP tools when available (`reflexion_recall`,
`reflexion_reflect`, `reflexion_library`, `reflexion_compress`); otherwise call the CLI at
`${CLAUDE_PLUGIN_ROOT}/scripts/reflexionctl.py` with the Bash tool. Both share one engine, and that
engine delegates all index/archive/compact work to `memory-keeper`'s `memctl.py` — install
`memory-keeper` alongside this plugin.

## Core principle

**Recall before acting; reflect after.** Those are the two touch-points of every task:

1. Before starting work that resembles something done before, pull matching lessons from the error
   and success libraries into context — don't rediscover a mistake you already paid for.
2. After the task, write exactly one lesson: what happened, why it failed or worked, how to apply it
   next time. Success is as valuable as failure — don't only log failures.

## When to act

- **Task start**, when the task resembles prior work (a bug class, a tool, a pattern) → `recall` with
  a short description of the task; inject the results into context before acting.
- **Task end**, especially after a failure that got fixed, or a success worth repeating → `reflect`
  with what/why/how. Skip it for trivial, one-off tasks with nothing generalizable.
- **User asks "what have we learned" / "check the error library"** → `library`, optionally filtered by
  `--loop error` or `--loop success`.
- **Many similar lessons accumulate** (e.g. "failed on X" ×3) → `compress` them into one pattern
  lesson; the originals move to `archive/`, nothing is lost.

## Workflow

1. **Recall.** Run `reflexion_recall` (or `reflexionctl.py recall "<task>"`) before acting. It ranks
   active `feedback` lessons by keyword overlap against the task description; optionally filter with
   `loop: error` or `loop: success`. Read-only — safe to run liberally.
2. **Act.** Do the task, informed by whatever `recall` surfaced.
3. **Reflect.** After the task, run `reflexion_reflect` with `what`/`why`/`how`. It de-dupes against
   existing lessons (by name and by content similarity) and **skips** (exit code 1 from the CLI) rather
   than writing a near-duplicate — show the user the existing lesson instead of forcing `force: true`
   unless they confirm it's genuinely new. Pick `loop: error` for a failure, `loop: success` for a
   pattern worth repeating.
4. **Library (on demand).** `reflexion_library` lists lessons, optionally filtered by loop — use it to
   answer "what have we learned about X" without writing anything.
5. **Compress (periodically, not every task).** `reflexion_compress` merges 2+ named lessons into one
   pattern lesson and archives the originals via `memory-keeper`. Defaults to a **dry run** — preview
   the merge, confirm with the user, then apply with `dry_run: false`.

## Chaining

`reflexion` is the memory node of the
[self-improvement chain](../../../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md): a bounded loop
(`loop-ledger`) recalls before acting, may score the output with `critique-gate`, reflects a lesson
after, and — once lessons recur — the `kkskills-essentials` meta-skill can fold a durable pattern into
a versioned skill edit. `reflexion` only owns the memory step; it does not run the loop or rewrite
skills itself.

## Notes

- Never hardcode paths; use `${CLAUDE_PLUGIN_ROOT}` for plugin files.
- Set the target store once via `MEMCTL_DIR`, or pass `dir` per call.
- `reflexionctl.py` locates `memory-keeper`'s `memctl.py` automatically (env `MEMCTL_PATH`, else a
  sibling install, else a marketplace-wide search) — it never reimplements the store's index/archive
  logic.
- The store is plain files — every lesson written or archived is a normal file write/move, diffable
  under git.
