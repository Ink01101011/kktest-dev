---
description: Multi-critic mode — N named critic lenses score in one pass, weakest gates progress
allowed-tools: mcp__plugin_loop-ledger_loop-ledger__loop_start, mcp__plugin_loop-ledger_loop-ledger__loop_tick, mcp__plugin_loop-ledger_loop-ledger__loop_status, mcp__plugin_loop-ledger_loop-ledger__loop_end
argument-hint: <what to critique> [--lenses correctness,style,safety] [--threshold 0.8] [--max-retries 3] [--enforce]
---

Run **multi-critic** mode from the `critique-gate` skill: N independent, named critic lenses (e.g.
correctness, style, safety, domain-fit — override with `--lenses`) each score `$1` (or the draft
already in context) 0–1 in the same pass, with their own issues.

There is no CLI here — you play each lens's role in turn. Follow `skills/critique-gate/SKILL.md`'s
"multi-critic" and "Common shape" sections:

1. `loop_start { goal: "all critic lenses clear threshold", max_iterations: <CRITIQUE_MAX_RETRIES,
   default 3>, exit_mode: "target", target_value: <CRITIQUE_THRESHOLD, default 0.8>,
   direction: "increase", enforce: <CRITIQUE_ENFORCE, default false> }`.
2. Score the draft against every lens; compute `progress = min(all lens scores)` — never the average.
3. `loop_tick { loop_id, state: "<lens: score — issues>, ..." naming every failing lens, progress:
   <min score> }`. Read `state`/`note` back to the user — name which lens is still failing.
4. If `should_continue`, rewrite targeting the failing lens(es) specifically and repeat from step 2.
5. On `target_reached`: all lenses cleared, ship it. On `stalled`: surface which lens is stuck and
   stop — do not keep rewriting blindly. On `budget_exhausted`: report the best draft and which
   lens(es) never cleared.
