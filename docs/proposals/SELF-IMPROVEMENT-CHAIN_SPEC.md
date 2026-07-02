# self-improvement-chain — Specification

Status: 0.1.0 (proposal) · Date: 2026-07-02 · Author: Ink

> Proposal spec. Not a new plugin — an **orchestration** that chains the marketplace's existing pieces
> (`loop-ledger`, `memory-keeper`, `kkskills-essentials`, plus the proposed `reflexion`,
> `critique-gate`, `prompt-evolve`) into a single system that gets better after every task. This is the
> answer to "can we chain what's in the marketplace for self-improve / evolution?" — yes, and the
> parts already fit.

## 1. The insight

Every loop pattern shares one shape: **Act → Observe → Evaluate → Adjust**. The marketplace already has
a component for each stage; nobody had wired them into one circuit:

| Stage | Owned by | Role |
|---|---|---|
| **Brake** (bounds the whole thing) | `loop-ledger` | budget + stall-hash + exit predicate; Stop-hook enforcement |
| **Prime** (recall) | `reflexion` → `memory-keeper` | inject past lessons before acting |
| **Act** | user skill / `kkskills-essentials` plan-decompose-orchestrate | do one iteration of work |
| **Evaluate** | `critique-gate` | score the output against a rubric |
| **Learn** | `reflexion` → `memory-keeper` | write the lesson as a durable, budgeted memory |
| **Fold in** (evolve behavior) | `kkskills-essentials` meta-skill | promote recurring lessons into versioned skill edits |
| **Evolve the tools** (outer loop) | `prompt-evolve` | improve the prompts the loop itself uses |
| **Keep it lean** | `memory-keeper` compact/archive | stop the lesson store from bloating the hot context |

Two nested loops fall out of this: an **inner task loop** (improve one output now) and an **outer
evolution loop** (improve the system across tasks/weeks).

## 2. Goals & non-goals

**Goals**
- Define the contract that lets these plugins compose without new glue code where possible.
- Show the data hand-offs (what each stage passes to the next) explicitly.
- Keep every stage optional — a user can run just the brake + memory, or the full circuit.
- Preserve the repo's ethos: plain files + git + deterministic, no hosted services.

**Non-goals**
- No monolithic "auto-pilot" that runs unattended forever — the brake and human review points are
  first-class, not bypassed.
- No shared runtime/daemon — composition is by convention (files, env vars, MCP tools, hooks), not a
  new server.
- Doesn't replace the individual specs — this is the wiring diagram; the nodes are specified separately.

## 3. The inner loop (improve one task)

```
loop_start { goal, max_iterations, exit_mode:"target", target_value:T, enforce:true }   // loop-ledger
   │
   ├─ reflexion.recall           → pull matching error-library + success lessons into context
   ├─ <act: run the task>        → produce draft/output/change
   ├─ critique-gate.score        → {score, issues[]}
   ├─ loop_tick { state:issues, progress:score }   // ledger decides continue/stall/target
   │       └─ if score < T and not stalled → rewrite from issues, loop
   ├─ reflexion.reflect          → write one lesson (memory-keeper feedback file) if something was learned
   └─ loop_end
memory-keeper.compact/lint       → keep MEMORY.md under budget
```

Hand-offs: `critique-gate.issues` → both the ledger's `state` (stall detection) **and** `reflexion`'s
lesson body. The ledger's `progress` is `critique-gate`'s `score`. Nothing is invented; each output is
another node's declared input.

## 4. The outer loop (evolve the system)

Runs across many tasks, not every tick:

```
Over N tasks, memory-keeper accumulates lessons (feedback files).
   │
   ├─ reflexion.compress                → collapse "failed on X" ×many → "Pattern: X → do Y first"
   ├─ kkskills-essentials meta-skill    → recurring pattern graduates into a versioned skill edit
   │                                       (SemVer bump + changelog; the behavior is now default)
   ├─ prompt-evolve                      → the prompts used by act/critique steps are optimized
   │                                       against a test set (the loop improves the loop)
   └─ memory-keeper.archive             → graduated / stale lessons move to cold storage
```

This is the "system in month 6 ≠ system in month 1" property: lessons become memories, recurring
memories become skills, and the prompts driving it all get tuned — automatically, under the brake,
with git as the audit trail.

## 5. Composition contract

For the chain to work without bespoke glue, each node honors:

