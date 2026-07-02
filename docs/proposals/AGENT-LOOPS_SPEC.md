# agent-loops — Specification

Status: 0.1.0 (proposal) · Date: 2026-07-02 · Author: Ink

> Proposal spec. Ships the existing `loop-ledger` MCP server as a first-class marketplace plugin,
> bundled with a skill catalog that encodes the 20 loop design patterns it is built to run safely.

## 1. Problem

Most agents run a single pass: prompt → response → done. The capable production systems run **loops**
(generate → evaluate → learn → improve) until the output is actually good. Two things are missing for
someone building on Claude Code / Cowork today:

1. **No playbook.** Engineers reinvent loop shapes ad hoc (critique-rewrite, score-retry, reflexion,
   tree search…) with no shared, triggerable reference for *which loop fits which task*.
2. **No brake.** A loop with no ground-truth exit either quits too early (model rationalizes "good
   enough") or spins forever. The repo already solves this with `loop-ledger` — a deterministic
   guardrail (budget + stall-hash + exit predicate + Stop hook) — but it lives outside the marketplace
   and isn't paired with the patterns it enforces.

`agent-loops` closes both gaps in one installable plugin: the **playbook** (skills) plus the **brake**
(MCP + hook).

## 2. Goals & non-goals

**Goals**
- Package `loop-ledger` as a marketplace plugin (MCP server + Stop hook), installable via `/plugin install`.
- Ship a skill catalog encoding all 20 loop design patterns, grouped by the 5 categories, each with a
  "when to use / when not to" and a minimal shape.
- Make the connection explicit: every pattern skill names which `loop-ledger` exit mode it should arm.
- Stay dependency-light and reviewable (plain files + the existing Node MCP server).

**Non-goals**
- Not a new loop *runner* — the loop body still lives in the user's skill/workflow. This plugin
  provides the guardrail and the patterns, not an autonomous executor.
- No rewrite of `loop-ledger`'s state machine (`ledger.js` stays the source of truth).
- No hosted evaluation service, vector store, or network calls.
- Not a replacement for `critique-gate` / `reflexion` / `prompt-evolve` — those are focused
  companions (see [§8](#8-relationship-to-sibling-plugins)).

## 3. Principles

1. **Playbook and brake ship together.** A pattern without a stop condition is a footgun; a brake with
   no patterns is a library nobody knows how to use. Bundle them.
2. **The ledger is the ground truth the model can't argue past.** `should_continue` comes from budget +
   stall-hash + exit predicate only — never from the model's self-assessment.
3. **Skills are references, not runners.** Each pattern skill teaches the shape and hands off execution
   to the user's workflow, arming `loop-ledger` for the stop decision.
4. **Both failure directions are covered.** Can't stop early (Stop hook blocks while the loop is open);
   can't run forever (`max_iterations` closes the loop → hook releases).

## 4. Components

### 4.1 MCP server (`server/`, from loop-ledger)

Node stdio MCP server. Tools (unchanged from `loop-ledger`):

| tool | purpose |
|---|---|
| `loop_start` | begin a loop, returns `loop_id` (requires `max_iterations`; `enforce:true` arms the Stop hook) |
| `loop_tick` | report one iteration → `{ should_continue, status, reason, metrics }` |
| `loop_status` | read counters/history without advancing |
| `loop_end` | close explicitly (releases enforcement) |
| `loop_gc` | delete old loop files (also runs on server start + each `loop_start`) |

`status ∈ continue | done | target_reached | converged | stalled | budget_exhausted`.
`stalled` is a **failure** exit — stop and change approach, do not retry the same action.

### 4.2 Stop hook (`gate.mjs`, from loop-ledger)

Registered as a Claude Code `Stop` hook. While an enforced loop is open, prints
`{"decision":"block","reason":…}` to force another iteration; releases the stop when the ledger closes
the loop. `max_blocks` failsafe (`max_iterations + 3`) prevents wedging.

### 4.3 Skill catalog (`skills/`)

One skill per pattern (or one skill per category, TBD in §7), following the `kkskills-essentials`
skill contract (Overview · When to Use ✅/❌ · Process · Rules · Examples · Changelog). Grouping:

| Category | Patterns | Typical loop-ledger exit mode |
|---|---|---|
| 1 · Quality | Generate→Critique→Rewrite, Score-and-Retry, Multi-Critic, Adversarial Critique, Judge Ensemble | `target` (score ≥ threshold) |
| 2 · Memory | Reflexion, Memory Update, Error Library, Success Pattern, Memory Compression | `dry` (no new lessons) — see `reflexion` |
| 3 · Planning | Plan→Execute→Replan, Dynamic Workflow, Goal Decomposition, Progress Evaluation, Constraint Satisfaction | `target` / `manual` |
| 4 · Exploration | Branch-and-Explore, Tree Search, Debate | `manual` (pick best branch) |
| 5 · System Optimization | Prompt Optimization, Workflow Optimization | `target` (metric held) — see `prompt-evolve` |

Every pattern skill ends with a **"Wire the brake"** section: which `exit_mode`, `target_value`,
`direction`, and `max_iterations` to pass to `loop_start`.

### 4.4 Meta-skill (`loop-selector`)

A router skill that, given a task ("make this draft better", "fix the failing suite", "explore N
designs"), recommends the pattern(s) and the `loop_start` config to use.

## 5. Interfaces

### 5.1 Plugin manifest

Standard `.claude-plugin/plugin.json` declaring the MCP server, the Stop hook, and the skills.
Registered in the marketplace `plugins[]` array (category `productivity`; keywords `loop`, `agent`,
`self-improving`, `mcp`, `guardrail`).

### 5.2 Configuration (env)

Inherited from `loop-ledger`: `LOOP_LEDGER_DIR` (default `~/.loop-ledger`),
`LOOP_LEDGER_TTL_HOURS` (168), `LOOP_LEDGER_MAX_AGE_HOURS` (720).

### 5.3 Usage pattern

```
loop_start { goal, max_iterations, exit_mode, target_value, direction, enforce }  → loop_id
repeat:
  <one iteration of the chosen pattern>
  loop_tick { loop_id, state: "<what should change on progress>", progress: <metric> }
  if !should_continue: break     // target_reached | stalled | budget_exhausted
loop_end { loop_id }
```

## 6. Design decisions

- **Reuse `loop-ledger` verbatim as the engine.** It's tested (smoke + handshake + gate + cleanup) and
  the state machine is pure (`ledger.js`). Vendoring it into the plugin keeps one source of truth.
- **Patterns as skills, not code.** Loop bodies are task-specific; encoding them as triggerable
  references keeps the plugin general and lets the model compose them.
- **Explicit brake wiring per pattern.** The most common loop bug is "no ground-truth exit"; forcing
  each skill to name its exit mode designs the bug out.

## 7. Open questions

1. **One skill per pattern (20) vs one per category (5).** Per-pattern is more triggerable; per-category
   is leaner. Leaning per-category with 20 named sub-sections, mirroring the tweet's structure.
2. **Vendor vs submodule for `loop-ledger`.** Vendor (copy) for zero-friction install; revisit if the
   engine needs to be shared with `reflexion`.
3. **Do we ship `npm install` deps** (`@modelcontextprotocol/sdk`, `zod`) **or bundle?** Prefer a
   `postinstall`-free path if the marketplace can vendor `node_modules`.

## 8. Relationship to sibling plugins

`agent-loops` is the umbrella. Three siblings deepen individual categories and can depend on it:
[`reflexion`](./REFLEXION_SPEC.md) (Category 2, on `memory-keeper`),
[`critique-gate`](./CRITIQUE-GATE_SPEC.md) (Category 1, enforced), and
[`prompt-evolve`](./PROMPT-EVOLVE_SPEC.md) (Category 5). A user can install just `agent-loops` for the
full playbook + brake, or add a sibling for a turnkey implementation of one category.

## 9. Verification

- `npm test` in the vendored server passes (smoke + handshake + gate + cleanup).
- `claude plugin validate ./kktest-dev/plugins/agent-loops` is green.
- Manual: run a `target`-mode loop to completion and a deliberately-stalling loop; confirm
  `target_reached` and `stalled` respectively, and that the Stop hook blocks then releases.

## Provenance

Loop taxonomy adapted from Rahul (@sairahul1), *"20 Loop Design Patterns Every AI Engineer Should
Know"* (x.com/sairahul1/status/2072258045460226373, Jul 1 2026). Guardrail from the repo's existing
`loop-ledger` MCP server.
