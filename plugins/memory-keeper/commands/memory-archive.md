---
description: Move done/stale memories to cold storage (archive/)
allowed-tools: Bash, Read
argument-hint: [memory-dir]
---

Archive done/stale memories. Always preview first — show the user the dry-run list and get
confirmation before applying.

Step 1 — preview (prefer the `memory_archive` MCP tool with `dry_run=true`, else CLI):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py archive ${1:+--dir "$1"} --auto --dry-run`

Show the candidates. Flag any that look like false positives (e.g. a file that mentions "done" or
"gap" but is still active). Only after the user confirms, apply by re-running without `--dry-run`
(or the MCP tool with `dry_run=false`), then run a compact/lint to confirm the index is within budget.
To archive specific files instead, use `--name <file> ...`; for files marked `status: archived`, use
`--status-archived`.
