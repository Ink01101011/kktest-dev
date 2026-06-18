---
name: feedback-additive-changes
description: "Use this skill whenever you're proposing a refactor, cleanup, deletion, or migration in an existing (production) codebase.
  Triggers include: 'refactor X', 'clean up Y', 'remove dead code', 'delete unused Z', 'migrate this endpoint', 'while I'm here let me also...', any destructive change to `services/`, `routers/`, or existing migrations.
  Also use when scoping proof-of-concept work where additive is the explicit rule.
  Do NOT use for genuinely new features that don't touch existing flow at all — those are additive by default."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — Additive Changes

## Overview

When refactoring or adding capability, the default mode is **additive**: new endpoint alongside the old one, new column on the table, new directory next to the legacy one, new entity/use case. Do not modify the existing flow or delete dormant code unless explicitly asked.

## When to Use

- ✅ Any refactor of code currently in production.
- ✅ Any migration that changes existing tables.
- ✅ Sprint 1 PoC work and the Clean Arch strangler-fig migration.
- ✅ When tempted to delete "unused" code.
- ❌ Pure greenfield additions in new directories — already additive.

## Process / Steps

### Step 1 — Decide: additive or destructive?

Run this decision tree before writing any code:

- ☐ Am I adding a brand-new endpoint at a path that doesn't exist yet? → Additive. Proceed.
- ☐ Am I adding a new column with `ADD COLUMN ... NULL`? → Additive. Proceed.
- ☐ Am I creating a new directory (`entities/`, `use_cases/`) next to existing ones? → Additive. Proceed.
- ☐ Am I modifying an existing endpoint's request/response shape? → **Stop.** Re-scope as a new endpoint.
- ☐ Am I dropping a column or making it `NOT NULL` without backfill? → **Stop.** Split into two migrations.
- ☐ Am I deleting code that looks unused? → **Stop.** Go to Step 2.

### Step 2 — Mark dormant code instead of deleting

Concrete pattern that's already been validated in the project (`ws_price_manager.py`):

```python
# Class docstring
"""
WS price manager.

Modes:
  - Poll mode (ACTIVE) — fetches via REST every N seconds.
  - Streaming mode (DORMANT) — original Twelve Data WS implementation,
    kept for future provider streaming integration. The `start()` branch
    that selects streaming is unreachable in the current release because
    no connector named `ws_quotes` is registered → falls through to poll.
"""

# Module-level constant
_WS_URL = "wss://ws.twelvedata.com/v1/quotes/price"
# DORMANT — Twelve Data WS deprecated 2025; kept for future provider WS.

# Unreachable branch
def start(self):
    if connector_registry.has("ws_quotes"):
        # DORMANT — no provider currently registers ws_quotes;
        # this branch is unreachable but preserved for future providers.
        return self._start_streaming()
    return self._start_poll()
```

- ☐ Add `DORMANT — <reason>` comment.
- ☐ Mention dormant status in docstrings of the containing class/module.
- ☐ Confirm tests still pass: `pytest <relevant_path> -q`.
- ☐ Confirm linter clean: `ruff check <relevant_path>`.
- ☐ Commit message: `docs(<area>): mark <feature> dormant — kept for <reason>`.

### Step 3 — Migrations: additive in two steps

Never combine `ADD COLUMN + NOT NULL + DROP COLUMN` in one migration. Split:

**Migration 1 (additive, ships first):**
```sql
ALTER TABLE stock_analyses ADD COLUMN dismissed_at TIMESTAMPTZ NULL;
```

**Migration 2 (optional tightening, only after backfill is verified):**
```sql
-- After all rows have been backfilled and code only writes via UoW:
ALTER TABLE stock_analyses ALTER COLUMN dismissed_at SET DEFAULT NULL;
```

- ☐ Migration name follows `DDMMYYYY_<description>.sql`.
- ☐ Migration is idempotent or guarded by `IF NOT EXISTS` where appropriate.
- ☐ Existing reads/writes still work after the migration.

### Step 4 — PoC pattern for new patterns

When proving a new pattern (e.g. Sprint 1's `UnitOfWork` + entities):

- ☐ Choose a trivial aggregate (`Signal`, not `Analysis`).
- ☐ Pick a write use case that exercises commit path with low blast radius (`MarkSignalDismissedUseCase` with the new `dismissed_at` column).
- ☐ Add only what's needed: new endpoints, new column, new directory.
- ☐ Existing endpoints, existing `ensure_analysis` flow, existing user-facing behavior → **unchanged**.
- ☐ Document the pattern in `CLAUDE.md` so the next sprint reuses it.

## Checklist Before Submitting a Refactor PR

- ☐ No existing endpoint's request/response shape changed.
- ☐ No `services/` file deleted (Sprint 7+ boy-scout only).
- ☐ No migration drops or hard-constraints a column without prior backfill.
- ☐ Any "unused" code retained has `DORMANT — <reason>` comments.
- ☐ Scope matches the current sprint's Goal; no "while I'm here" extras.

## Rules & Constraints

- ALWAYS: add a `DORMANT — <reason>` comment before considering deletion.
- ALWAYS: migrations are `ADD COLUMN ... NULL` first; tighten constraints in a later migration after backfill.
- ALWAYS: new endpoints get new paths; don't change semantics of existing paths.
- NEVER: delete dormant-by-intent code without asking.
- NEVER: do "while I'm here" cleanup outside the sprint scope.
- NEVER: change existing endpoint behavior in a PoC sprint.

## Examples

**Scenario:** WS streaming code in `ws_price_manager.py` looks unused.
**Wrong:** Delete the streaming branch.
**Right:** Add `DORMANT — Twelve Data WS deprecated, kept for future provider streaming` docstring on the class + on `_run_forever` + on `_WS_URL` + on the unreachable `start()` branch. Verify 9/9 tests pass, ruff clean, zero behavior change. Commit comment-only diff.

**Scenario:** Sprint 1 PoC needs a write use case.
**Wrong:** Refactor an existing endpoint.
**Right:** Add `dismissed_at TIMESTAMPTZ NULL` column (1-line additive migration), build `MarkSignalDismissedUseCase` at a new endpoint `POST /api/analysis/{symbol}/signal/dismiss`, leave `ensure_analysis` and all existing flows untouched.

**Scenario:** Old `services/foo.py` overlaps with new `use_cases/foo.py`.
**Wrong:** Delete `services/foo.py` because `use_cases/foo.py` exists.
**Right:** Sprint 7+ boy-scout rule — migrate `services/foo.py` only when feature work touches it. Until then, it stays.

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
