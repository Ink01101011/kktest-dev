# Workflow & command reference

## CLI (`memctl.py`)

Stdlib-only; run with `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py <cmd>`. Set `MEMCTL_DIR` to
avoid passing `--dir` each time.

| Command | Effect |
|---|---|
| `analyze` | Read-only report: index size vs budget, projected compacted size, no-frontmatter files, archive candidates. |
| `compact` | Regenerate `MEMORY.md` from frontmatter (grouped, bounded, archive pointer) + refresh archive index. |
| `archive` | Move selected memories to `archive/`, regenerate both indexes. Needs a selector; supports `--dry-run`. |
| `lint` | Exit non-zero if `MEMORY.md` exceeds budget. For pre-commit / CI. |

Common flags: `--dir`, `--budget` (24000), `--max-hook` (100), `--older-than` (45).

`archive` selectors: `--auto` (done/stale), `--status-archived` (frontmatter `status: archived`),
`--name <file|name> ...` (explicit). Combine with `--dry-run` to preview.

Typical run:

```bash
export MEMCTL_DIR="$HOME/.claude/projects/<project>/memory"
python3 memctl.py analyze
python3 memctl.py compact
python3 memctl.py archive --auto --dry-run     # review
python3 memctl.py archive --auto               # apply
python3 memctl.py lint
```

## MCP tools

| Tool | Key arguments |
|---|---|
| `memory_analyze` | `dir?`, `budget?`, `older_than?` |
| `memory_compact` | `dir?`, `budget?`, `max_hook?` |
| `memory_archive` | `dir?`, `auto?`, `status_archived?`, `name?[]`, `dry_run?` (default **true**), `older_than?`, `budget?` |
| `memory_lint` | `dir?`, `budget?` |

`dir` defaults to the `MEMCTL_DIR` env set in the plugin's `.mcp.json`. `memory_archive` is dry-run
by default — pass `dry_run=false` to apply.

## Scaling roadmap (apply in order, only as needed)

1. **Compaction** (always): index = projection of frontmatter; bounded hooks.
2. **Lifecycle / archiving** (when done memories accumulate): hot/cold split. This is the real
   anti-bloat mechanism — compaction alone is treating a symptom.
3. **Hierarchical index** (when active memory alone exceeds budget): split `MEMORY.md` into a tiny
   master that points to per-type sub-indexes (`index_projects.md`, …); load the master always plus
   the relevant sub-index. The type grouping `compact` already produces is the stepping stone.
4. **Consolidation pass** (routine): merge duplicates, fix stale facts, prune. Schedule it.
5. **RAG / embeddings** (last resort, >~100 topic files): retrieve top-k by similarity. Adds infra and
   non-deterministic retrieval; until then, naming conventions + grep give deterministic on-demand
   recall and are easier to debug.

## Safety

- `compact`/`archive` only write `MEMORY.md`/`archive/*` and move whole files; topic-file bodies are
  never edited.
- Always dry-run `archive` and show the candidate list before applying — the `auto` heuristic can
  misfire on files that merely mention "done"/"gap".
- Everything is plain files under git: review the diff, revert if needed.
