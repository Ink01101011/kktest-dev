---
description: Report memory index size vs budget and archive candidates
allowed-tools: Bash, Read
argument-hint: [memory-dir]
---

Analyze the file-based memory store (read-only). Prefer the `memory_analyze` MCP tool if available;
otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py analyze ${1:+--dir "$1"}`

Summarize for the user: current index bytes vs budget, projected size after compaction, any files
missing frontmatter, and the list of done/stale archive candidates. Do not change anything.
If `$1` is empty and no `MEMCTL_DIR` is set, ask the user for the memory directory path.
