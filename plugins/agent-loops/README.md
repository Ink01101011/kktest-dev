# agent-loops

> The playbook for agent loop design patterns — 5 categories, 20 named patterns, each with a "when to
> use / when not" and the exact `loop-ledger` brake to wire. Skills-only; no runner, no server.

Most agents run a single pass: prompt → response → done. The loops that actually improve output
(generate → evaluate → learn → improve) get reinvented ad hoc every time, with no shared reference for
*which loop shape fits which task* and — worse — often **no ground-truth exit**, so they either quit
too early ("good enough", says the model that made it) or spin forever. `agent-loops` fixes the first
problem (no playbook); the sibling plugin [`loop-ledger`](../loop-ledger) fixes the second (no brake).

This plugin ships **only skills** — prose references the model reads and triggers on, not a server or
a hook. It does not implement, vendor, or duplicate any part of `loop-ledger`'s state machine; it names
`loop-ledger`'s real tools (`loop_start` / `loop_tick` / `loop_status` / `loop_end` / `loop_gc`) and the
exact params to pass.

## Install

```
/plugin marketplace add Ink01101011/kktest-dev
/plugin install agent-loops@kktest-dev
/plugin install loop-ledger@kktest-dev
```

`agent-loops` depends on **`loop-ledger`** being installed alongside it — the same relationship
[`reflexion`](../reflexion) has with `memory-keeper`: this plugin is the reference material, `loop-ledger`
is the engine that actually enforces the stop decision. Every skill in this plugin assumes the
`loop_start` / `loop_tick` / `loop_status` / `loop_end` / `loop_gc` MCP tools are available in the
session; without `loop-ledger` installed, treat the "Wire the brake" sections as design intent only —
there is nothing to call.

## Skills

| Skill | Covers |
|---|---|
| `quality-loops` | Generate→Critique→Rewrite, Score-and-Retry, Multi-Critic, Adversarial Critique, Judge Ensemble |
| `memory-loops` | Reflexion, Memory Update, Error Library, Success Pattern, Memory Compression |
| `planning-loops` | Plan→Execute→Replan, Dynamic Workflow, Goal Decomposition, Progress Evaluation, Constraint Satisfaction |
| `exploration-loops` | Branch-and-Explore, Tree Search, Debate |
| `system-optimization-loops` | Prompt Optimization, Workflow Optimization |
| `loop-selector` | Router: given a task description, recommends which category + pattern + concrete `loop_start` config |

One skill per **category** (not per pattern) — see [Design decisions](#design-decisions) below for why.

## Usage

Ask a question like "make this draft better", "fix the failing suite", or "explore 3 designs for X" and
let `loop-selector` trigger — it names the category, the specific pattern, and the `loop_start` call to
make. Or trigger a category skill directly (e.g. "run a score-and-retry loop on this report") if you
already know the shape you want.

The generic usage pattern every pattern skill wires into:

```
loop_start { goal, max_iterations, exit_mode, target_value?, direction?, dry_rounds?, enforce? } → loop_id
repeat:
  <one iteration of the chosen pattern — your work, not this plugin's>
  loop_tick { loop_id, state: "<what should change on progress>", progress: <metric> }
  if !should_continue: break     // target_reached | converged | stalled | budget_exhausted
loop_end { loop_id }             // if not already closed by the last tick
```

`stalled` is a **failure** exit (identical state N times — escalate, don't retry the same action).
`target_reached` and `converged` are **success** exits. `budget_exhausted` is the hard backstop.

## Relationship to sibling plugins

- **Memory category → [`reflexion`](../reflexion).** Reflexion, Error Library, Success Pattern, and
  Memory Compression already ship as a working implementation on top of `memory-keeper`. Read
  `memory-loops`'s SKILL.md for the pattern shapes and the brake to wire; use `reflexion`'s
  `reflexion_recall` / `reflexion_reflect` / `reflexion_library` / `reflexion_compress` tools (or its
  CLI) for the actual memory operations rather than reimplementing them.
- **Quality category → `critique-gate`** (companion plugin, built alongside this one). It turns the
  Quality-loop patterns (Score-and-Retry, Multi-Critic, Adversarial, Judge Ensemble) into an enforced
  Stop-hook gate on a quality threshold, riding on `loop-ledger`'s retry-count backstop the same way
  this plugin's skills describe.
- **System Optimization category → `prompt-evolve`** (see `docs/proposals/PROMPT-EVOLVE_SPEC.md`), a
  turnkey implementation of Prompt Optimization loops.

You can install just `agent-loops` (+ `loop-ledger`) for the full playbook + brake, or add a sibling for
a turnkey implementation of one category.

See `../../docs/proposals/AGENT-LOOPS_SPEC.md` for the formal spec.

## Design decisions

- **Skills-only, no vendored server/hook.** `loop-ledger` already ships as its own marketplace plugin
  (Node, zero-dependency MCP server + Stop hook). This plugin never copies or re-implements
  `ledger.js` / `gate.mjs` — it names `loop-ledger`'s real tools and params. Installing both plugins
  gives you the playbook and the brake without two copies of the state machine to keep in sync.
- **One skill per category (5), not one per pattern (20).** The spec's own open question (§7.1) leaned
  this way: five skills stay triggerable on "make this loop better" / "explore N designs" style intents
  without fragmenting into twenty near-duplicate trigger phrases, while each named pattern still gets
  its own subsection, one-paragraph when-to-use, minimal shape, and "Wire the brake" line inside the
  category skill.
