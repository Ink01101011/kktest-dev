---
description: Adversarial mode — one attacker persona attacks the draft until no objection survives unrebutted
allowed-tools: mcp__loop-ledger__loop_start, mcp__loop-ledger__loop_tick, mcp__loop-ledger__loop_status, mcp__loop-ledger__loop_end
argument-hint: <what to critique> [--max-retries 3] [--enforce]
---

Run **adversarial** mode from the `critique-gate` skill: one attacker persona actively attacks `$1`
(or the draft already in context) — counterexamples, edge cases, exploits — instead of scoring against
a rubric. Use this for security-sensitive text, claims that must survive pushback, or code that must
survive a hostile reviewer.

There is no CLI here — you play the attacker. Follow `skills/critique-gate/SKILL.md`'s "adversarial"
and "Common shape" sections:

1. `loop_start { goal: "no unrebutted objection survives", max_iterations: <CRITIQUE_MAX_RETRIES,
   default 3>, exit_mode: "target", target_value: 1.0, direction: "increase",
   enforce: <CRITIQUE_ENFORCE, default false> }`.
2. Attack the draft; list current objections and which prior ones were resolved vs still open.
3. `progress = 1.0` if zero unrebutted objections remain this round, else `issues_resolved /
   issues_raised`. `loop_tick { loop_id, state: <unrebutted objection list>, progress }`. Read
   `state`/`note` back to the user.
4. If `should_continue`, patch the draft to actually address the open objection(s) and repeat.
5. On `target_reached`: no unrebutted objections, ship it. On `stalled`: the same objection recurred
   after a patch — surface it and stop; that means the patch didn't fix the underlying gap, don't
   reword the same paragraph again. On `budget_exhausted`: report which objection(s) never got
   resolved.
