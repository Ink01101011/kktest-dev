# reflexion — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see
[CONCEPTS.md](./CONCEPTS.md). The pre-release proposal is
[docs/proposals/REFLEXION_SPEC.md](../proposals/REFLEXION_SPEC.md) (historical).

## 1. Components

| File | Role |
|---|---|
| `skills/reflexion/SKILL.md` | recall-before / reflect-after workflow |
| `commands/reflexion-{recall,reflect,library,compress}.md` | slash commands |
| `server/reflexion_server.py` | stdio MCP server, stdlib only; calls `reflexionctl.py` |
| `scripts/reflexionctl.py` | the engine, stdlib only; loads memory-keeper's `memctl.py` |
| `.mcp.json` | starts the server with `python3`, sets `REFLEXIONCTL_PATH` |

## 2. MCP tools

| Tool | Required | Optional |
|---|---|---|
| `reflexion_recall` | `query` | `dir`, `top_k`, `loop` |
| `reflexion_reflect` | `what`, `why`, `how` | `dir`, `name`, `description`, `loop`, `related`, `force` |
| `reflexion_library` | - | `dir`, `loop` |
| `reflexion_compress` | `names` (2 or more), `pattern`, `how` | `dir`, `name`, `description`, `dry_run` (default **true**), `force` |

## 3. CLI

`python3 scripts/reflexionctl.py [--dir DIR] {recall,reflect,library,compress} ...`

- `recall QUERY [--top-k N] [--loop L]`
- `reflect --what --why --how [--name] [--description] [--loop L] [--related ...] [--force]`
- `library [--loop L]`
- `compress --names A B ... --pattern --how [--name] [--description] [--dry-run] [--force]`

`L` is `reflexion`, `error` or `success`. The CLI's `compress` applies unless `--dry-run` is given; the
MCP tool and `/reflexion:reflexion-compress` preview first.

## 4. Environment

| Variable | Default | Meaning |
|---|---|---|
| `MEMCTL_DIR` | `.` | memory-keeper store directory (default `--dir`) |
| `MEMCTL_PATH` | found automatically | path to `memctl.py`. Unset: a copy bundled next to the script (exported layout), else the sibling `memory-keeper/scripts/memctl.py`, else a search under the marketplace root |
| `REFLEXION_TOP_K` | `5` | lessons `recall` returns |
| `REFLEXIONCTL_PATH` | set by `.mcp.json` | where the server finds the engine |

## 5. Guarantees

- `reflect` checks for a duplicate lesson first and skips with exit 1 unless `--force`.
- `compress` archives the originals (memory-keeper `archive/`); it never deletes them.
- No store format of its own: every file is a valid memory-keeper topic file.

## 6. Other tools

The skill and the MCP server export to other AI tools (`npx kktest-dev`, tier "partly Claude-only":
slash commands stay Claude Code only). The export bundles `memctl.py` next to `reflexionctl.py`.
