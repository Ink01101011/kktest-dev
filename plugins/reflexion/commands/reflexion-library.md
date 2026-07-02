---
description: Browse the error/success library
allowed-tools: Bash, Read
argument-hint: [--loop error|success] [memory-dir]
---

List lessons from the memory-keeper store (read-only). Prefer the `reflexion_library` MCP tool if
available; otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/reflexionctl.py library $ARGUMENTS`

Summarize the lessons grouped by loop (error vs success vs reflexion) rather than dumping the raw list.
