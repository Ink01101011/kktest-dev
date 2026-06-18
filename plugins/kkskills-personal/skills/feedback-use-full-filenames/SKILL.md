---
name: feedback-use-full-filenames
description: "Use this skill whenever you're about to reference a project doc in chat — especially versioned docs that follow a dated filename convention (e.g. DDMMYYYY_NAME.md) or any scheme that layers new versions beside old ones.
  Triggers include: mentioning AUDIT, BUG, SCALING, ROADMAP, TODO, CHECKLIST, REGRESSION, or any doc that has a date prefix in the repo.
  Also use when linking via `present_files` or markdown links.
  Do NOT use for one-off short notes or temporary scratch files that don't follow the convention."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — Use Full Filenames

## Overview

When referencing project docs in chat, use the full `DDMMYYYY_NAME.md` form on **first mention** in a response — not the casual short name. The date prefix exists because the project layers new versions next to old ones; the short form is ambiguous.

## When to Use

- ✅ First mention of any architecture/audit/roadmap/TODO doc in a response.
- ✅ Every `present_files` call — full absolute path.
- ✅ Every markdown link — full filename in the URL.
- ❌ Repeated references in the same response (short form is fine after first mention).

## Process / Steps

### Step 1 — Resolve the full filename before mentioning

- ☐ `Glob "**/<NAME>*.md"` to find the current dated version (e.g. `27052026_ARCHITECTURE_AUDIT.md`).
- ☐ If multiple dated versions exist, take the most recent one unless context says otherwise.

**Example:** About to say "ตามที่ระบุใน AUDIT.md ...". First `Glob "**/ARCHITECTURE_AUDIT*.md"` → returns `docs/architecture/27052026_ARCHITECTURE_AUDIT.md`. Now you have the canonical name.

### Step 2 — Use the full name on first mention

Format:

```
ตามที่ระบุใน `27052026_ARCHITECTURE_AUDIT.md` §8 (ต่อจากนี้เรียก AUDIT.md)
```

This anchors the short form for the rest of the response.

### Step 3 — Subsequent mentions

- ☐ Same response, after the anchor → short form OK (`AUDIT.md §8.5`).
- ☐ New response, no anchor → restate the full name.

### Step 4 — Links must use full absolute path

```markdown
[เปิดดู roadmap](computer:///<absolute-path-to-repo>/docs/architecture/27052026_SPRINT_ROADMAP.md)
```

- ☐ Path is absolute (host file path).
- ☐ Filename has the date prefix.

## Checklist Before Sending the Response

- ☐ First mention of any project doc → full `DDMMYYYY_NAME.md`.
- ☐ Subsequent short references all unambiguous (anchor was set).
- ☐ All `present_files` calls and markdown links use the full absolute path with date prefix.
- ☐ Commit messages and PR descriptions use the full filename.

## Rules & Constraints

- ALWAYS: full `DDMMYYYY_NAME.md` on first mention.
- ALWAYS: include the date prefix in `Glob`/`Grep` patterns so you don't match stale versions.
- NEVER: refer to a doc by short name without ever stating the full name.

## Examples

**Wrong:** "ตามที่ระบุใน AUDIT.md §8 ..."
→ Ambiguous. Which audit? When?

**Right:** "ตามที่ระบุใน `27052026_ARCHITECTURE_AUDIT.md` §8 (ต่อจากนี้เรียกย่อๆ ว่า AUDIT.md) ..."
→ Anchored. Subsequent short references in the same response are now unambiguous.

**Right (link):** `[เปิดดู roadmap](computer:///<absolute-path-to-repo>/docs/architecture/27052026_SPRINT_ROADMAP.md)`

**Wrong (commit message):** `docs(tasks): update AUDIT.md`
**Right (commit message):** `docs(tasks): update 27052026_ARCHITECTURE_AUDIT.md §8`

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
