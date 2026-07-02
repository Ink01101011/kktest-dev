---
description: Write what/why/how as a new lesson after a task
allowed-tools: Bash, Read
argument-hint: [memory-dir]
---

Reflect on the task that just finished and write one lesson. Extract from the transcript:

- **What happened** — the concrete event (a failure, a fix, or a success worth repeating)
- **Why it failed / worked** — the root cause or the reason it worked
- **How to apply next time** — the actionable takeaway

Prefer the `reflexion_reflect` MCP tool if available; otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/reflexionctl.py reflect --what "..." --why "..." --how "..." ${1:+--dir "$1"}`

Pick `--loop error` for a failure, `--loop success` for a pattern worth repeating, or leave the default
(`reflexion`) otherwise. If the tool reports `SKIP` (a similar lesson already exists), show the user the
existing lesson instead of forcing a duplicate — only pass `--force` if they confirm it's genuinely new.
Only write one lesson per task.
