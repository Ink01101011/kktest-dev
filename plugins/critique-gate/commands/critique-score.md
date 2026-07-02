---
description: Score-retry mode — one critic scores a draft, retry until it clears threshold
allowed-tools: mcp__loop-ledger__loop_start, mcp__loop-ledger__loop_tick, mcp__loop-ledger__loop_status, mcp__loop-ledger__loop_end
argument-hint: <what to critique> [--threshold 0.8] [--max-retries 3] [--enforce]
---

Run **score-retry** mode from the `critique-gate` skill: a single critic scores `$1` (or the draft
already in context) 0–1 against a rubric appropriate to the content, and demands rewrites until the
score clears the threshold or the retry budget is exhausted.

There is no CLI here — you are the critic. Follow `skills/critique-gate/SKILL.md`'s "score-retry" and
"Common shape" sections:

1. `loop_start { goal: "score-retry critique clears threshold", max_iterations: <CRITIQUE_MAX_RETRIES,
   default 3>, exit_mode: "target", target_value: <CRITIQUE_THRESHOLD, default 0.8>,
   direction: "increase", enforce: <CRITIQUE_ENFORCE, default false> }`.
2. Score the draft, list concrete issues.
3. `loop_tick { loop_id, state: <issues>, progress: <score> }`. Read `state`/`note` back to the user.
4. If `should_continue`, rewrite addressing the issues and repeat from step 2.
5. On `target_reached`: ship it. On `stalled`: surface the unresolved issue(s) and stop — do not keep
   rewriting the same way. On `budget_exhausted`: report the best draft plus what's still failing.

Use `--threshold`/`--max-retries`/`--enforce` to override the documented defaults for this run.
