# loop-ledger — Specification

Formal reference for the tools, decision logic, Stop-hook contract, and on-disk formats. For the
narrative guide see [CONCEPTS.md](./CONCEPTS.md).

## 1. Components

| file | role | dependencies |
|---|---|---|
| `server/ledger.js` | pure state machine (`newLoop`, `applyTick`, `hashState`) | `node:crypto` only |
| `server/store.js` | persistence, active-pointer, `sweep` | `node:fs/os/path` only |
| `server/index.js` | MCP stdio server (hand-written JSON-RPC 2.0) | none |
| `server/gate.mjs` | Stop-hook enforcer CLI | `./store.js` |
| `server/selftest.mjs` | zero-dep self-test | node builtins |

The MCP transport is **stdio, newline-delimited JSON-RPC 2.0**. `stdout` is the protocol channel;
all logging goes to `stderr`. Methods handled: `initialize`, `tools/list`, `tools/call`, `ping`;
notifications (e.g. `notifications/initialized`) are accepted and ignored.

## 2. Tools

### `loop_start`
Begin a loop. Required: `goal` (string), `max_iterations` (integer ≥ 1). Optional: `exit_mode`
(`manual`|`target`|`dry`, default `manual`), `target_value` (number), `direction`
(`increase`|`decrease`, default `increase`), `dry_rounds` (int, default 2), `patience` (int, default 2),
`max_tokens` (int), `max_wall_clock_seconds` (int), `enforce` (bool, default false).
Returns `{ loop_id, goal, exit, budget, patience, enforced }`. If `enforce`, writes `ACTIVE.json`.

### `loop_tick`
Report one iteration. Required: `loop_id` (string), `state` (string). Optional: `progress` (number),
`tokens_spent` (number), `done` (bool), `note` (string). Returns the **decision**:
`{ should_continue, status, reason, metrics }`. Closing a tick releases enforcement if this loop owns
`ACTIVE.json`.

### `loop_status`
Read-only. Required: `loop_id`. Returns counters + last 10 history entries; does not advance the loop.

### `loop_end`
Close a loop out-of-band. Required: `loop_id`. Optional: `reason`. Sets `final_status` to `ended`
(if not already closed) and releases enforcement.

### `loop_gc`
No arguments. Runs `sweep()` and returns `{ deleted }`.

Tool results use the MCP `CallToolResult` shape: `{ content: [{type:"text", text}], structuredContent }`,
with `isError: true` on a recoverable tool error (e.g. unknown `loop_id`).

## 3. Decision logic (`applyTick`)

On each tick: increment `iteration`; update `tokens_spent` if given; compute `hashState(state)` and
update `stall_count` (reset to 0 on change); update `best_progress`/`dry_count` if `progress` given.
Then evaluate in this precedence and stop at the first match:

1. `done === true` → **`done`**
2. `iteration ≥ max_iterations` → **`budget_exhausted`**
3. `tokens_spent ≥ max_tokens` (if set) → **`budget_exhausted`**
4. elapsed ≥ `max_wall_clock_seconds` (if set) → **`budget_exhausted`**
5. `exit_mode=target` and `progress` crossed `target_value` (per `direction`) → **`target_reached`**
6. `stall_count ≥ patience` → **`stalled`** (failure exit)
7. `exit_mode=dry` and `dry_count ≥ dry_rounds` → **`converged`** (success exit)
8. otherwise → **`continue`**

`metrics` = `{ iteration, stall_count, dry_count, best_progress, tokens_spent, elapsed_seconds,
budget_left: { iterations, tokens, seconds } }`.

`stalled` vs `converged`: `stalled` means the *same* `state` hash repeated (you are redoing identical
work — escalate); `converged` means `progress` stopped increasing across `dry_rounds` (legitimately
nothing left — success). They are distinct statuses on purpose.

## 4. Stop-hook gate (`gate.mjs`)

Invoked by the bundled **Stop hook** (`hooks/hooks.json`) on every stop attempt. Reads the Stop-hook
JSON on stdin and decides via stdout/exit:

| condition | action |
|---|---|
| `stop_hook_active === true` | `exit 0` (recursion guard) |
| no `ACTIVE.json` | `exit 0` — allow stop (nothing enforced) |
| referenced loop missing | clear `ACTIVE.json`, `exit 0` — allow |
| loop **closed** | clear `ACTIVE.json`, `exit 0` — allow (logs final status to stderr) |
| `block_count ≥ max_blocks` | clear `ACTIVE.json`, `exit 0` — **failsafe** allow |
| loop **open** | increment `block_count`, print `{"decision":"block","reason":…}`, `exit 0` |

The `{"decision":"block"}` output is the Claude Code Stop-hook contract for **forcing the agent to
continue**; the `reason` is fed back as the next instruction. Allowing the stop is `exit 0` with no
stdout.

## 5. On-disk formats (`$LOOP_LEDGER_DIR`)

**`loop_<id>.json`** — one per loop:
```jsonc
{
  "id": "loop_...", "goal": "...",
  "exit": { "mode": "target", "target_value": 0, "direction": "decrease", "dry_rounds": 2 },
  "budget": { "max_iterations": 8, "max_tokens": null, "max_wall_clock_seconds": null },
  "patience": 2, "created_at": 0, "closed_at": null,
  "iteration": 0, "last_hash": null, "stall_count": 0,
  "best_progress": null, "dry_count": 0, "tokens_spent": 0,
  "closed": false, "final_status": null, "history": []
}
```

**`ACTIVE.json`** — at most one; the loop currently enforced by the Stop hook:
```json
{ "loop_id": "loop_...", "block_count": 0, "max_blocks": 11 }
```

`sweep()` deletes `loop_*.json` where (`closed` and `closed_at` older than `LOOP_LEDGER_TTL_HOURS`) or
(`created_at` older than `LOOP_LEDGER_MAX_AGE_HOURS`). It never touches `ACTIVE.json`.

## 6. Guarantees

- **Terminates.** `max_iterations` bounds every loop; `stall_count`/`dry_count` provide earlier exits.
- **No early quit under enforcement.** While a loop is open, the gate blocks the stop.
- **No wedge.** `max_blocks` releases the gate if the agent stops ticking.
- **Deterministic.** Given the same ticks, `applyTick` always yields the same decisions (no randomness;
  wall-clock only affects the optional time budget).
