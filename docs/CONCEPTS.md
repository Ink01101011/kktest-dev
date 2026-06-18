# memory-keeper — Concepts, Usage & Installation

A complete guide: what the problem is, how memory-keeper solves it, how to install it, how to use it,
and every option explained.

---

## 1. The concept

### What is a "memory store"?

Claude's file-based memory is a folder of small Markdown files — **one fact per file** — each with
YAML frontmatter:

```markdown
---
name: project-fill-capture
description: Fill capture + activities reconcile pipeline for the Alpaca adapter.
metadata:
  type: project
  status: active
---
Detailed notes about the reconciler live here in the body.
```

Alongside them is **`MEMORY.md`**, an index that lists every fact in one line each. This index is
loaded into the model's context at the **start of every session** — it's how the agent knows what it
knows.

### Why it bloats

Because the index loads every session, it has a **byte budget** (about 24 KB). Two things push past
it:

- **Verbose entries** — long descriptions repeated in the index.
- **Dead weight** — memories for finished work that never get retired.

When the index crosses the budget it loads **truncated**: the agent silently forgets whatever fell off
the end. No error — recall just quietly gets worse. (A real store hit 30 KB / 70 entries.)

### The fix, in one sentence

> Treat the index as a **generated projection** of the files (so it can't drift and stays small),
> keep only **active** memories in it, move **finished** ones to a cold `archive/` folder that's still
> reachable on demand, and **lint** the budget so bloat can't creep back.

### Three principles

1. **Index = projection of frontmatter.** memory-keeper *regenerates* `MEMORY.md` from each file's
   `description`. You never hand-edit the index, so it can never get out of sync, and its size is just
   `entries × hook length` — predictable and enforceable.
2. **Hot vs cold.** Active memories stay in the hot index. Done/stale ones move to `archive/`. They're
   still on disk, still grep-able, and the hot index keeps a one-line pointer to the cold index — so
   the agent can read them *on demand* without them costing budget every session.
3. **Budget enforced by a tool.** `lint` fails when the index is over budget. Put it in your
   pre-commit hook or a weekly task and the problem can't silently return.

A corollary: **detail goes in the body, not the description.** The `description` *is* the index line —
keep it short (~100 chars); everything else lives in the file body, loaded only when needed.

---

## 2. How it works

memory-keeper gives you four operations, exposed four ways (skill, slash commands, MCP tools, CLI) —
all backed by **one engine** (`memctl.py`), so they behave identically.

| Operation | What it does | Changes on disk |
|---|---|---|
| **analyze** | Read-only report: current index size vs budget, size *after* compaction, files missing frontmatter, and archive candidates | none |
| **compact** | Rebuilds `MEMORY.md` from frontmatter — grouped by type, hooks trimmed to fit budget, with a pointer to the archive | writes `MEMORY.md` (+ refreshes cold index) |
| **archive** | Moves done/stale memories into `archive/` and regenerates both indexes | moves files, rewrites indexes |
| **lint** | Pass/fail check that the index is within budget | none |

What it **never** does: edit the *content* of your memory files. compact/archive only rewrite the
index and move whole files. Everything is plain files under git — fully diffable and revertible.

The end state looks like this:

```
memory/
├── MEMORY.md                 # hot index (small, under budget) + pointer to archive
├── user_*.md  project_*.md   # active memories
└── archive/
    ├── MEMORY.archive.md      # cold index (not loaded each session)
    └── project_*.md           # finished/stale memories
```

---

## 3. Installation

### Prerequisites

Only **`python3`** on your PATH. No pip installs — the CLI and MCP server are stdlib-only.

### Install the plugin (recommended)

In Claude Code or Cowork:

```shell
/plugin marketplace add OWNER/kktest-dev
/plugin install memory-keeper@kktest-dev
```

Replace `OWNER` with the GitHub account hosting the `kktest-dev` repo. CLI equivalent:

```bash
claude plugin marketplace add OWNER/kktest-dev
claude plugin install memory-keeper@kktest-dev
```

### Point it at your memory store

Tell it which store to manage by setting `MEMCTL_DIR` (so you don't pass a path every time):

```bash
export MEMCTL_DIR="$HOME/.claude/projects/<your-project>/memory"
```

The MCP server reads this from your environment. You can also pass `dir` per call / `--dir` on the CLI.

### Use the CLI without installing the plugin

The engine is a single file — clone and run it:

```bash
git clone https://github.com/OWNER/kktest-dev
python3 kktest-dev/plugins/memory-keeper/scripts/memctl.py analyze --dir /path/to/memory
```

### Verify (for plugin authors / local testing)

```bash
claude plugin validate ./kktest-dev                          # marketplace.json
claude plugin validate ./kktest-dev/plugins/memory-keeper    # plugin + skill/command frontmatter
```

---

## 4. Usage walkthrough

The golden path is **analyze → compact → archive (preview → apply) → lint**. Always read-only first,
apply second, verify last.

### Via slash commands

```
/memory-keeper:memory-analyze
/memory-keeper:memory-compact
/memory-keeper:memory-archive      # shows a dry-run, asks you to confirm, then applies
/memory-keeper:memory-lint
```

### Via the skill (natural language)

Just say what you want — the `memory-maintenance` skill triggers on phrases like:

- "my MEMORY.md is over budget, clean it up"
- "archive the finished projects in my memory"
- "compact the memory index"

### Via the CLI

```bash
export MEMCTL_DIR="$HOME/.claude/projects/myproj/memory"

python3 memctl.py analyze                 # see the situation
python3 memctl.py compact                 # shrink the index
python3 memctl.py archive --auto --dry-run   # preview what would move
python3 memctl.py archive --auto             # apply after reviewing
python3 memctl.py lint                     # confirm under budget
```

What `analyze` prints (abridged):

```
index now       : 30,211 bytes  (budget 24,000)  [########################]!
index compacted : 11,361 bytes  → -18,850 bytes vs now
archive candidates (done/stale, --older-than 45d):
    project_sp_bt1                           [project marked done]
    ...
```

### Restoring an archived memory

Archived files are still referenceable via the pointer in `MEMORY.md` — the agent can read the cold
index on demand. Only "rehydrate" one if it should load **every** session again:

```bash
mv archive/project_universe_discovery_gap.md .
python3 memctl.py compact
```

---

## 5. Options reference

CLI flags and their MCP-tool argument equivalents (same engine):

| CLI flag | MCP arg | Default | Meaning |
|---|---|---|---|
| `--dir PATH` | `dir` | `$MEMCTL_DIR` | The memory directory to operate on. Required (flag or env). |
| `--budget N` | `budget` | `24000` | Index byte budget. `lint` fails above it; `compact` shrinks to fit it. |
| `--max-hook N` | `max_hook` | `100` | Max characters of `description` kept per index line. Auto-shrinks further if needed to meet budget. |
| `--older-than DAYS` | `older_than` | `45` | Files older than this (mtime) are flagged stale by `analyze`/`archive --auto`. |
| `--auto` | `auto` | off | (archive) select done/stale candidates by heuristic. |
| `--status-archived` | `status_archived` | off | (archive) select files whose frontmatter has `status: archived`. |
| `--name F ...` | `name` (array) | — | (archive) select explicit files by `name` or filename. |
| `--dry-run` | `dry_run` | CLI: off · **MCP: on** | (archive) preview only; move nothing. The MCP tool defaults to dry-run for safety. |

Environment variables:

| Var | Used by | Meaning |
|---|---|---|
| `MEMCTL_DIR` | CLI, MCP server | Default memory directory. |
| `MEMCTL_PATH` | MCP server | Path to `memctl.py` (set automatically by the plugin's `.mcp.json`). |
| `MEMCTL_BUDGET` | pre-commit hook | Budget used by the hook (default 24000). |

Exit codes (CLI): `0` success · `1` over budget / `compact` couldn't fit within budget · `2` bad
invocation (e.g. `--dir` not a directory).

### How `archive --auto` decides

A memory is a candidate when **either**:
- its `type` is `project` and its description or first ~400 body chars match
  `done|shipped|completed|complete|closed|archived|deprecated`, **or**
- its file mtime is older than `--older-than` days.

This is deliberately simple, so it can over-match (e.g. a file that says "gap to close"). That's why
the recommended flow always previews with `--dry-run` and lets you veto before applying.

---

## 6. Automation (keep it healthy automatically)

### Pre-commit lint

Block commits that push the index over budget. Plain git:

```bash
cp plugins/memory-keeper/automation/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
export MEMCTL_DIR="$HOME/.claude/projects/myproj/memory"   # in your shell profile
```

With husky, add to `.husky/pre-commit`:

```bash
bash "$(dirname "$0")/../plugins/memory-keeper/automation/pre-commit"
```

### Weekly upkeep

Ask Claude: **"every Monday 9am, run memory upkeep"**, or use the template in
`plugins/memory-keeper/automation/scheduled-task.md`. The reviewed flow runs a dry-run archive, asks
you to confirm, then compacts and lints. (A deterministic cron variant is included too — use it only
once you trust the heuristic on your store.)

### Consolidation

Monthly, do an interactive pass to merge duplicate facts and fix stale ones. This is judgement work —
do it with Claude, not on a timer.

---

## 7. Scaling beyond compaction

When even your **active** memory exceeds budget, graduate to a **hierarchical index**: a tiny master
`MEMORY.md` that points to per-type sub-indexes (`index_projects.md`, …); load the master always plus
the relevant sub-index. The type grouping `compact` already produces is the stepping stone.

Only past ~100 topic files should you consider **RAG/embeddings** (retrieve top-k by similarity) — it
adds infrastructure and non-deterministic retrieval. Until then, consistent file naming plus `grep`
gives deterministic, debuggable on-demand recall.

---

## 8. FAQ

**Will a new session still load memory normally?** Yes — same mechanism, same `MEMORY.md` path and
format. The only differences: the index now loads *complete* (it's under budget instead of truncated),
and finished memories don't clutter context unless referenced.

**Do archived memories disappear?** No. They stay on disk in `archive/`, are listed in a cold index,
and are reachable via the pointer in `MEMORY.md`. They're just not auto-loaded each session.

**Does it change my notes?** No. It only regenerates the index and moves whole files. Bodies are
untouched. Review the git diff if you want to confirm.

**Do I need to install anything besides python3?** No. CLI and MCP server are stdlib-only.
