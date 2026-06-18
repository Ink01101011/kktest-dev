---
name: memory-maintenance
description: >
  This skill should be used when the user asks to "clean up memory", "compact the memory index",
  "my MEMORY.md is too big / over budget", "archive old memories", "memory is bloating", "lint the
  memory index", or otherwise wants to maintain a file-based agent memory store (a MEMORY.md index
  plus per-fact Markdown topic files with frontmatter). Covers compaction, lifecycle/archiving, and
  budget linting via the memory-keeper CLI and MCP tools.
metadata:
  version: "0.1.0"
  author: "Ink"
---

# Memory Maintenance

Keep a file-based memory store lean and durable. A store is a directory of one-fact-per-file
Markdown topic files (YAML frontmatter: `name`, `description`, `metadata.type`, optional
`metadata.status`) plus `MEMORY.md` — a generated index loaded into context every session.

Operate on it through the `memory-keeper` tools. Prefer the MCP tools when available
(`memory_analyze`, `memory_compact`, `memory_archive`, `memory_lint`); otherwise call the CLI at
`${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py` with the Bash tool. Both share one engine.

## Core principle

The index is a **projection of frontmatter, never hand-maintained**. Each `MEMORY.md` line is
generated from a topic file's `description`. This guarantees the index cannot drift from the files
and its size stays bounded. Two further rules:

1. **Separate hot from cold.** Only active memories live in the always-loaded index. Done/stale
   memories move to `archive/` — still on disk and grep-able, but not loaded every session. A short
   pointer in `MEMORY.md` lets them be read on demand (lazy load), so nothing is lost.
2. **Enforce the budget with tooling, not discipline.** `lint` fails when the index exceeds its byte
   budget (default 24000). Wire it into pre-commit/CI so bloat cannot return.

Detail lives in topic-file **bodies**; keep `description` short (≈100 chars) because it *is* the
index line.

## When to act

- The user says memory is too big / over budget / bloated, or recall seems to miss things → the index
  likely exceeds budget and loads truncated. Run `analyze`, then `compact`.
- Many finished projects accumulate → run `archive` to move them to cold storage.
- Setting up durable hygiene → install the pre-commit lint hook and offer a weekly scheduled task.

## Workflow

Always start read-only, then apply, then verify.

1. **Analyze.** Run `memory_analyze` (or `memctl analyze`). Report current index bytes vs budget, the
   projected compacted size, files missing frontmatter, and archive candidates.
2. **Compact.** Run `memory_compact`. This regenerates `MEMORY.md` (grouped by type, hooks
   auto-shrunk to fit budget) and refreshes the archive index. It only writes `MEMORY.md` — it never
   edits topic-file bodies.
3. **Archive (lifecycle).** `memory_archive` defaults to a **dry run** — always preview first and show
   the user the list. Selection modes: `auto` (done/stale heuristic: type `project` whose
   description/body matches done|shipped|completed|closed, or files older than `older_than` days),
   `status_archived` (frontmatter `status: archived`), or explicit `name`. Apply with `dry_run=false`
   only after the user confirms.
4. **Verify.** Run `memory_lint`. Confirm the index is within budget. Mention final size and counts.

The `auto` heuristic can produce false positives (e.g. a file named `*_gap` that says "gap to
close"). Surface the candidate list and let the user veto before applying. To restore an archived
file: move it out of `archive/` back to the memory dir, then `compact`.

## Restoring / referencing archived memories

Archived memories stay referenceable without being pulled back. `compact` writes a pointer in
`MEMORY.md` to `archive/MEMORY.archive.md`; when the active set does not answer a question, read that
archive index and open the specific archived topic file. Only move a file back to active (then
`compact`) if it should load every session again.

## Durable hygiene (offer proactively)

- **Pre-commit lint:** add `automation/pre-commit` (see `${CLAUDE_PLUGIN_ROOT}/automation/`) so a
  commit fails if the index is over budget.
- **Weekly upkeep:** offer to create a scheduled task that runs `archive --auto` then `compact` then
  `lint`. Template in `${CLAUDE_PLUGIN_ROOT}/automation/scheduled-task.md`.
- **Consolidation:** periodically merge duplicate topic files and fix stale facts (pairs well with a
  dedicated consolidate-memory pass).

## References

- `references/format-spec.md` — exact topic-file frontmatter, index format, archive layout, budgets.
- `references/workflow.md` — command/flag reference, MCP tool parameters, scaling roadmap
  (hierarchical sub-indexes, RAG) and when each applies.

## Notes

- Never hardcode paths; use `${CLAUDE_PLUGIN_ROOT}` for plugin files.
- Set the target store once via the `MEMCTL_DIR` env var, or pass `dir` per call.
- The store is plain files — every change is a normal file move/write and is git-diffable.
