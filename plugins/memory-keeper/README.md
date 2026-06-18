# memory-keeper

Keep file-based agent memory **lean and durable**. As a memory store grows, its always-loaded index
(`MEMORY.md`) bloats past the context budget and loads truncated — silently degrading recall.
memory-keeper fixes this with three moves: **compact** the index, **archive** done/stale memories to
cold storage, and **lint** the index against a byte budget so bloat can't return.

> Core idea: the index is a **projection of frontmatter**, regenerated — never hand-maintained — so it
> can't drift and its size stays bounded. Active memories stay hot; finished ones move to `archive/`
> (still on disk, grep-able, reachable via a pointer) so nothing is lost.

## Components

| Component | What it is |
|---|---|
| Skill `memory-maintenance` | Teaches Claude when/how to maintain a store; triggers on "compact memory", "MEMORY.md too big", "archive old memories", etc. |
| Slash commands | `/memory-keeper:memory-analyze`, `:memory-compact`, `:memory-archive`, `:memory-lint` |
| MCP server `memory-keeper` | Tools `memory_analyze`, `memory_compact`, `memory_archive`, `memory_lint` (zero-dependency, stdlib stdio server) |
| CLI `scripts/memctl.py` | The shared engine — stdlib only; usable standalone and in pre-commit/CI |
| Automation | `automation/pre-commit` lint hook + `automation/scheduled-task.md` weekly upkeep template |

All four surfaces share one engine (`memctl.py`), so behavior is identical however you invoke it.

## Setup

Requires only `python3` (no pip installs).

Set the target store so you don't repeat it:

```bash
export MEMCTL_DIR="$HOME/.claude/projects/<your-project>/memory"
```

The MCP server reads `MEMCTL_DIR` from your environment (wired in `.mcp.json`). Per-call you can also
pass `dir`. Optional env: `MEMCTL_BUDGET` (used by the pre-commit hook; default 24000).

## Usage

Via slash commands (recommended in Claude):

```
/memory-keeper:memory-analyze      # read-only report
/memory-keeper:memory-compact      # shrink the index
/memory-keeper:memory-archive      # preview (dry-run) → confirm → apply
/memory-keeper:memory-lint         # budget gate
```

Or just talk to the skill: "my memory index is over budget, clean it up."

Or the CLI directly:

```bash
python3 scripts/memctl.py analyze
python3 scripts/memctl.py compact
python3 scripts/memctl.py archive --auto --dry-run    # review
python3 scripts/memctl.py archive --auto              # apply
python3 scripts/memctl.py lint
```

## Options

Common flags / tool args: `--dir`/`dir`, `--budget`/`budget` (default 24000),
`--max-hook`/`max_hook` (default 100), `--older-than`/`older_than` (default 45).
`archive` selectors: `--auto` (done/stale), `--status-archived`, `--name <f> ...`; preview with
`--dry-run` (the MCP tool defaults to dry-run for safety).

## Safety

`compact`/`archive` only write `MEMORY.md` and move whole files — topic-file **bodies are never
edited**. `archive --auto` uses a heuristic; always dry-run and review before applying. Everything is
plain files under git, so changes are diffable and revertible.

See `../../docs/CONCEPTS.md` for the full concept + walkthrough and `../../docs/SPEC.md` for the
formal spec.
