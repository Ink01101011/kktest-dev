---
name: feedback-migrations-additive-first
description: "Use this skill whenever you're writing a database schema migration, reviewing one, or designing how a schema change will roll out across multiple deploys.
  Triggers include: 'ALTER TABLE', 'ADD COLUMN', 'DROP COLUMN', 'RENAME COLUMN', 'NOT NULL', 'add an index', 'change column type', 'data migration', 'backfill', 'rename table', 'split table', 'merge tables', 'schema migration', 'breaking schema change'.
  Also use when reviewing a PR that touches `db/migrations/`, `prisma/migrations/`, `alembic/versions/`, or any equivalent.
  Do NOT use for application code changes that don't touch the database schema. See [[feedback-additive-changes]] for the broader additive principle applied to code."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — Migrations Additive First (expand-contract)

## Overview

Every schema change goes through **expand-contract**: first migration *only adds* (new column nullable, new table, new index). Tighten constraints and remove things only after the application code stops needing the old shape. Production downtime, failed deploys, and "the migration didn't run on prod" incidents nearly all trace back to a single PR that tried to add-AND-tighten-AND-remove in one migration.

Two migrations is the default. Three is fine. One is a smell.

## When to Use

- ✅ Any `ALTER TABLE` against a table with production data.
- ✅ Renaming a column or table.
- ✅ Splitting one column into two (or merging two into one).
- ✅ Changing a column type.
- ✅ Adding an index on a large table.
- ❌ Brand-new table that no code reads from yet — that's pure additive, one migration is fine.
- ❌ Pure development DB you're about to drop and recreate.

## Process / Steps

### Step 1 — Classify the change

| Change type                            | How many migrations? | Notes                                                  |
|----------------------------------------|----------------------|--------------------------------------------------------|
| New table, no existing code            | 1                    | Pure additive.                                         |
| `ADD COLUMN <name> <type> NULL`        | 1                    | Additive. Nullable, no default.                        |
| `ADD COLUMN <name> <type> NOT NULL`    | 2-3                  | Add nullable → backfill → tighten to NOT NULL.         |
| `DROP COLUMN <name>`                   | 2                    | Deploy code that stops reading/writing → then drop.    |
| `RENAME COLUMN a → b`                  | 3                    | Add `b` → dual-write → backfill → switch reads → drop `a`. |
| `ALTER COLUMN ... SET DATA TYPE`       | 2-3                  | Add new column with target type → backfill → switch → drop. |
| `CREATE INDEX` on large table          | 1 (with `CONCURRENTLY` in PG) | Avoid locking — Postgres `CREATE INDEX CONCURRENTLY`. |
| Split one column into multiple         | 3                    | Add new cols → backfill → swap reads → drop old col.   |

### Step 2 — Write migration #1 (expand only)

The first migration must be **safe to deploy without any application code change**. If the existing code keeps working after this migration, you're doing it right.

**Example — adding a NOT NULL column to a populated table:**

```sql
-- 28052026_add_signal_dismissed_at.sql
-- Step 1 of 2: additive only. Existing rows get NULL.

ALTER TABLE stock_analyses
  ADD COLUMN dismissed_at TIMESTAMPTZ NULL;
```

- ☐ Column is NULL-able.
- ☐ No `DEFAULT` that forces a full table rewrite (Postgres ≥ 11 handles `DEFAULT` cheaply but the rule of thumb still holds).
- ☐ No constraint that existing rows could violate.
- ☐ Deploy this migration. Old code keeps working — column is invisible to it.

### Step 3 — Backfill (separate migration or one-shot script)

After migration #1 is deployed, populate the new column.

**Inline migration (small tables, < ~100k rows):**

```sql
-- 29052026_backfill_signal_dismissed_at.sql
UPDATE stock_analyses
SET dismissed_at = updated_at
WHERE dismissed_at IS NULL AND status = 'dismissed';
```

**Batch script (large tables):**

```sql
-- Run in chunks to avoid long locks. Loop in app code or psql:
UPDATE stock_analyses
SET dismissed_at = updated_at
WHERE dismissed_at IS NULL
  AND status = 'dismissed'
  AND id BETWEEN $start AND $end;
```

- ☐ Backfill is idempotent (re-running it produces the same result).
- ☐ Use `WHERE <new_col> IS NULL` so it's safe to re-run.
- ☐ For multi-million-row tables, chunk the update — don't single `UPDATE` the whole table.
- ☐ Verify with `SELECT count(*) WHERE <new_col> IS NULL` before moving on.

### Step 4 — Deploy code that writes the new shape

Application code now writes both the new column AND continues working if it ever sees NULL (defensive read).

- ☐ Writes always populate the new column.
- ☐ Reads handle both NULL and populated cases.
- ☐ This deploy is independent — can ship without migration #3.

### Step 5 — Write migration #N (contract)

Now and only now, tighten the constraint or drop the old column.

**Example — tightening to NOT NULL:**

```sql
-- 30052026_tighten_signal_dismissed_at.sql
-- Step 2 of 2: tighten after backfill is verified.

ALTER TABLE stock_analyses
  ALTER COLUMN dismissed_at SET NOT NULL;
```

**Example — dropping the old column after rename:**

```sql
-- 31052026_drop_old_signal_status.sql
ALTER TABLE stock_analyses
  DROP COLUMN status;  -- replaced by `state` column
```

