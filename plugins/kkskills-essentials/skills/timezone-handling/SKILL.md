---
name: timezone-handling
description: "Use this skill whenever code stores, computes, compares, or displays dates and times — especially across servers, databases, containers, and users in different zones.
  Triggers include: 'timezone', 'UTC', 'timestamp', 'DST', 'naive datetime', 'TIMESTAMPTZ vs TIMESTAMP', 'market hours', 'it shows the wrong time', 'off by N hours', scheduling/cron, container TZ, date-only vs datetime.
  Also use when designing a DB schema with time columns or a scheduler.
  Do NOT use for monotonic durations/elapsed-time measurement (use a monotonic clock, not wall-clock — but that's a different concern)."
version: "0.1.0"
updated: "2026-06-19"
---

# Reference — Timezone Handling

## Overview

The rule that prevents almost every timezone bug: **store and compute in UTC, convert to local only at
the very edges** (display, and parsing user input). Times go wrong when a *naive* timestamp (no zone)
gets reinterpreted by whatever the server, DB, or container happens to be set to — and that setting
differs between dev, CI, and prod.

## When to Use

- ✅ Designing time columns in a schema.
- ✅ Any cross-zone system (users, servers, containers in different zones).
- ✅ Scheduling, cron, "run at 9am" logic, market-hours logic.
- ✅ A bug where a time is off by a whole number of hours (classic offset bug).
- ❌ Measuring elapsed time / timeouts — use a monotonic clock instead.

## Process / Steps

### Step 1 — Store in UTC, always

- ☐ Persist instants in UTC. In Postgres use `TIMESTAMPTZ` (stores an instant; `TIMESTAMP` without zone
  is a naive wall-clock and a footgun).
- ☐ Application layer: use timezone-**aware** datetimes. In Python, `datetime.now(timezone.utc)` — never
  `datetime.now()` or `utcnow()` (both produce naive values).
- ☐ Keep the original zone separately only if it carries meaning (e.g. "the user's booking was at 9am
  *their* time") — store the instant in UTC **plus** the IANA zone name.

### Step 2 — Convert only at the edges

- ☐ Inbound: parse user input *with* its zone, convert to UTC immediately.
- ☐ Outbound: convert UTC → the viewer's zone at render time, not before.
- ☐ Never let an intermediate layer reinterpret a naive value against the local default.

### Step 3 — Use the IANA tz database, respect DST

- ☐ Use zone names like `Asia/Bangkok`, `America/New_York` — not fixed offsets like `+07:00` (offsets
  don't know about DST).
- ☐ DST means some local times don't exist (spring-forward gap) or exist twice (fall-back overlap) —
  decide how you resolve those for scheduling.
- ☐ "9am every day" in a DST zone is **not** a fixed UTC time — compute it in the local zone each day.

### Step 4 — Pin the environment

- ☐ Set containers/servers to UTC (`TZ=UTC`) so logs and any accidental naive ops are at least
  consistent across environments.
- ☐ Don't rely on the host clock's zone for correctness — make zone explicit in code.
- ☐ For "date only" (a birthday, a trading day), use a `DATE` type / date object — not a datetime at
  midnight, which is zone-sensitive and will drift across the date boundary.

### Step 5 — Domain time (e.g. market hours)

- ☐ Anchor recurring domain windows to their real zone (US market = `America/New_York`, incl. DST), then
  convert to UTC for storage/comparison.
- ☐ Account for holidays/half-days as data, not hardcoded offsets.

## Rules & Constraints

- ALWAYS: store instants in UTC (`TIMESTAMPTZ`); compute in UTC.
- ALWAYS: use timezone-aware datetimes; convert at display/input edges only.
- ALWAYS: use IANA zone names, not fixed offsets — they encode DST.
- ALWAYS: set containers to `TZ=UTC` for consistency across dev/CI/prod.
- NEVER: use naive `datetime.now()` / `utcnow()` for stored or compared times.
- NEVER: store local wall-clock time without its zone.
- NEVER: represent a date-only value as a midnight datetime.

## Examples

**Scenario:** Timestamps show 7 hours off in prod but fine locally.
**Cause:** A naive datetime stored in `TIMESTAMP` (no zone); prod container TZ ≠ dev. 
**Right:** Switch the column to `TIMESTAMPTZ`, write aware UTC datetimes, set `TZ=UTC` in the container, convert to `Asia/Bangkok` only on display.

**Scenario:** "Run the daily batch at 18:00 Bangkok."
**Right:** Compute the next 18:00 in `Asia/Bangkok` each run and convert to UTC — don't hardcode `11:00 UTC` (and for a DST zone it would drift twice a year).

**Scenario:** Comparing US market open across the year.
**Right:** Anchor to `America/New_York` 09:30 (DST-aware) → convert to UTC per day; the UTC instant shifts by an hour across DST, which is correct.

## Changelog

- 0.1.0 (2026-06-19) — initial version; UTC-everywhere, edge conversion, IANA/DST, container TZ, date-only and market-hours guidance. Source: "System timezone configuration" session.
