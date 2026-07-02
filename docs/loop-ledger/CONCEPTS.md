# loop-ledger — Concepts, Usage & Installation

A complete guide: what problem loop-ledger solves, how it solves it, how to install it, how to use it,
and every option explained.

---

## 1. The concept

### The problem: self-paced agent loops fail two ways

When an agent runs a loop it drives itself — "keep fixing tests until they pass", "find bugs until there
are none left", "retry until it works". Two failure modes show up again and again:

- **Quitting early.** The agent declares "done" before the work is actually finished. Self-assessment is
  the weakest possible stop condition.
- **Spinning forever.** The agent retries the *same* failing action over and over, making no progress
  and burning tokens — the classic "stuck" loop.

Both come from the same root cause: **the decision to continue is left to the model's judgment**, and
that judgment is unreliable in exactly the situations a loop creates.

### The fix, in one sentence

> Move the *should-I-continue* decision out of the model and into a small deterministic state machine
> that the model **cannot rationalize past** — grounded in a hard **budget**, a **stall-hash** that
> detects spinning, and an explicit **exit predicate** — and optionally let a **Stop hook** enforce its
> verdict so the agent can neither quit early nor spin forever.

loop-ledger is *not* a loop driver. Your skill/workflow still runs the loop body. loop-ledger is the
**guardrail** that decides when the loop must end.

### Five invariants it enforces

1. **Every tick changes state.** You pass `state` each iteration; identical state N times in a row ⇒
   `stalled`.
2. **Exit on ground truth, not vibes.** Stop on a crossed `target`, on K rounds with no new progress
   (`dry`), or on an explicit `done` — all evaluated by code, not the model.
3. **Stall detection via hashing.** `stalled` (identical state repeated) is a *failure* exit → escalate.
   `converged` (no new progress) is a *success* exit → nothing left to do. Opposite reactions, kept
   distinct.
4. **Hard budget backstop.** `max_iterations` is required; optional `max_tokens` / `max_wall_clock_seconds`.
   The loop is forced to stop at the cap no matter what.
5. **State persists outside context.** Each loop is a JSON file, so progress survives summarization and
   restarts; the loop reads ground truth instead of trusting memory.

---

## 2. The state machine

Each `loop_tick` returns a `status` and a boolean `should_continue`:

| status | should_continue | meaning |
|---|---|---|
| `continue` | true | progress ok — do another iteration |
| `done` | false | you asserted the goal is met (`done:true`) |
| `target_reached` | false | `progress` crossed `target_value` — **success** |
| `converged` | false | no new progress for `dry_rounds` rounds — **success** |
| `stalled` | false | identical state `patience+1` times — **spinning → escalate, do not retry** |
| `budget_exhausted` | false | hit `max_iterations` / `max_tokens` / wall-clock cap |

Decision precedence (highest first): `done` › hard budget › `target` › `stalled` › `dry` › `continue`.

### Exit modes

- **`manual`** — only an explicit `done:true` tick stops it (plus the safety backstops). Use when *you*
  know when it's finished.
- **`target`** — stop when `progress` crosses `target_value` (`direction` increase/decrease). Use for a
  measurable goal: "0 failing tests", "coverage ≥ 90".
- **`dry`** — stop after `dry_rounds` consecutive ticks with no new `progress`. Use for open-ended
  discovery: "find bugs until two rounds turn up nothing new" (loop-until-dry).

Stall detection is **always on** regardless of mode — it's the anti-spin guard, independent of how you
expect the loop to finish.

---

## 3. Installation

```shell
/plugin marketplace add https://github.com/Ink01101011/kktest-dev
/plugin install loop-ledger@kktest-dev
```

Or from the CLI:

```bash
claude plugin marketplace add https://github.com/Ink01101011/kktest-dev
claude plugin install loop-ledger@kktest-dev
```

The plugin ships a **zero-dependency** MCP server (the stdio JSON-RPC protocol is implemented by hand),
so it runs straight from the clone — **no `npm install`**. It only requires Node.js. Installing the
plugin registers both the MCP server (the `loop_*` tools) and the Stop hook (`server/gate.mjs`).

---

## 4. Usage

### Basic loop

```
loop_start { goal:"fix failing suite", max_iterations:8, exit_mode:"target",
             target_value:0, direction:"decrease" }      // 0 failing tests
→ { loop_id }

repeat:
  <do one iteration of work>
  loop_tick { loop_id, state:"<failing test names + first error>", progress:<#failing> }
  if not should_continue: break       // target_reached | stalled | budget_exhausted
```

`state` is the **spin-detector input** — pass whatever should *change* when you make progress: the diff,
the error text, the remaining-work set. If it stops changing, you're stuck, and the ledger says so.
`progress` is your **success metric** — a cumulative number used by `target`/`dry`.

### Enforced loop (the agent can't quit early)

```
loop_start { goal:"...", max_iterations:8, enforce:true }
```

With `enforce:true`, loop-ledger arms the Stop hook. From then on, every time the agent tries to end its
turn, the hook checks the loop: while it's open the hook **blocks the stop and re-injects the next-step
instruction**, forcing another iteration; once the ledger closes the loop, the hook allows the stop.

The result is enforcement in **both directions**, guaranteed by code outside the model's control:

- **Can't quit early** — the Stop hook keeps blocking until the loop closes.
- **Can't spin forever** — `max_iterations` (or `stalled`) closes the loop, which releases the hook.
- **Can't wedge the session** — a `max_blocks` failsafe (`max_iterations + 3`) releases the gate if the
  agent stops calling `loop_tick`.

The hook is a **no-op** whenever no enforced loop is armed, so it's safe to leave installed.

---

## 5. Options & configuration

`loop_start` parameters:

| param | required | default | meaning |
|---|---|---|---|
| `goal` | ✓ | — | what the loop is trying to achieve |
| `max_iterations` | ✓ | — | hard cap; loop stops after this many ticks |
| `exit_mode` | | `manual` | `manual` \| `target` \| `dry` |
| `target_value` | | — | for `target` mode |
| `direction` | | `increase` | `increase` \| `decrease`, for `target` mode |
| `dry_rounds` | | `2` | for `dry` mode: stop after N rounds with no new progress |
| `patience` | | `2` | stop as `stalled` after this many consecutive identical-state ticks |
| `max_tokens` | | — | optional cumulative token cap |
| `max_wall_clock_seconds` | | — | optional wall-clock cap |
| `enforce` | | `false` | arm the Stop hook for this loop |

Environment variables:

| env var | default | meaning |
|---|---|---|
| `LOOP_LEDGER_DIR` | `~/.loop-ledger` | where loop JSON + `ACTIVE.json` live |
| `LOOP_LEDGER_TTL_HOURS` | `168` (7d) | auto-delete closed loops older than this |
| `LOOP_LEDGER_MAX_AGE_HOURS` | `720` (30d) | auto-delete any loop older than this (abandoned ones) |

Cleanup runs automatically on server start and on each `loop_start`; `loop_gc` triggers it on demand.

---

## 6. Verify

```bash
node plugins/loop-ledger/server/selftest.mjs
```

Speaks raw MCP JSON-RPC to the server (initialize → tools/list → loop_start → three identical ticks ⇒
`stalled`) and checks the Stop-hook gate branches (no-active → allow, open loop → block, closed loop →
allow + clear). No dependencies required.

See the [full specification](./SPEC.md) for tool schemas, the gate contract, and file formats.
