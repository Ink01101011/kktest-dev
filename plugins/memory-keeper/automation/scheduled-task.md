# Weekly memory upkeep — scheduled task template

Keep memory healthy without thinking about it. Two ways to run it on a cadence.

## Option A — Claude scheduled task (Cowork / Claude Code)

Ask Claude: **"every Monday at 9am, run memory upkeep"**, or create a scheduled task with this prompt
(cron `0 9 * * 1`):

> Run memory upkeep on the store at `<MEMORY_DIR>`:
> 1. `memory_archive` with `auto=true`, `dry_run=true` — list candidates.
> 2. If the candidates look correct, re-run with `dry_run=false` to apply.
> 3. `memory_compact`, then `memory_lint`.
> Report the before/after index size, what was archived, and any suspected false positives I should
> review. Do not archive anything that looks still-active without flagging it first.

## Option B — cron / launchd (deterministic, no review)

Use only if you're comfortable auto-applying the heuristic. Reads `MEMCTL_DIR`.

```bash
# crontab -e  → run every Monday 09:00
0 9 * * 1 MEMCTL_DIR="$HOME/.claude/projects/<project>/memory" \
  python3 /path/to/plugins/memory-keeper/scripts/memctl.py archive --auto \
  && MEMCTL_DIR="$HOME/.claude/projects/<project>/memory" \
  python3 /path/to/plugins/memory-keeper/scripts/memctl.py lint
```

> The CLI `archive --auto` (no `--dry-run`) applies immediately. Prefer Option A unless you have
> reviewed the heuristic against your store and trust it unattended.

## Also recommended

Run a **consolidation pass** monthly (merge duplicate topic files, fix stale facts, prune). This is
judgement work — do it interactively with Claude rather than on cron.
