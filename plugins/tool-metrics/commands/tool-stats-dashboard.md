---
description: Build an HTML dashboard of tool/MCP/skill/agent usage and publish it as an Artifact
allowed-tools: Bash, Read, Write, Edit, Skill, Artifact
argument-hint: "[--since 30d] [--project SUBSTR]"
---

Build a usage dashboard. Steps:

1. Collect data. Each panel needs its own fixed grouping, so `$ARGUMENTS` goes
   BEFORE the `--group` flag: argparse takes the last occurrence, which keeps a
   user-supplied `--group` from collapsing every panel into one grouping.
   `--since` / `--project` still pass through as written.

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS --group tool`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS --group server`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS --group day`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS --group skill`
!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.py stats --json $ARGUMENTS --group agent`

2. Load the `dataviz` skill (chart form/colors) and the `artifact-design` skill
   (page design) BEFORE writing any HTML.

3. Write a single self-contained HTML file to the scratchpad directory with the
   JSON data embedded inline (no external requests): summary stat tiles (total
   calls, sessions, distinct tools), a horizontal bar chart of top tools, a bar
   chart per MCP server, a daily timeline, and skills/agents breakdowns. Must
   work in light and dark themes.

4. Publish via the Artifact tool (favicon "📊", title "Tool Usage Dashboard").
   Note in the page footer that data is a static snapshot with its generation
   date, and that re-running /tool-stats-dashboard refreshes it. When
   re-running in a later conversation, update the existing artifact URL
   (Artifact action:"list" to find it) instead of minting a new one.
