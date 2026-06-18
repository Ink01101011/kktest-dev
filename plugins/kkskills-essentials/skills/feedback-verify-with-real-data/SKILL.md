---
name: feedback-verify-with-real-data
description: "Use this skill whenever you're about to make a claim about codebase state or external API behavior.
  Triggers include: 'does X exist', 'is Y still used', 'does this endpoint work on the Starter plan', tier/quota questions about external APIs, planning a TODO consolidation, or any moment you'd otherwise say 'I think...' or 'should be...'.
  Also use before designing API probes — probe output data, not endpoint access.
  Do NOT use for clearly hypothetical 'what if X' design discussions where ground truth doesn't yet exist."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — Verify With Real Data

## Overview

Every claim about codebase state must be backed by `grep`/`Read`/`bash`, not docs or assumptions. Every claim about external API behavior must be backed by a probe of the data the API actually returns, not what the docs say it returns.

## When to Use

- ✅ Before claiming a function/feature/symbol exists or doesn't.
- ✅ Before claiming an external API tier limit or capability.
- ✅ Before migrating TODOs/checklists — verify each item against actual codebase.
- ✅ When the user asks "are you sure?" — the answer should already be backed by a check.
- ❌ Pure design/architecture sketches where the code doesn't exist yet.

## Process / Steps

### Step 1 — Codebase claims: grep first

Concrete commands:

```bash
# Does a function exist?
grep -rn "def <function_name>" backend/app/

# Is a symbol still referenced?
grep -rn "<SymbolName>" backend/ frontend/src/

# Does an endpoint exist?
grep -rn "@router\.\(get\|post\|put\|delete\|patch\)" backend/app/routers/ | grep "<path>"

# Is a migration applied?
ls db/migrations/ | grep "<keyword>"
```

**Example:** Tempted to say "`BatchSyncEngine.available()` exists on the rate limiter."
- ☐ Run `grep -rn "def available" backend/app/`.
- ☐ If found → cite the file:line.
- ☐ If not found → say "doesn't exist yet, would need to add it" — don't invent.

### Step 2 — External API claims: probe output data, not endpoint access

The trap: many APIs return data on every plan but reduce content silently. Endpoint reachability is **not** evidence of capability.

Probe design rules:

| Claim                  | Bad probe                          | Good probe                                              |
|------------------------|------------------------------------|---------------------------------------------------------|
| FMP tier is Premium    | `GET /historical-chart/15min` works| `GET /historical-price/AAPL?from=2015-01-01` returns rows |
| AV budget not exhausted| `GET /query?function=NEWS_SENTIMENT` returns 200 | Response contains `feed` array with len > 0; if "Note: API call frequency..." → exhausted |
| TD rate-limit OK       | Single quote returns               | Inspect `X-RateLimit-Remaining` header or call counter   |

**Example:** Need to know if the user's FMP key is Starter or Premium.
- ☐ Run probe: ask FMP for AAPL daily price on 2015-01-02 (>5 years back).
- ☐ Starter returns empty array; Premium returns the bar.
- ☐ Use that as the discriminator — do **not** assume `403/empty = Starter` on endpoint reachability.

### Step 3 — TODO/checklist consolidation: verify each item

When migrating items from old TODOs into a consolidated file:

- ☐ For each item, identify the file/symbol it references.
- ☐ `grep` against the current `backend/app/`, `frontend/src/`, `db/migrations/`.
- ☐ If the referenced code is already present (feature shipped) → drop from the new file; note it in a "filtered out" section.
- ☐ If the referenced code is missing → keep it.
- ☐ Document the filter rationale in the README so future passes know what was excluded and why.

### Step 4 — Stating uncertainty

When you can't verify (no tool access, sandbox limits):

- ☐ State the uncertainty clearly: "I haven't been able to run the probe — can you check?"
- ☐ Provide the exact command you'd run.
- ☐ Don't guess and present the guess as fact.

## Checklist Before Asserting

- ☐ Have I grep'd / Read the actual file?
- ☐ For external APIs, am I probing data (rows, schema, range), not just endpoint access?
- ☐ Is the claim citable to a specific file:line or API response shape?
- ☐ If I can't verify, am I marking the statement as uncertain instead of confident?

## Rules & Constraints

- ALWAYS: grep before claiming existence.
- ALWAYS: probe data ranges, schema shape, or row counts when checking API tier.
- ALWAYS: read the actual file before describing what's in it.
- NEVER: claim a function exists based on doc references alone.
- NEVER: assume `[ ]` in a TODO means "not done" — verify against the codebase.
- NEVER: trust the API provider's pricing page over actual response payloads.

## Examples

**Wrong (FMP tier detection):** Probe `/historical-chart/15min` → assume 403/empty = Starter.
→ FMP doesn't block at the network level. Starter still gets a response. False positive: reports Premium.

**Right (FMP tier detection):** Probe AAPL price in 2015 (>5 years back). Starter returns empty (5-year limit), Premium returns rows. Discriminate on **data range**, not endpoint reachability.

**Wrong (TODO migration):** Copy all unchecked items from `tasks/TODOS/` into `tasks/deferred/`.
→ Many items have shipped; the checkbox is just stale.

**Right (TODO migration):** For each item, `grep` the referenced symbol/file. Drop items where the target is already in the codebase. Note the filter rationale in the README. Result: 11+ obsolete items filtered, dev team avoids reopening them.

**Wrong:** "I think `BatchSyncEngine.available()` exists on the rate limiter."
**Right:** `grep -rn "def available" backend/app/` → confirm or say "doesn't exist, would need to add it."

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
