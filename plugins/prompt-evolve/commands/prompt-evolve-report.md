---
description: Render report.md — score curve, best version, and failure summary
allowed-tools: Bash, Read
argument-hint: [prompt-evolve-dir]
---

Render `report.md` from `testset.jsonl` and `generations/scores.jsonl` (read-only aside from writing
the report file):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/pevolve.py report ${1:+--dir "$1"}`

Summarize for the user: the score curve (version → avg_score), which version is best (highlighted, not
necessarily the last one), and which case ids fail most often — those are exactly the cases worth
handing to `reflexion` as a durable lesson, or feeding back into the next evolve round. If
`generations/scores.jsonl` doesn't exist yet, tell the user to run `/prompt-evolve:prompt-evolve-run`
first (or `pevolve.py score` for the interactive path).
