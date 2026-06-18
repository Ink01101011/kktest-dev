---
name: feedback-no-duplicate-docs
description: "Use this skill whenever you're about to create a new tracking, checklist, TODO, testing, audit, or roadmap document.
  Triggers include: phrases like 'create a checklist', 'write a TODO', 'track these tests', 'document the deferred items', 'make a regression list', or any time you're tempted to `Write` a new `.md` file at repo root or under `tasks/` or `docs/`.
  Also use when the user asks 'why didn't you update X' — that's a duplicate-doc miss.
  Do NOT use for genuinely new artifacts that cover a different angle than existing docs (e.g. SPRINT_ROADMAP.md was new because AUDIT.md and BUG.md covered different angles)."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — No Duplicate Docs

## Overview

Before creating any new tracking doc, search the repo for an equivalent file. If one exists, update it in place. Parallel docs drift — entries get updated in one and forgotten in the other, and the team loses track of which one is authoritative.

## When to Use

- ✅ Before every `Write` of a `.md` file at repo root, `tasks/`, or `docs/`.
- ✅ When asked to "track" or "document" work that has a natural existing home.
- ❌ When the new file is genuinely orthogonal to existing docs (different audience, different angle, explicit ask).

## Process / Steps

### Step 1 — Search before writing

Run `Glob` for likely existing names. The candidate list depends on the work:

| If you're tracking...     | Likely existing files                                |
|---------------------------|------------------------------------------------------|
| Test coverage / smoke     | `**/CHECKLIST*.md`, `**/TESTING*.md`, `**/REGRESSION_*.md` |
| Pending work              | `**/TODO*.md`, `**/tasks/deferred/**`                |
| Bugs                      | `**/BUG*.md`, `**/tasks/bugs/**`                     |
| Architecture decisions    | `docs/architecture/*.md`                             |
| Sprint plans / roadmaps   | `**/ROADMAP*.md`, `**/SPRINT*.md`                    |

**Example:** the user says "track the deploy verification steps". You'd be tempted to `Write tasks/DEPLOY_VERIFICATION.md`. Instead, `Glob "**/CHECKLIST*.md"` first — you'll find `tasks/CHECKLIST.md` and `Edit` it.

### Step 2 — Decide: Edit or Write?

- ☐ Match found → use `Edit` to extend the existing doc. Add a new section, not a new file.
- ☐ Multiple matches → ask the user which one is authoritative for this work.
- ☐ No match and the work is genuinely new → confirm with the user before `Write`, and link the new doc from related existing docs.

### Step 3 — Verify after editing

- ☐ Did the edit preserve the existing structure (sections, ordering)?
- ☐ Is there a TOC or header index in the existing doc that needs updating too?
- ☐ Are there cross-references (`see CHECKLIST.md §5`) in other docs that now need to point at the new section?

### Step 4 — Recover from a miss

If you've already written a duplicate (it happens):

- ☐ Apologize briefly ("ขอโทษ — ควรอัพเดทที่นี่ตั้งแต่แรก").
- ☐ Migrate the content from the new file to the existing doc with `Edit`.
- ☐ Delete the duplicate (`mcp__cowork__allow_cowork_file_delete` then `rm`).
- ☐ Confirm with the user that the canonical doc is now the only source.

## Rules & Constraints

- ALWAYS: search before writing a new `.md`.
- ALWAYS: prefer `Edit` over `Write` for tracking docs.
- ALWAYS: when a doc has a date prefix (`27052026_AUDIT.md`), the date doesn't make it stale — keep updating it unless explicitly versioned.
- NEVER: create `TESTING.md` when `CHECKLIST.md` already tracks tests.
- NEVER: create `TODO_v2.md` next to `TODO.md` — consolidate or delete one.
- NEVER: scatter the same content across `tasks/`, `tasks/checklist/`, `tasks/TODOS/`, `tasks/bugs/`.

## Examples

**Scenario:** "Track the deploy verification steps somewhere."
**Wrong:** `Write tasks/DEPLOY_VERIFICATION.md` from scratch.
**Right:** `Glob "**/CHECKLIST*.md"` → find existing `tasks/CHECKLIST.md` → `Edit` to add a new section.

**Scenario:** "Make a regression checklist for the new release."
**Right:** Check if a `REGRESSION_*.md` is still open. If yes, extend it. If the most recent one is closed/archived, only then spin up a new dated file.

**Scenario:** "I want a separate TESTING.md so it's easier to find."
**Right:** Push back gently — single source of truth wins. Suggest a TOC entry or section header in `CHECKLIST.md` instead.

**Recovery scenario:** You wrote `TESTING.md` at repo root. The user asks "ทำไมไม่กลับไปอัพเดตใน checklist.md".
**Output:** "ขอโทษ — ควรอัพเดทที่นี่ตั้งแต่แรก แก้ให้เลย พร้อมลบ TESTING.md ที่สร้างไปโดยไม่จำเป็น" → migrate content → delete the duplicate.

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
