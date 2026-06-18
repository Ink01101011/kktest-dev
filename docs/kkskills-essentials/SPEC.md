# kkskills-essentials — Specification

Status: 0.3.0 · Date: 2026-06-19 · Author: Ink

## 1. Problem

A coding agent re-derives the same working conventions every session — how to make changes safely, how
to verify claims, how to write a commit, how to lay out an architecture. Re-explaining them each time is
wasteful and inconsistent. Encoding them as **skills** (instruction packets the agent loads on demand)
fixes that, but only if the library is (a) genuinely reusable across projects, and (b) able to improve
over time without drifting. `kkskills-essentials` is that library: generic, self-improving, skills-only.

## 2. Goals & non-goals

**Goals**
- Ship **project-agnostic** working skills usable on any codebase.
- Make every skill a **living document** that gets sharper over time, versioned and changelogged.
- Keep each skill **self-contained** (no dependency on a specific repo or external file).
- Be host-portable — work as plain `SKILL.md` files across Claude Code, Cowork, and the Claude Desktop
  chat tab.

**Non-goals**
- No MCP server, hooks, sub-agents, or slash commands — this plugin is **skills-only**.
- No personal or project-specific skills — those live in `kkskills-personal`.
- Not a methodology framework (the dev-loop workflow space is covered by other marketplaces such as
  `obra/superpowers`); this is a discipline + reference library.

## 3. Skill format contract

Each skill is a directory `skills/<name>/` containing a `SKILL.md` with two parts:

```markdown
---
name: <kebab-case, equals the folder name>
description: "<when to use — trigger phrases + when NOT to use>"
version: "<semver>"
updated: "<YYYY-MM-DD>"
---

# <Title>

## Overview
## When to Use            (✅ / ❌ bullets)
## Process / Steps        (numbered steps, ☐ checklists)
## Rules & Constraints    (ALWAYS / NEVER)
## Examples               (Scenario → Wrong → Right)
## Changelog
```

- `name` **must** equal the folder name.
- `description` is the **trigger** — the host reads it to decide activation; write it as "use this when…"
  with concrete phrases and an explicit "Do NOT use for…".
- The body sections above are the house style; keep them in this order.

## 4. Frontmatter schema

| Key | Required | Type | Meaning |
|---|---|---|---|
| `name` | yes | string (kebab-case) | Skill id; equals folder name |
| `description` | yes | string | Activation trigger (when to use / not use) |
| `version` | yes | semver string | Skill maturity (see §5) |
| `updated` | yes | `YYYY-MM-DD` | Date of the last change |

Extra keys are ignored by hosts; these four are the contract for this plugin.

## 5. Versioning (SemVer for skills) & Changelog

| Bump | When |
|---|---|
| patch (`0.1.0→0.1.1`) | Clarified wording, added/fixed an example, tightened a checklist item. No new behavior. |
| minor (`0.1.0→0.2.0`) | New step/section/rule, or a broadened trigger — covers more than before. |
| major (`0.1.0→1.0.0`) | Reworked premise, or a rule reversed (old guidance now wrong). Note the break. |

Every change appends one line to the skill's `## Changelog`, newest on top:

```
- <version> (YYYY-MM-DD) — <what changed> — <why / source>.
```

`version` + `updated` in frontmatter must agree with the top Changelog entry.

## 6. Self-contained & self-improving rules

- **Self-contained:** a skill folder carries everything it needs. No absolute paths or project-only
  filenames in the trigger; supporting detail goes in `skills/<name>/references/*.md`, not elsewhere.
- **Size:** if a `SKILL.md` exceeds ~300 lines, split detail into `references/` and keep `SKILL.md`
  scannable.
- **Self-improving:** new learnings are folded into the right skill **additively** (never rewriting
  validated guidance), with a Changelog entry + version bump, and **pressure-tested** on a subagent
  before being considered done. The discipline is specified by the `meta-skill-self-improve` skill.
- **Project facts** never go into a skill — they belong in agent memory.

## 7. Curation criteria (what belongs here)

A skill qualifies for `kkskills-essentials` only if it is **reusable** (applies beyond one task) and
**generic** (not tied to one person or one project's names/conventions). Skills that fail the generic
test — a personal profile, a private filename scheme — are routed to `kkskills-personal`. (This mirrors
how curated marketplaces keep only broadly-applicable techniques in their core.)

## 8. Directory layout

```
plugins/kkskills-essentials/
├── .claude-plugin/plugin.json     # name, version, description, keywords (skills-only)
├── README.md
└── skills/
    └── <name>/
        ├── SKILL.md
        └── references/            # optional, only when SKILL.md would exceed ~300 lines
docs/kkskills-essentials/
├── CONCEPTS.md                    # concept, usage, catalog
└── SPEC.md                        # this file
```

## 9. Discovery & triggering

- The host discovers a skill by the presence of `skills/<name>/SKILL.md`; no registration needed.
- Activation is driven by the frontmatter `description`. It fires automatically when the situation
  matches, or the user invokes it explicitly from the `/` menu.
- Skills are stateless and independent — adding or removing one never affects another.

## 10. Compatibility

| Surface | Skills available |
|---|---|
| Claude Code (CLI) | ✅ |
| Cowork (desktop) | ✅ via `/` menu |
| Claude Desktop — chat tab | ✅ via `/` menu (skills work in chat; hooks/sub-agents do not, but this plugin has none) |

Plain Markdown + YAML; no runtime, no dependencies.

## 11. Relationship to kkskills-personal

Same marketplace, same format contract and conventions. `kkskills-essentials` is the **generic core**;
`kkskills-personal` holds the **bespoke** skills (a user profile, a dated-filename convention) that a
user is expected to fork and replace. Install either or both. See `docs/kkskills-personal/SPEC.md`.
