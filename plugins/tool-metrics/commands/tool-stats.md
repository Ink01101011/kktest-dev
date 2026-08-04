---
description: Show tool/MCP/skill/agent usage counts across all Claude Code sessions
allowed-tools: Bash
argument-hint: "[--since 7d] [--project SUBSTR] [--group tool|server|project|day|skill|agent]"
---

Tool usage stats (all sessions on this machine):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats $ARGUMENTS`

Show the table above to the user verbatim in a code block, then add ONE short
paragraph of interpretation: the top 3 entries, and anything notable (e.g. an
MCP server that is connected but never used, or an unusually dominant tool).
Do not re-run the command with different flags unless the user asks.
