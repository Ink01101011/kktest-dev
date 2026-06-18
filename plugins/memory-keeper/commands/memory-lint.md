---
description: Fail if the memory index exceeds its byte budget
allowed-tools: Bash, Read
argument-hint: [memory-dir]
---

Lint the memory index against its byte budget. Prefer the `memory_lint` MCP tool if available;
otherwise run the CLI:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/memctl.py lint ${1:+--dir "$1"}`

Report OK (within budget) or FAIL (over budget). On FAIL, recommend `/memory-keeper:memory-compact`
and, if still over, `/memory-keeper:memory-archive`. This is the same gate used by the pre-commit hook.
