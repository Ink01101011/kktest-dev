---
description: Regenerate the memory index from frontmatter (terse, bounded)
allowed-tools: Bash, Read
argument-hint: [memory-dir]
---

Compact the memory index. Prefer the `memory_compact` MCP tool if available; otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py compact ${1:+--dir "$1"}`

This regenerates `MEMORY.md` from each topic file's frontmatter (grouped by type, hooks auto-shrunk to
the budget, with a pointer to the cold archive) and refreshes the archive index. It only writes
`MEMORY.md` — topic-file bodies are never edited. Report the before/after size and whether it is now
within budget. If it reports STILL OVER BUDGET, recommend `/memory-keeper:memory-archive`.
