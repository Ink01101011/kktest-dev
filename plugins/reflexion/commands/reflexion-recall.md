---
description: Surface lessons matching a task before you start it
allowed-tools: Bash, Read
argument-hint: <task description> [memory-dir]
---

Recall lessons from the error/success library that match the task at hand (read-only). Prefer the
`reflexion_recall` MCP tool if available; otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/reflexionctl.py recall "$1" ${2:+--dir "$2"}`

Inject the returned lessons into context before acting — don't just print them. If `$1` is empty, ask
the user for a short description of the task. If no `MEMCTL_DIR` is set and `$2` is empty, ask for the
memory-keeper store path.
