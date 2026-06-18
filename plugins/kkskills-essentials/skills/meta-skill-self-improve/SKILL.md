---
name: meta-skill-self-improve
description: "Use this skill whenever you discover something that should make an existing skill smarter — a new method, an extra step, a sharper trigger, a new edge case, an anti-pattern, or a concept that a skill doesn't yet cover.
  Triggers include: the user corrects you ('ทำไมไม่...', 'next time do X'), you fixed a mistake a skill should have prevented, a technique just proved out in real work, you hit an edge case a skill's checklist missed, or you're wrapping up a task and notice a reusable lesson.
  Also use when a skill has grown too large and its detail should be split into self-contained reference files.
  Do NOT use for one-off project facts (those go to memory, not a skill) or for creating brand-new skills from scratch (use skill-creator for that)."
version: "0.1.0"
updated: "2026-06-19"
---

# Meta — Self-Improving Skills

## Overview

Skills are **living documents**. A skill is only worth keeping if it gets sharper every time reality
teaches you something. This skill is the discipline for folding new learnings back into the right
skill — **additively**, versioned, and self-contained — so the library compounds instead of going
stale.

Core rule: when you learn something a skill should have known, **capture it into that skill before the
session ends**. A lesson that lives only in a transcript is a lesson you'll relearn the expensive way.

## When to Use

- ✅ The user corrects your behavior and the correction generalizes ("always X", "next time Y").
- ✅ You made a mistake a skill's checklist should have caught — tighten the checklist.
- ✅ A new technique, command, or pattern proved out in real work.
- ✅ You hit an edge case an existing skill doesn't mention.
- ✅ A skill exceeded ~300 lines or accumulated heavy reference detail → split it.
- ❌ A one-off project fact (a filename, a port, a person) → that's **memory**, not a skill.
- ❌ A whole new domain with no matching skill → use `skill-creator` to author a new one.

## Process / Steps

### Step 1 — Decide if it's skill-worthy

A learning belongs in a skill only if it's **reusable** (applies beyond this one task) and
**generalizable** (not tied to a single project's names). If it's project-specific, route it to memory
instead. Ask: "Would this help me — or someone else — on a different project next month?"

### Step 2 — Find the target skill

- ☐ `grep -ril "<keyword>" skills/` to find the skill whose topic this belongs to.
- ☐ One clear match → that's your target.
- ☐ Multiple plausible matches → put it in the most specific one; cross-link the others with `[[name]]`.
- ☐ No match → this isn't a self-improve; it's a new skill → hand off to `skill-creator`.

### Step 3 — Apply the change ADDITIVELY

Treat the skill body like production code: **add, don't rewrite.** See [[feedback-additive-changes]].

- ☐ Add to the right section — a new row in a checklist, a new entry under Rules, a new Example, a new
  step. Don't restructure validated content to slot one lesson in.
- ☐ Never delete existing guidance that's still correct. If something is now *wrong*, replace just that
  line and note it in the Changelog.
- ☐ Keep the skill's voice and structure (Overview / When to Use / Process / Rules / Examples).

### Step 4 — Record it in the Changelog

Every skill ends with a `## Changelog`. Append one line:

```
- <next-version> (YYYY-MM-DD) — <what changed> — <why / source: session, PR, incident>.
```

### Step 5 — Bump the version

Use the skill-versioning rules (below). The version lives in frontmatter (`version:`) and the `updated:`
date is set to today.

### Step 6 — Keep it self-contained

A skill folder must carry everything it needs — no links into a specific repo.

- ☐ Examples are inline or in sibling files **inside the skill folder**.
- ☐ If the skill grew past ~300 lines, move deep detail into `references/<topic>.md` in the same folder
  and link to it from the body (e.g. `see references/backoff.md`). The `SKILL.md` stays scannable.
- ☐ No absolute paths, no project-only filenames in the trigger/`description`.

### Step 7 — Verify

- ☐ Frontmatter still valid YAML (`name`, `description`, `version`, `updated`).
- ☐ Trigger (`description`) still accurately describes when to fire — update it if the scope changed.
- ☐ No duplication introduced; cross-links (`[[...]]`) still resolve.

## Skill versioning rules (SemVer for skills)

| Bump | When |
|---|---|
| **patch** (0.1.0 → 0.1.1) | Clarified wording, added/fixed an example, tightened a checklist item. No new behavior. |
| **minor** (0.1.0 → 0.2.0) | New step, new section, new rule, broadened trigger — the skill now covers more. |
| **major** (0.1.0 → 1.0.0) | Reworked the skill's premise, or a rule reversed (old guidance now wrong). Note the break in the Changelog. |

## Changelog format

```markdown
## Changelog

- 0.2.0 (2026-06-19) — added "expand-contract for enum columns" step — learned from the rename incident in the news pipeline.
- 0.1.1 (2026-06-10) — clarified that CONCURRENTLY can't run in a txn — review feedback.
- 0.1.0 (2026-05-30) — initial version.
```

Newest entry on top. One line per change. Always say *why* / where it came from.

## Rules & Constraints

- ALWAYS: fold the lesson in before the session ends — don't defer it to "later".
- ALWAYS: additive edits — extend, don't rewrite validated guidance ([[feedback-additive-changes]]).
- ALWAYS: Changelog entry + version bump on every skill change.
- ALWAYS: keep the skill self-contained — references live in the folder, not the repo.
- NEVER: put a project-specific fact into a skill — that's memory's job.
- NEVER: let a skill silently drift — an undocumented change is a future contradiction.
- NEVER: bloat a skill past readability — split into `references/` instead.

## Examples

**Scenario:** You learn a provider doesn't honor `Accept-Encoding: gzip` (wasted header).
→ Target `[[feedback-verify-with-real-data]]`. Add a Rule "verify per-provider gzip support with a real
probe before assuming it." Changelog: `0.2.0 — added per-provider gzip verification — source: provider probe round 3`. Bump minor.

**Scenario:** The user says "ทำไมไม่เตือน task ที่ค้างตอนจบ branch".
→ Target `[[proactive-task-reminders]]`. Add the branch-return trigger to the trigger list + a Rule.
Changelog + minor bump. (Behavioral correction that generalizes → skill, not memory.)

**Scenario:** `reference-clean-architecture` hit 320 lines after you added a Go example.
→ Move the per-stack examples into `references/examples-by-stack.md` inside the folder; link from the
body. Changelog: `0.3.0 — split stack examples into references/ to keep SKILL.md scannable`.

**Scenario:** You discover the prod DB port for the trader-platform is 9091.
→ **Not** a skill change. That's a project fact → write it to memory. Skills stay generic.

## Changelog

- 0.1.0 (2026-06-19) — initial version; defines the self-update discipline, skill SemVer, and Changelog format for kktest-dev/kkskills-essentials.
