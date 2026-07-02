# reflexion

> Self-improving agent memory: recall lessons before a task, reflect a new one after it — built on
> `memory-keeper`'s store, not a new one.

An agent that fails, fixes, and succeeds today makes the same mistake next session — its lessons lived
in context, and context is gone. `reflexion` closes that loop: **recall** matching lessons before
acting, **reflect** a lesson after, and periodically **compress** recurring lessons into one durable
pattern. It adds no new store format — every lesson is a `memory-keeper` topic file (`type: feedback`),
so the index/archive/budget machinery you already have applies unchanged.

Requires the `memory-keeper` plugin installed alongside (its `memctl.py` is the single source of truth
for index/archive/compact — `reflexion` never reimplements the store).

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
`compress` defaults to a dry run — always preview before applying. Everything is plain `memory-keeper`
topic files under git, so every change is diffable and revertible.

See `../../docs/proposals/REFLEXION_SPEC.md` for the formal spec and its place in the
[self-improvement chain](../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md).
