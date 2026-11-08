# reflexion

> Self-improving agent memory: recall lessons before a task, reflect a new one after it — built on
> `memory-keeper`'s store, not a new one.

An agent that fails, fixes, and succeeds today makes the same mistake next session — its lessons lived
in context, and context is gone. `reflexion` closes that loop: **recall** matching lessons before
acting, **reflect** a lesson after, and periodically **compress** recurring lessons into one durable
pattern. It adds no new store format — every lesson is a `memory-keeper` topic file (`type: feedback`),
so the index/archive/budget machinery you already have applies unchanged.

> **Folded into bantamkit.** For publishing, reflexion was folded into
> [bantamkit](https://github.com/Ink01101011/bantamkit) (npm `bantamkit-mcp`): `memory_recall` with
> `outcome: error|success`, `memory_save`, and `bantamkit-memory list` / `merge` cover recall, reflect,
> library and compress. The team pack (`/kk-onboard`) installs bantamkit. This plugin still works.

Requires the `memory-keeper` plugin installed alongside (its `memctl.py` is the single source of truth
for index/archive/compact — `reflexion` never reimplements the store).

## Install

Inside Claude Code (2.1.275+):

```
/plugin install reflexion --marketplace Ink01101011/kktest-dev
```

or from a shell:

```sh
claude plugin marketplace add Ink01101011/kktest-dev
claude plugin install reflexion@kktest-dev
```

Install `memory-keeper` the same way: reflexion needs it.

## Components

| Component | What it is |
|---|---|
| Skill `reflexion` | Teaches Claude the recall-before / reflect-after workflow; triggers on task start/end and on failure phrasing |
| Slash commands | `/reflexion:reflexion-recall`, `:reflexion-reflect`, `:reflexion-library`, `:reflexion-compress` |
| MCP server `reflexion` | Tools `reflexion_recall`, `reflexion_reflect`, `reflexion_library`, `reflexion_compress` (zero-dependency, stdlib stdio server) |
| CLI `scripts/reflexionctl.py` | The shared engine — stdlib only; dynamically loads `memory-keeper`'s `memctl.py` for all index/archive/compact work |

## Setup

Requires only `python3` (no pip installs) and the `memory-keeper` plugin installed in the same
marketplace/session.

```bash
export MEMCTL_DIR="$HOME/.claude/projects/<your-project>/memory"
```

`reflexionctl.py` locates `memory-keeper`'s `memctl.py` automatically: `$MEMCTL_PATH` if set, else a
sibling `memory-keeper/scripts/memctl.py` next to this plugin, else a search under the marketplace
root. Set `MEMCTL_PATH` explicitly if neither is found. Optional: `REFLEXION_TOP_K` (default 5, how
many lessons `recall` returns).

## Usage

Via slash commands:

```
/reflexion:reflexion-recall "writing a Stop hook"     # pull matching lessons into context
/reflexion:reflexion-reflect                          # write what/why/how as a new lesson
/reflexion:reflexion-library --loop error             # browse the error library
/reflexion:reflexion-compress                         # merge recurring lessons into a pattern
```

Or the CLI directly:

```bash
python3 scripts/reflexionctl.py recall "writing a Stop hook" --top-k 5
python3 scripts/reflexionctl.py reflect --what "..." --why "..." --how "..."
python3 scripts/reflexionctl.py library --loop success
python3 scripts/reflexionctl.py compress --names lesson-a lesson-b --pattern "..." --how "..."
```

## Safety

`reflect` de-dupes against existing lessons before writing (skips with exit code 1 unless `--force`).
`compress` previews by default in the MCP tool (`dry_run` defaults to true) and in
`/reflexion:reflexion-compress`; the CLI applies unless you pass `--dry-run`, so preview first. Everything is plain `memory-keeper`
topic files under git, so every change is diffable and revertible.

Docs: [concepts](../../docs/reflexion/CONCEPTS.md), [specification](../../docs/reflexion/SPEC.md). The
pre-release proposal ([REFLEXION_SPEC.md](../../docs/proposals/REFLEXION_SPEC.md)) and the
[self-improvement chain](../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md) note are historical.
