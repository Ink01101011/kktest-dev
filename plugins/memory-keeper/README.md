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
| Hooks (auto) | `hooks/` — PostToolUse + SessionEnd auto-run `compact` after memory writes, so the index stays self-healing with zero config |
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

## Automatic mode (zero-config)

Once installed, the plugin's hooks keep the index healthy on their own — no commands, no per-project
setup. After the agent writes or edits a memory file (`PostToolUse`) and again at `SessionEnd`, the
index is regenerated from frontmatter, so it can never drift or bloat. The hook auto-discovers the
store from the written file's path (or `MEMCTL_DIR` / `./memory` / the standard
`~/.claude/projects/<project>/memory`), only ever runs `compact` (safe and idempotent), and never
blocks the agent. Archiving stays manual/reviewed by design. The commands and tools below are for
on-demand use; you rarely need them once the hook is active.

> Hooks run in Claude Code. In environments without hook support, use the slash commands or the weekly
> scheduled task instead.

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

See `../../docs/memory-keeper/CONCEPTS.md` for the full concept + walkthrough and
`../../docs/memory-keeper/SPEC.md` for the formal spec. For how auto-compact behaves across
Claude Code, Cowork, and the Claude Desktop chat tab — and how it differs from Claude Code's own
`/compact` — see `../../docs/memory-keeper/RUNTIMES.md`.
