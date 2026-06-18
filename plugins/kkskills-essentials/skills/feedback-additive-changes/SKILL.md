---
name: feedback-additive-changes
description: "Use this skill whenever you're proposing a refactor, cleanup, deletion, or migration in an existing (production) codebase.
  Triggers include: 'refactor X', 'clean up Y', 'remove dead code', 'delete unused Z', 'migrate this endpoint', 'while I'm here let me also...', any destructive change to code paths or data that something already depends on.
  Also use when scoping proof-of-concept work where additive is the explicit rule.
  Do NOT use for genuinely new features that don't touch existing flow at all — those are additive by default."
version: "0.2.0"
updated: "2026-06-19"
---

# Feedback — Additive Changes

## Overview

When refactoring or adding capability, the default mode is **additive**: a new endpoint alongside the
old one, a new column on the table, a new directory next to the legacy one, a new entity/use case. Don't
modify the existing flow or delete dormant code unless explicitly asked. Additive changes are reversible
and low-blast-radius; destructive ones aren't.

## When to Use

- ✅ Any refactor of code currently in production.
- ✅ Any migration that changes existing tables.
- ✅ Proof-of-concept work, and any strangler-fig migration toward a new architecture.
- ✅ When tempted to delete "unused" code.
- ❌ Pure greenfield additions in new directories — already additive.

## Process / Steps

### Step 1 — Decide: additive or destructive?

Run this decision tree before writing any code:

- ☐ Adding a brand-new endpoint at a path that doesn't exist yet? → Additive. Proceed.
- ☐ Adding a new column with `ADD COLUMN ... NULL`? → Additive. Proceed.
- ☐ Creating a new directory/module next to the existing ones? → Additive. Proceed.
- ☐ Modifying an existing endpoint's request/response shape? → **Stop.** Re-scope as a new endpoint.
- ☐ Dropping a column or making it `NOT NULL` without backfill? → **Stop.** See [[feedback-migrations-additive-first]].
- ☐ Deleting code that looks unused? → **Stop.** Go to Step 2.

### Step 2 — Mark dormant code instead of deleting

Code that looks unused is often intentionally dormant (kept for a future provider, a feature flag, a
planned integration). Annotate it rather than delete it, so the intent is explicit and the next person
doesn't "clean it up" either.

```python
# Module-level constant
_LEGACY_STREAM_URL = "wss://example.com/v1/stream"
# DORMANT — legacy streaming endpoint; kept for a future provider integration.

def start(self):
    if connector_registry.has("stream_quotes"):
        # DORMANT — no provider currently registers "stream_quotes";
        # this branch is unreachable but preserved for future providers.
        return self._start_streaming()
    return self._start_poll()
```

- ☐ Add a `DORMANT — <reason>` comment at each kept-but-unreachable site.
- ☐ Mention dormant status in the docstring of the containing class/module.
- ☐ Confirm tests still pass and the linter is clean (zero behavior change).
- ☐ Commit message: `docs(<area>): mark <feature> dormant — kept for <reason>` (comment-only diff).

### Step 3 — Migrations are additive too

The same rule applies to schema: add first, tighten/remove later, never in one migration. The full
expand-contract playbook (nullable add → backfill → tighten → drop) lives in
[[feedback-migrations-additive-first]]. Default to that; one migration that adds-and-tightens-and-drops
is the smell.

### Step 4 — Proving a new pattern with low blast radius

When introducing a new pattern (a Unit of Work, a new layering, a new persistence path):

- ☐ Choose a trivial aggregate, not your most central one — exercise the path, not the whole domain.
- ☐ Pick a write use case with a small blast radius (e.g. a new "mark dismissed" action on a new column).
- ☐ Add only what's needed: new endpoint, new column, new directory.
- ☐ Leave existing endpoints, existing flows, and existing user-facing behavior **unchanged**.
- ☐ Document the proven pattern (e.g. in `CLAUDE.md`) so the next iteration reuses it.

## Checklist Before Submitting a Refactor PR

- ☐ No existing endpoint's request/response shape changed.
- ☐ No legacy file deleted (boy-scout migrate only when feature work already touches it).
- ☐ No migration drops or hard-constraints a column without prior backfill ([[feedback-migrations-additive-first]]).
- ☐ Any "unused" code retained has `DORMANT — <reason>` comments.
- ☐ Scope matches the stated goal; no "while I'm here" extras.

## Rules & Constraints

- ALWAYS: add a `DORMANT — <reason>` comment before considering deletion.
- ALWAYS: new endpoints get new paths; don't change the semantics of existing paths.
- ALWAYS: migrations add first, tighten/drop later ([[feedback-migrations-additive-first]]).
- NEVER: delete dormant-by-intent code without asking.
- NEVER: do "while I'm here" cleanup outside the agreed scope.
- NEVER: change existing endpoint behavior inside a proof-of-concept.

## Examples

**Scenario:** A streaming code path looks unused.
**Wrong:** Delete the streaming branch.
**Right:** Add `DORMANT — legacy streaming, kept for a future provider` to the class docstring, the URL
constant, and the unreachable branch. Verify tests pass, linter clean, zero behavior change. Commit the
comment-only diff.

**Scenario:** A PoC needs a write use case to prove a Unit-of-Work pattern.
**Wrong:** Refactor an existing endpoint to use it.
**Right:** Add a nullable column (1-line additive migration), build the use case behind a *new* endpoint,
and leave all existing flows untouched.

**Scenario:** Legacy `services/foo.py` overlaps with new `use_cases/foo.py`.
**Wrong:** Delete `services/foo.py` because the new one exists.
**Right:** Boy-scout rule — migrate `services/foo.py` only when feature work actually touches it. Until
then, it stays.

## Changelog

- 0.2.0 (2026-06-19) — genericized examples (removed project-specific identifiers); collapsed the duplicated migrations step into a cross-link to [[feedback-migrations-additive-first]]. Source: superpowers-curation review.
- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