1. **File-based state.** Lessons, prompt generations, and loop state are plain files under known dirs
   (`MEMCTL_DIR`, `PEVOLVE_DIR`, `LOOP_LEDGER_DIR`) — so stages read each other's outputs and everything
   survives context loss.
2. **One scorer.** `critique-gate`'s rubric score is the single definition of "good", reused by
   `prompt-evolve`. No competing quality metrics.
3. **The ledger is the only authority on "continue".** Every acting node ticks `loop-ledger` and obeys
   `should_continue`; none decides on its own to keep going.
4. **`stalled` means escalate.** Any stage that stalls hands control back to a human — the chain never
   silently retries a doomed action.
5. **Lessons are typed memories.** `type: feedback` files, so `memory-keeper`'s index/archive/budget
   machinery applies unchanged.

## 6. What already exists vs what's needed

| Piece | Status |
|---|---|
| `loop-ledger` (brake, hook, state machine) | **Exists** (parent repo; packaged by `agent-loops`) |
| `memory-keeper` (store, index, archive, budget) | **Exists** (shipped plugin) |
| `kkskills-essentials` meta-skill (fold learnings → skills, versioned) | **Exists** (shipped plugin) |
| `reflexion` (recall/reflect/compress over the store) | **Proposed** ([spec](./REFLEXION_SPEC.md)) |
| `critique-gate` (scorer + quality Stop hook) | **Proposed** ([spec](./CRITIQUE-GATE_SPEC.md)) |
| `prompt-evolve` (test-set prompt optimizer) | **Proposed** ([spec](./PROMPT-EVOLVE_SPEC.md)) |
| `agent-loops` (playbook + brake umbrella) | **Proposed** ([spec](./AGENT-LOOPS_SPEC.md)) |

So the self-improvement chain is **half-built already**: the brake, the durable memory, and the
skill-folding meta-skill are live. The three proposed nodes + the umbrella complete the circuit.

## 7. Minimum viable chain (ship order)

1. **MVC-1 (works today):** `loop-ledger` + `memory-keeper` + meta-skill — bounded loops whose lessons
   persist and can graduate into skills. No new code; just a documented workflow.
2. **MVC-2:** add `reflexion` — automates recall-before / reflect-after against the store.
3. **MVC-3:** add `critique-gate` — gives the loop a real Evaluate stage and a quality brake.
4. **MVC-4:** add `prompt-evolve` — closes the outer "loop improves the loop".
5. **Umbrella:** `agent-loops` packages the brake + full pattern playbook for discovery.

## 8. Design decisions

- **Compose by convention, not a new orchestrator.** Files + env + MCP tools + hooks are enough; a
  daemon would add a failure mode and break the "plain files + git" property.
- **Keep the human in the loop at `stalled` and at skill-graduation.** Evolution is supervised, not
  autonomous — matching the brake's whole reason to exist.
- **Reuse, don't duplicate.** Every stage delegates storage to `memory-keeper` and continuation to
  `loop-ledger`; the new plugins add only their stage's logic.

## 9. Open questions

1. **Graduation policy.** When does a compressed lesson auto-become a skill edit vs require approval?
2. **Cross-plugin config surface.** One shared `.claude/settings.json` block vs per-plugin env — pick a
   convention so the chain is one-command to enable.
3. **Observability.** A single `chain report` (score curve + lessons learned + skills changed this
   period) would make the evolution visible; where does it live — `prompt-evolve report` extended, or a
   new tiny command?
4. **Ordering guarantees.** recall → act → evaluate → reflect must not race under concurrent tasks;
   does this need `loop-ledger` to own a per-task lock?

## 10. Verification

- **MVC-1 end-to-end:** run a bounded task loop; confirm a lesson file is written, `memory-keeper lint`
  stays green, and the meta-skill can promote it (versioned, changelogged).
- **Full chain smoke:** a deliberately-improvable task shows score rising across ticks (critique-gate),
  a lesson persisted (reflexion), and — over repeated runs — a prompt generation improving
  (prompt-evolve), all closing cleanly under `loop-ledger` (`target_reached`, never infinite).
- **Stall path:** an unfixable task triggers `stalled` and surfaces to the user at every stage.

## Provenance

Chain structure follows the "Act → Observe → Evaluate → Adjust" pattern-behind-the-patterns from Rahul
(@sairahul1), *"20 Loop Design Patterns Every AI Engineer Should Know"*
(x.com/sairahul1/status/2072258045460226373, Jul 1 2026), mapped onto the kktest-dev marketplace's
existing components.
