# critique-gate — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).
The pre-release proposal is [docs/proposals/CRITIQUE-GATE_SPEC.md](../proposals/CRITIQUE-GATE_SPEC.md)
(historical).

## 1. Components

| File | Role |
|---|---|
| `skills/critique-gate/SKILL.md` | the four modes and their exact `loop_start` / `loop_tick` wiring |
| `commands/critique-{score,multi,adversarial,ensemble}.md` | one slash command per mode, each a pointer into the skill |

No MCP server, no hook, no script. It needs the loop-ledger plugin's tools: `loop_start`, `loop_tick`,
`loop_status`, `loop_end`.

## 2. Defaults

These are conventions the skill passes to `loop_start`. No process reads them from the environment.
Values the user or the project's `CLAUDE.md` gives win.

| Name | Default | Passed as |
|---|---|---|
| `CRITIQUE_THRESHOLD` | `0.8` | `target_value` |
| `CRITIQUE_MAX_RETRIES` | `3` | `max_iterations` |
| `CRITIQUE_ENSEMBLE_K` | `3` | number of judges (judge-ensemble) |
| `CRITIQUE_ENFORCE` | `false` | `enforce` (arms loop-ledger's Stop hook) |

## 3. Wiring per mode

Every mode: `loop_start { exit_mode: "target", direction: "increase", max_iterations, target_value, enforce }`,
then per round `loop_tick { loop_id, progress, state }`.

| Mode | `progress` | `state` | `target_value` |
|---|---|---|---|
| score-retry | the critic's score (0..1) | the critic's issue list | threshold |
| multi-critic | `min()` of the N lens scores | the issues of all lenses | threshold |
| adversarial | `1.0` when no objection is left unrebutted, else resolved / raised for the round | the open objections | `1.0` |
| judge-ensemble | `mean()` of the K scores (the spread is reported, never gated) | the judges' issues | threshold |

## 4. Exits

The loop breaks on `target_reached`, `stalled` (loop-ledger saw the same `state` for `patience` ticks)
or `budget_exhausted`, then `loop_end`. On `stalled` the skill surfaces the open issues to the user and
stops. Every tick reads `state` and `note` back to the user. Enforcement is off unless asked for.

## 5. Other tools

The skill exports to other AI tools (`npx kktest-dev`, tier "partly Claude-only"). Slash commands and
Stop-hook enforcement stay Claude Code only; elsewhere the skill is advisory.
