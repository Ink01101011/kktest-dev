# reflexion — Concepts & Usage

Usage, commands and setup are in the [plugin README](../../plugins/reflexion/README.md). This page
explains the idea. The formal contract is in [SPEC.md](./SPEC.md).

> **Also in bantamkit.** reflexion was folded into [bantamkit](https://github.com/Ink01101011/bantamkit)
> (npm `bantamkit-mcp`) for publishing. There, `memory_recall` with `outcome: error|success` is the
> recall and library step, `memory_save` writes one lesson, and `bantamkit-memory list` / `merge`
> list and merge lessons. This plugin stays in the marketplace and still works.

## The problem

An agent fails, fixes the bug and moves on. Next session it makes the same mistake, because the lesson
lived only in the context window.

## The loop

1. **Recall** before a task: find stored lessons that match the task and put them in context.
2. **Act.**
3. **Reflect** after the task: write one lesson (what happened, why, how to apply it next time).
4. From time to time, **compress** lessons that keep coming back into one higher-level pattern.

## No new store

Every lesson is a normal memory-keeper topic file (`type: feedback`, plus `loop: reflexion|error|success`).
reflexion adds only the retrieve, extract and merge logic. Index, archive and budget work is done by
memory-keeper's `memctl.py`, which reflexion loads at run time. So the memory-keeper plugin must be
installed too, and everything stays plain files under git.

## Libraries

`loop: error` lessons form the error library (what to avoid). `loop: success` lessons form the success
library (what worked). `library --loop error` lists one of them.

## Where it fits

reflexion is the Memory category of [agent-loops](../agent-loops/CONCEPTS.md), in a form you can run.
loop-ledger can bound a recall/act/reflect loop; see the skill's notes.
