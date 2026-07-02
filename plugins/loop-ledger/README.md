# loop-ledger

A **guardrail for agent loops** — not a loop driver. It owns a small deterministic state machine
(**budget + stall-hash + exit predicate**) and answers one question per iteration: *should I continue?*
An opt-in **Stop hook** enforces the answer so the agent can neither quit early nor spin forever.

Zero-dependency: the MCP server speaks the stdio JSON-RPC protocol by hand, so it runs straight from a
clone with no `npm install`. Requires Node.js.

## Why

Self-paced agent loops fail in two directions: they **quit early** (declare done before they are) or
**spin forever** (retry the same failing action, burn tokens). loop-ledger makes both impossible:

- **Can't run forever** — `max_iterations` is a required hard cap; identical state K times ⇒ `stalled`.
- **Can't quit early** — with `enforce:true`, the Stop hook re-blocks the agent until the loop closes.

## Tools (MCP)

| tool | purpose |
|---|---|
| `loop_start` | begin a loop, get `loop_id` (requires `max_iterations`; `enforce:true` arms the Stop hook) |
| `loop_tick`  | report one iteration → `{ should_continue, status, reason, metrics }` |
| `loop_status`| read counters/history without advancing |
| `loop_end`   | close explicitly (releases enforcement) |
| `loop_gc`    | delete old loop files now (also runs on start + each `loop_start`) |

`status` ∈ `continue | done | target_reached | converged | stalled | budget_exhausted`.
**`stalled` = stop and change approach — do not retry the same action.**

## Exit modes

- `manual` — only an explicit `done:true` tick stops it (plus the safety backstops).
- `target` — stop when `progress` crosses `target_value` (`direction` increase/decrease).
- `dry` — stop after `dry_rounds` consecutive ticks with no new `progress` (loop-until-dry).

## Enforcement (opt-in)

`loop_start { enforce:true }` writes `$LOOP_LEDGER_DIR/ACTIVE.json`. The bundled **Stop hook**
(`hooks/hooks.json` → `server/gate.mjs`) runs on every stop attempt: while the loop is open it prints
`{"decision":"block",...}` to force another iteration; when the ledger closes the loop it allows the stop.
A `max_blocks` failsafe (`max_iterations + 3`) releases the gate if the agent wedges. The hook is a no-op
whenever no enforced loop is armed.

## Usage pattern

```
loop_start { goal:"fix failing suite", max_iterations:8, exit_mode:"target",
             target_value:0, direction:"decrease" }   // 0 failing tests
→ loop_id
repeat:
  <do one iteration of work>
  loop_tick { loop_id, state:"<failing test names + error>", progress:<#failing> }
  if !should_continue: break    // target_reached | stalled | budget_exhausted
```

`state` is the spin-detector input — pass whatever should *change* when you make progress (diff, error
text, remaining-work set). If it stops changing, you're stuck, and the ledger says so.

## Config

| env var | default | meaning |
|---|---|---|
| `LOOP_LEDGER_DIR` | `~/.loop-ledger` | where loop JSON + `ACTIVE.json` live |
| `LOOP_LEDGER_TTL_HOURS` | `168` (7d) | auto-delete closed loops older than this |
| `LOOP_LEDGER_MAX_AGE_HOURS` | `720` (30d) | auto-delete any loop older than this |

## Verify

```bash
node server/selftest.mjs   # raw JSON-RPC handshake + tool cycle + gate branches
```
