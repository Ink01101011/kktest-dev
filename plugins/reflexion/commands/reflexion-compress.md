---
description: Merge recurring lessons into one higher-level pattern
allowed-tools: Bash, Read
argument-hint: --names <lesson...> --pattern <text> --how <text> [memory-dir]
---

Collapse several specific lessons (e.g. "failed on X" ×many) into one higher-level pattern lesson.
Always preview first — show the user which lessons would be merged and get confirmation before
applying.

Step 1 — preview (prefer the `reflexion_compress` MCP tool with `dry_run=true`, else CLI):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/reflexionctl.py compress $ARGUMENTS --dry-run`

Show the candidate lessons and the proposed pattern. Only after the user confirms, apply by re-running
without `--dry-run` (or the MCP tool with `dry_run=false`). The originals move to `archive/`; nothing
is deleted.