- ☐ Verify the old column / nullability is no longer referenced anywhere: `grep -rn "<old_name>" backend/ frontend/`.
- ☐ Verify no deployed version of the app still depends on the old shape (check production version, roll-forward window).
- ☐ Only run this migration after step 4 has been in production long enough that rollback won't go back to a version that needs the old shape.

## Anti-patterns to refuse

### One migration trying to do it all

```sql
-- 🚫 BAD — single migration: add NOT NULL + default + drop old
ALTER TABLE stock_analyses
  ADD COLUMN dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  DROP COLUMN dismissed;
```

Why bad:
- `NOT NULL DEFAULT now()` rewrites every row on some engines / older versions.
- If the migration fails halfway, the table is in a broken intermediate state.
- Old code referencing `dismissed` 500s the moment this lands.

Split into 3 migrations as in Steps 2-5.

### Renaming in a single migration

```sql
-- 🚫 BAD
ALTER TABLE users RENAME COLUMN name TO display_name;
```

Why bad: every running pod with the old code starts 500ing the second the migration commits. There is no rollback window.

**Right** (expand-contract):

```sql
-- migration 1: add display_name nullable
ALTER TABLE users ADD COLUMN display_name TEXT NULL;

-- migration 2: backfill
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- (deploy code: write to both, read from display_name with fallback to name)

-- migration 3: tighten
ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;

-- (deploy code: drop reads/writes of `name`)

-- migration 4: drop
ALTER TABLE users DROP COLUMN name;
```

### `CREATE INDEX` without `CONCURRENTLY` on a hot table

```sql
-- 🚫 BAD on Postgres production
CREATE INDEX idx_signals_symbol ON signals (symbol);
```

This takes an `ACCESS EXCLUSIVE` lock — writes block until done. On a hot multi-GB table that's hours of outage.

**Right** (Postgres):

```sql
CREATE INDEX CONCURRENTLY idx_signals_symbol ON signals (symbol);
```

Note: `CONCURRENTLY` can't run inside a transaction, so it usually needs its own migration file separate from any wrapping transaction.

### Forgetting that the migration system runs inside a transaction

Some migration tools wrap each file in a transaction by default (Alembic, golang-migrate, sqlx). Some DDL operations can't run in a transaction (`CREATE INDEX CONCURRENTLY`, certain `ALTER`s). Check your tool's docs and disable per-migration transaction wrapping when needed.

## Checklist Before Merging a Migration PR

- ☐ Migration name follows `DDMMYYYY_<description>.sql` (or the project's own date convention).
- ☐ Migration is **either** additive-only **or** contracting-only — not both.
- ☐ If contracting: the corresponding additive migration is already in production.
- ☐ If touching a large table (> 1M rows): the locking story is documented in the PR description.
- ☐ If using Postgres + large index: `CREATE INDEX CONCURRENTLY` is used and the file isn't wrapped in a transaction.
- ☐ Backfill is idempotent and scoped (`WHERE <new_col> IS NULL`).
- ☐ Rollback plan written in PR description — what's the undo migration?
- ☐ Application code doesn't depend on the new shape until the additive migration has been deployed.

## Rules & Constraints

- ALWAYS: expand-contract — add nullable, backfill, tighten, drop old. Never combine.
- ALWAYS: backfill in a separate step (migration or script), and make it idempotent.
- ALWAYS: deploy code that handles the new shape before tightening constraints.
- ALWAYS: use `CREATE INDEX CONCURRENTLY` on Postgres for large tables.
- NEVER: `DROP COLUMN` in the same migration that adds its replacement.
- NEVER: `RENAME` a column in one step on a production database.
- NEVER: `NOT NULL DEFAULT <value>` on a multi-million-row table without checking the engine's rewrite behavior.
- NEVER: skip the backfill verification step — trust the row count, not your memory.

## Examples

**Scenario:** Add a `last_login_at TIMESTAMP NOT NULL` to a 50M-row `users` table.

**Wrong (one migration):**

```sql
ALTER TABLE users
  ADD COLUMN last_login_at TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01';
```

→ Forces full table rewrite on engines without instant-default. Locks for tens of minutes to hours.

**Right (three migrations):**

```sql
-- 01_add_last_login_at.sql
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ NULL;
```

```sql
-- 02_backfill_last_login_at.sql  (chunked, run from app)
UPDATE users SET last_login_at = created_at
  WHERE last_login_at IS NULL AND id BETWEEN $start AND $end;
```

```sql
-- 03_tighten_last_login_at.sql  (only after backfill verified + code deployed)
ALTER TABLE users ALTER COLUMN last_login_at SET NOT NULL;
```

**Scenario:** Add a unique index on `users.email`.

**Wrong:**

```sql
CREATE UNIQUE INDEX idx_users_email ON users(email);
```

→ Blocks writes until done; will fail outright if any duplicate emails already exist.

**Right (Postgres):**

```sql
-- 01_dedup_user_emails.sql — find and resolve duplicates first
-- (app-level script or DELETE/UPDATE — not shown here)

-- 02_add_unique_email_index.sql
CREATE UNIQUE INDEX CONCURRENTLY idx_users_email ON users(email);
```

See also: [[feedback-additive-changes]] for the broader additive-first mindset applied to code; [[reference-clean-architecture]] for where DB access lives (repositories layer); [[feedback-verify-with-real-data]] for verifying the backfill actually populated rows.

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
