# critique-gate

> A quality brake for agent output — generate, then a distinct critic role scores against a rubric
> and demands rewrites until the score clears a threshold or the retry budget runs out.

The model that generates an output is not the best judge of it — it calls a draft "done" while
paragraph 3 is vague. `critique-gate` separates **generator** from **critic** and won't let a draft
through until the critic says the bar is cleared. It ships **zero new machinery**: no server, no
Stop hook of its own. Every mode is just a documented way of calling the sibling
[`loop-ledger`](../loop-ledger) plugin's existing MCP tools (`loop_start` / `loop_tick` / `loop_status`
/ `loop_end`) with the critic's score as `progress` and the critic's issues as `state`. `loop-ledger`'s
own Stop hook already provides the enforcement (blocks session-end while an `enforce:true` loop is
open, releases on any terminal status) — `critique-gate` reuses it, it does not duplicate it.

Requires the `loop-ledger` plugin installed alongside (its MCP tools are the single enforcement point
in this marketplace — `critique-gate` never reimplements a state machine or a second Stop hook).

For the broader, non-enforced pattern reference covering the same five Quality-loop patterns (and four
other loop categories), see the sibling [`agent-loops`](../agent-loops) plugin's `quality-loops` skill.
`critique-gate` is the opinionated, "just run it" version: fixed defaults, one slash command per mode.

## Components

| Component | What it is |
|---|---|
| Skill `critique-gate` | Teaches the four modes and the exact `loop_start`/`loop_tick` wiring for each; triggers on "critique/review/tighten this before it ships" phrasing |
| Slash commands | `/critique-gate:critique-score`, `:critique-multi`, `:critique-adversarial`, `:critique-ensemble` — thin pointers into the skill, one per mode |
| MCP server | none — reuses `loop-ledger`'s MCP tools directly, install `loop-ledger` alongside |
| CLI | none — the critic *is* the calling model; there is nothing deterministic to shell out to |

## Setup

Install `loop-ledger` in the same session/project — `critique-gate` calls its tools by name and has
no fallback if they aren't present.

```
/plugin marketplace add Ink01101011/kktest-dev
/plugin install critique-gate@kktest-dev
/plugin install loop-ledger@kktest-dev
```

## Conventions

These are documented defaults the skill applies as `loop_start` arguments — there is no running
critique-gate process to read them from an environment variable:

| Name | Default | Used as |
|---|---|---|
| `CRITIQUE_THRESHOLD` | `0.8` | `target_value` |
| `CRITIQUE_MAX_RETRIES` | `3` | `max_iterations` |
| `CRITIQUE_ENSEMBLE_K` | `3` | judges in judge-ensemble mode |
| `CRITIQUE_ENFORCE` | `false` | `enforce` (arms `loop-ledger`'s real Stop hook) |

If the project's `CLAUDE.md` or the user states different values, use those instead.

## Usage

```
/critique-gate:critique-score "the incident postmortem draft"        # one critic, retry to threshold
/critique-gate:critique-multi "this PR" --lenses correctness,style,safety   # N lenses, weakest gates
/critique-gate:critique-adversarial "this design doc"                 # attacker, no unrebutted objection
/critique-gate:critique-ensemble "this policy proposal" --k 3         # K judges, mean gates + variance flagged
```

Each command follows the same shape: `loop_start` with `exit_mode:"target"`, act as the critic(s),
`loop_tick` with the score and issues, rewrite, repeat until `target_reached`, `stalled` (surface and
stop — do not keep rewriting), or `budget_exhausted`.

## Safety

`stalled` means stop, not retry harder — if the critic keeps flagging the same issue after a rewrite,
`loop-ledger`'s own stall detection (identical `state` hash across `patience` ticks) fires and this
skill's rule is to escalate to the user rather than spin. Enforcement (`enforce: true`, which arms
`loop-ledger`'s Stop hook) is opt-in and defaults to off — advisory by default, non-optional only when
explicitly requested.

See `../../docs/proposals/CRITIQUE-GATE_SPEC.md` for the formal spec and its place in the
[self-improvement chain](../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md).
