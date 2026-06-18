# memory-keeper — Specification

Status: 0.1.0 · Date: 2026-06-18 · Author: Ink

## 1. Problem

File-based agent memory (the convention used by Claude's memory system) stores one fact per Markdown
file with YAML frontmatter, plus an index file `MEMORY.md` that is loaded into the model's context at
the start of **every session**. The index is therefore a *hot path* with a hard byte budget
(commonly ~24 KB).

As a store accumulates facts, the index grows. Two failure modes follow:

1. **Truncated index.** Once the index exceeds the budget it loads incompletely, so the model silently
   stops "remembering" some facts. Recall degrades with no error.
2. **Unbounded growth.** Verbose entries and never-retired memories make the index grow without limit,
   so any one-time cleanup regresses.

A real instance: a project store reached **30,211 bytes / 70 entries** against a 24 KB budget.

## 2. Goals & non-goals

**Goals**
- Bring the index reliably under budget and keep it there.
- Preserve every fact — nothing is deleted by the tool.
- Be deterministic, reviewable (plain files + git), and dependency-free.
- Work as a Claude plugin (skill + slash commands + MCP tools) and as a standalone CLI.

**Non-goals**
- No database, no vector store, no network calls (RAG is a documented future option, not in scope).
- No editing of memory *content* (topic-file bodies) — only the index and file placement.
- No semantic rewriting of facts (that is a separate consolidation activity).

## 3. Principles

1. **Index = projection of frontmatter.** Every `MEMORY.md` line is generated from a topic file's
   `description`. The index is regenerated, never hand-edited, so it cannot drift from the files and
   its size is a pure function of (entry count × hook length).
2. **Separate hot from cold.** Only active memories occupy the always-loaded index. Done/stale
   memories move to `archive/` — still on disk and grep-able, indexed in a cold index, and reachable
   from the hot index via a one-line pointer (lazy load).
3. **Enforce the budget with tooling.** A `lint` command fails when the index exceeds budget, wired
   into pre-commit/CI so regressions are caught mechanically rather than by discipline.
4. **Detail belongs in bodies.** `description` is the index line; keep it short. Everything else lives
   in the topic-file body, loaded only on demand.

## 4. Data model

### 4.1 Topic file

```markdown
---
name: <stable-id>                 # required; index link text
description: <one-line hook>      # required; becomes the index line (~100 chars)
metadata:
  type: user | project | reference | feedback   # groups the index; else "Other"
  status: active | archived       # optional; default active
---
<body — full detail, not in the hot index; link related facts with [[name]]>
```

Files lacking valid frontmatter are reported by `analyze` and indexed with a fallback
(filename + first body line) but should be fixed.

### 4.2 Index `MEMORY.md` (generated)

- Grouped by `type` in order: user → project → reference → feedback → others.
- One line per active memory: `- [name](relpath) — hook`.
- `hook` = `description` collapsed to one line, truncated to `max_hook` chars.
- If the rendered size exceeds `budget`, `max_hook` auto-shrinks in steps of 8 down to a floor of 24.
- If an archive exists, a trailing **"Archived (cold — read on demand)"** section points to
  `archive/MEMORY.archive.md`.

### 4.3 Archive (cold storage)

```
memory/
├── MEMORY.md
├── <active>.md
└── archive/
    ├── MEMORY.archive.md     # generated cold index; not loaded each session
    └── <archived>.md
```

## 5. Operations

| Operation | Reads | Writes | Notes |
|---|---|---|---|
| `analyze` | store | — | Report: current vs projected size, budget bar, no-frontmatter files, archive candidates. |
| `compact` | store | `MEMORY.md`, `archive/MEMORY.archive.md` | Regenerate hot index (bounded) + cold index. |
| `archive` | store | moves files, both indexes | Move selected memories to `archive/`. Dry-run supported. |
| `lint` | `MEMORY.md` | — | Exit non-zero if over budget. |

### 5.1 Archive selection

- `--auto` / `auto`: type `project` whose `description` + first ~400 body chars match
  `done|shipped|completed|complete|closed|archived|deprecated`, **or** file mtime older than
  `older_than` days.
- `--status-archived`: frontmatter `status: archived`.
- `--name <f> …`: explicit by `name` or filename.

The heuristic is intentionally conservative but can misfire (e.g. a file mentioning "gap to close").
Dry-run + human review is the required workflow before applying.

### 5.2 Restore

Move a file out of `archive/` back to the store root, then `compact`. The pointer model means a file
need **not** be restored merely to be referenced — the model can read the cold index on demand.

## 6. Interfaces

### 6.1 CLI (`scripts/memctl.py`, stdlib only)

`python3 memctl.py <analyze|compact|archive|lint> [flags]`
Flags: `--dir` (or `$MEMCTL_DIR`), `--budget` (24000), `--max-hook` (100), `--older-than` (45);
`archive` adds `--auto`, `--status-archived`, `--name`, `--dry-run`. Exit codes: `0` ok, `1`
over-budget/`compact` couldn't fit, `2` bad invocation.

### 6.2 MCP server (`server/memory_keeper_server.py`, stdlib only)

stdio transport, newline-delimited JSON-RPC 2.0. Implements `initialize`, `tools/list`, `tools/call`,
`ping`. Tools: `memory_analyze`, `memory_compact`, `memory_archive` (dry-run by default), `memory_lint`.
Shells out to `memctl.py` (single source of truth). Config via env `MEMCTL_PATH`, `MEMCTL_DIR`.

### 6.3 Skill & commands

Skill `memory-maintenance` (triggers on memory-cleanup phrasing) encodes the workflow. Slash commands
`memory-analyze|compact|archive|lint` wrap the same engine for explicit invocation.

## 7. Roadmap

1. **Compaction** — implemented.
2. **Lifecycle / archiving** — implemented (the real anti-bloat mechanism).
3. **Hierarchical index** — when active memory alone exceeds budget, split into a tiny master that
   points to per-type sub-indexes; load master + relevant sub-index. The current type-grouping is the
   stepping stone.
4. **Consolidation pass** — routine merge of duplicates / stale-fact fixes (judgement work).
5. **RAG / embeddings** — only beyond ~100 topic files; adds infra and non-deterministic retrieval.
   Until then, naming conventions + grep give deterministic on-demand recall.

## 8. Design decisions

- **Generated index over hand-maintained:** eliminates drift; makes size analytic and enforceable.
- **Archive subfolder over deletion:** preserves facts and audit trail; keeps cold data grep-able.
- **Single engine, shelled by the MCP server:** CLI, commands, and tools cannot diverge in behavior.
- **Stdlib only:** zero install friction; runs under whatever `python3` launches the plugin.
- **Dry-run-by-default for the MCP archive tool:** prevents accidental moves from an agent call.

## 9. Verification

Validated on a fixture and on a live 70-entry store: 30,211 → 11,361 bytes after `compact`; →
6,958 bytes / 42 active after `archive --auto` (27 files to cold storage); `lint` green. MCP server
verified for `initialize` / `tools/list` / `tools/call` and dry-run-default archive.
