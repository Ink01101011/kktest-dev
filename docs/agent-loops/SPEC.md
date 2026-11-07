# agent-loops — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).
The pre-release proposal is [docs/proposals/AGENT-LOOPS_SPEC.md](../proposals/AGENT-LOOPS_SPEC.md)
(historical).

## 1. Components

Skills only: no server, no hook, no script, no commands.

| Skill | Role |
|---|---|
| `skills/loop-selector` | router: task → category + pattern + `loop_start` config |
| `skills/quality-loops` | 5 Quality patterns |
| `skills/memory-loops` | 5 Memory patterns |
| `skills/planning-loops` | 5 Planning patterns |
| `skills/exploration-loops` | 3 Exploration patterns |
| `skills/system-optimization-loops` | 2 System Optimization patterns |

One skill per category (5), not per pattern (20), so five trigger phrases do not fragment into twenty.

## 2. Contract with loop-ledger

Every pattern's "Wire the brake" line names loop-ledger's real tools and parameters and nothing else:

```
loop_start { goal, max_iterations, exit_mode?, target_value?, direction?, dry_rounds?, patience?,
             max_tokens?, max_wall_clock_seconds?, enforce? } → loop_id
loop_tick  { loop_id, state, progress?, tokens_spent?, done?, note? } → { should_continue, status, ... }
loop_status { loop_id } · loop_end { loop_id, reason? } · loop_gc
```

Exit statuses: `target_reached` and `converged` (success), `stalled` (failure: escalate, do not retry the
same action), `budget_exhausted` (hard backstop), `done`/`ended` (closed by the caller). The full tool
contract is [docs/loop-ledger/SPEC.md](../loop-ledger/SPEC.md). agent-loops never copies loop-ledger's
state machine.

## 3. Skill format

Each `SKILL.md` has `name`, `description`, `version`, `updated` and a `## Changelog`, and a
`metadata.short-description` (≤ 200 characters) for the zip export targets.

## 4. Other tools

The skills export to other AI tools (`npx kktest-dev`, tier "with fallbacks"): the loop-ledger MCP tools
are optional there, and the skills are advisory without them.
