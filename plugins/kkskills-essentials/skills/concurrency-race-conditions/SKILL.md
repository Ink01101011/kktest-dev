---
name: concurrency-race-conditions
description: "Use this skill when designing, reviewing, or debugging code where two things can happen at once — concurrent writes, shared state, schedulers, queue consumers, or 'works locally, flaky in prod'.
  Triggers include: 'race condition', 'deadlock', 'lost update', 'double-processing', 'idempotency', 'optimistic/pessimistic lock', 'SELECT FOR UPDATE', 'state machine', 'two requests at the same time', flaky/intermittent test failures, a duplicate-side-effect bug (charged twice, sent twice).
  Also use when writing a test harness to reproduce a suspected race.
  Do NOT use for purely single-threaded, single-writer code with no shared mutable state."
version: "0.1.0"
updated: "2026-06-19"
---

# Concurrency — Race Conditions

## Overview

A race condition is when correctness depends on timing you don't control. The classic shapes:
**lost update** (two writers clobber each other), **double-processing** (the same job runs twice),
**check-then-act** (the world changes between the check and the act), and **ordering** (B lands before
A). The fixes are a small toolkit: make the operation atomic, serialize access with a lock, or make
the effect idempotent so running twice is harmless.

The dangerous thing about races is they pass every local test and only break under real concurrency —
so reproduction and prevention both need deliberate effort.

## When to Use

- ✅ Concurrent writers to the same row/aggregate/state machine.
- ✅ Queue/stream consumers, schedulers, webhooks (at-least-once delivery → duplicates).
- ✅ Any "check then act" (check balance → debit; check exists → insert).
- ✅ Intermittent, non-deterministic test failures or prod-only bugs.
- ❌ Single-writer, single-threaded flows with no shared mutable state.

## Process / Steps

### Step 1 — Classify the race

| Shape | Symptom | Primary fix |
|---|---|---|
| Lost update | Two writes, one silently wins | Optimistic lock (version column) or `SELECT ... FOR UPDATE` |
| Double-processing | Side effect happens twice | Idempotency key + dedup; exactly-once *effect*, not exactly-once delivery |
| Check-then-act | Valid at check, invalid at act | Do it in one atomic statement / one transaction with the right isolation |
| Ordering | B's effect appears before A's | Sequence numbers, causal keys, or serialize per key |

### Step 2 — Pick the mechanism

- **Atomic DB operation** — push the decision into one statement: `UPDATE ... WHERE status = 'active'`
  (returns rows affected = did I win?), `INSERT ... ON CONFLICT DO NOTHING`, conditional updates.
- **Optimistic locking** — add a `version` column; `UPDATE ... WHERE id = ? AND version = ?`; 0 rows →
  someone else won → reload and retry. Best when contention is low.
- **Pessimistic locking** — `SELECT ... FOR UPDATE` inside a transaction; serializes writers on that
  row. Best when contention is high or the critical section is non-trivial. Watch for deadlocks (always
  acquire locks in a consistent order).
- **Idempotency** — give each operation a stable key; record it; a repeat with the same key is a no-op
  that returns the first result. Essential for at-least-once queues and retried HTTP.
- **Transaction isolation** — know your default. `READ COMMITTED` does *not* prevent lost updates;
  use explicit locking or `SERIALIZABLE` (and handle serialization-failure retries).

### Step 3 — Make effects idempotent at boundaries

- ☐ External side effects (charge, email, order) go through an idempotency key the provider honors, or
  a local "already done" record checked in the same transaction.
- ☐ Consumers dedup on a stable message id; commit the offset/ack only after the effect is durable.

### Step 4 — Reproduce before you "fix"

A race you can't reproduce is a race you can't prove fixed.

- ☐ Write a harness that fires N threads/clients at the **real** datastore (a live Postgres in CI, not
  a mock — mocks don't have lock semantics).
- ☐ Use a barrier so all workers hit the critical section simultaneously.
- ☐ Assert the invariant (exactly one winner, no duplicates, final count correct).
- ☐ Keep it as a regression gate so the race can't silently return.

## Rules & Constraints

- ALWAYS: turn check-then-act into one atomic statement or one properly-locked transaction.
- ALWAYS: make externally-visible effects idempotent under at-least-once delivery.
- ALWAYS: reproduce a race with a concurrent harness against a real DB before claiming a fix.
- ALWAYS: acquire multiple locks in a consistent global order (deadlock avoidance).
- NEVER: rely on application-level "check first, then write" without a DB-level guard.
- NEVER: trust `READ COMMITTED` to stop lost updates — it won't.
- NEVER: test concurrency against a mocked datastore — lock/isolation behavior won't be there.

## Examples

**Scenario:** Two requests dismiss the same signal at once; both succeed, audit shows two dismissals.
**Wrong:** `if signal.status == 'active': signal.status = 'dismissed'; save()` — check-then-act race.
**Right:** `UPDATE signals SET status='dismissed', version=version+1 WHERE id=? AND status='active'` —
rows affected = 1 means you won, 0 means already dismissed. One atomic statement, no lock needed.

**Scenario:** A webhook is delivered twice (at-least-once) and the customer is charged twice.
**Right:** Derive an idempotency key from the event id; `INSERT ... ON CONFLICT DO NOTHING` into a
`processed_events` table in the same transaction as the charge; second delivery no-ops.

**Scenario:** Portfolio-merge test passes locally, flakes in CI.
**Right:** Build a threading harness against live Postgres with a start barrier; run 50 concurrent
merges; assert final holdings == expected. Make it a regression gate. (See [[feedback-verify-with-real-data]].)

## Changelog

- 0.1.0 (2026-06-19) — initial version; race taxonomy, mechanism selection, idempotency, live-DB reproduction harness. Source: "Race condition fixes" session.
