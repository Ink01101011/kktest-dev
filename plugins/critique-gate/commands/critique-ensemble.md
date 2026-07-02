---
description: Judge-ensemble mode — K independent judges score; mean gates, variance is a mandatory flag
allowed-tools: mcp__loop-ledger__loop_start, mcp__loop-ledger__loop_tick, mcp__loop-ledger__loop_status, mcp__loop-ledger__loop_end
argument-hint: <what to critique> [--k 3] [--threshold 0.8] [--max-retries 3] [--enforce]
---

Run **judge-ensemble** mode from the `critique-gate` skill: K independent judges (default
`CRITIQUE_ENSEMBLE_K = 3`, override with `--k`) each score `$1` (or the draft already in context) 0–1
without seeing each other's scores.

There is no CLI here — you play each judge in turn. Follow `skills/critique-gate/SKILL.md`'s
"judge-ensemble" and "Common shape" sections:

1. `loop_start { goal: "judge ensemble mean clears threshold", max_iterations: <CRITIQUE_MAX_RETRIES,
   default 3>, exit_mode: "target", target_value: <CRITIQUE_THRESHOLD, default 0.8>,
   direction: "increase", enforce: <CRITIQUE_ENFORCE, default false> }`.
2. Score the draft K independent times; compute `progress = mean(K scores)` and the spread
   (max − min, or stdev) across them.
3. `loop_tick { loop_id, state: <per-judge scores/issues>, progress: <mean>, note: <spread + any
   disagreement flag> }`. Read `state`/`note` back to the user **every tick, including on
   `target_reached`** — `loop-ledger`'s `progress` is scalar-only, so variance is never a native exit
   gate here; you must surface it yourself. If spread is high, say so explicitly rather than presenting
   a passing mean as clean consensus.
4. If `should_continue`, rewrite addressing the lowest-scoring judges' issues and repeat.
5. On `target_reached`: mean cleared the bar — report it, and call out variance if it was high. On
   `stalled`: judges kept giving the same split — surface it and stop. On `budget_exhausted`: report
   the best mean and the per-judge spread.
