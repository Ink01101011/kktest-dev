# kkskills-essentials — Concepts, Usage & the Skill Catalog

A complete guide to the `kkskills-essentials` plugin: what it is, how skills work, the full catalog of
shipped skills, how to use them, and how to adapt them to your own projects.

---

## 1. The concept

A **skill** is a reusable instruction packet — a folder with a `SKILL.md` file — that teaches Claude
*when* to do something and *how* to do it. Instead of re-explaining your working conventions every
session ("prefer additive changes", "use conventional commits", "verify before you claim"), you
encode them once as skills, and Claude applies them automatically whenever the situation matches.

`kkskills-essentials` bundles a set of **generic, project-agnostic** working skills — the kind that
apply to most software projects regardless of stack. It is **skills-only**: no MCP server, no hooks,
no slash commands. Installing it simply makes these skills available to Claude.

> Origin: these come from Ink's personal Claude skill library (the `claude-mcp-kkskills` repo, which
> also ships a standalone MCP server for serving skills over stdio/HTTP). Only the generic plugin
> skills are vendored here; the MCP server and project-specific skills are intentionally left out.

---

## 2. How a skill works

Each skill folder contains a `SKILL.md` with two parts:

```markdown
---
name: reference-conventional-commits
description: "Use this skill whenever you're about to write a git commit message, a PR title,
  or a changelog entry. Triggers include: ..."
---

# Reference — Conventional Commits

## Overview
... process, rules, examples ...
```

- **Frontmatter `description`** = the *trigger*. Claude reads it to decide whether the skill applies
  to the current task. Good descriptions list concrete trigger phrases and when *not* to fire.
- **Body** = the *playbook*. Once triggered, Claude follows the process, rules, and examples.

There is nothing to wire up — drop the folder under `skills/` and the host picks it up.

---

## 3. The skill catalog

Fifteen skills, grouped by role.

### `feedback-*` — working discipline

| Skill | Enforces | Fires when |
|---|---|---|
| `feedback-additive-changes` | Prefer additive changes; don't do destructive refactors/deletions unless explicitly scoped | Proposing a refactor, cleanup, deletion, or migration |
| `feedback-migrations-additive-first` | DB schema changes roll out additive-first (expand-contract) across deploys | Writing or reviewing a schema migration |
| `feedback-no-duplicate-docs` | Don't create a new tracking/checklist/TODO/audit doc when one already exists | About to spin up a new tracking document |
| `feedback-use-full-filenames` | Reference versioned docs by full, unambiguous (dated) filename | Citing a versioned doc in chat |
| `feedback-verify-with-real-data` | Verify claims about code/API state against real data before asserting | About to make a factual claim about codebase or API behavior |
| `proactive-task-reminders` | Keep a pending-work register; resurface deferred items at the right moment | Deferring work, hitting a fork, pausing, or resuming a project |

### `reference-*` and patterns — reusable engineering references

| Skill | Provides |
|---|---|
| `reference-clean-architecture` | Where business logic lives, dependency direction, and layering for a backend service |
| `reference-conventional-commits` | Conventional Commits format for commit messages, PR titles, and changelogs |
| `secret-hygiene` | Keep secrets out of repos/logs/CI; rotation-first response to a leak |
| `concurrency-race-conditions` | Diagnose & prevent races — atomicity, locking, idempotency, live-DB repro harness |
| `mcp-server-authoring` | Build MCP servers — stdio vs HTTP, tool-schema design, per-host config |
| `timezone-handling` | Store UTC, convert at edges, IANA/DST, container TZ, market-hours |
| `local-llm-selection` | Local vs hosted LLM, VRAM/quant sizing, prompt-before-finetune (QLoRA) |

### meta & template

| Skill | Provides |
|---|---|
| `meta-skill-self-improve` | The self-update discipline — fold new learnings into the right skill, versioned + changelogged |
| `user-profile` | *(Template)* Calibrate tone, depth, delivery style — replace the specifics with your own |

> Note: a few skills name a specific codebase ("trader-platform") in examples. The underlying rules are
> general — adjust example wording when adapting to your projects. `user-profile` is explicitly a
> template to overwrite.

---

## 3b. Skills that get better over time (self-update)

Every skill in this plugin is a **living document**:

- **`version` + `updated:` in frontmatter** track each skill's maturity (SemVer for skills — patch =
  clarify/example, minor = new step/section, major = reworked premise).
- **A `## Changelog` at the end** records every change (date — what — why/source). Self-contained
  history lives inside the skill, not in a separate file.
- **`meta-skill-self-improve`** is the discipline that drives it: when you discover a new method, step,
  edge case, or concept during real work, you fold it into the right skill **additively**
  (see `feedback-additive-changes`), add a Changelog line, and bump the version. If a skill grows past
  ~300 lines, its detail moves to `references/*.md` **inside the same folder**, keeping it
  self-contained. Project-specific facts go to memory, not skills.

The result: the library compounds — each expensive lesson is captured once and reused forever.

---

## 4. Usage

```bash
/plugin marketplace add Ink01101011/kktest-dev
/plugin install kkskills-essentials@kktest-dev
```

After install:

- **Automatic** — each skill triggers on the conditions in its `description`. You don't call them by
  name; Claude applies the relevant one when the situation arises.
- **Explicit** — open the `/` menu (in chat or Cowork) and pick a skill to invoke it directly.

Skills work across Claude Code, Cowork, and the Claude Desktop chat tab (skills are supported in all
three).

---

## 5. Adapting to your own projects

These are starter skills, not gospel. To make them yours:

1. Edit a skill's `description` so its triggers match your repos and conventions.
2. Edit the body's rules/examples to reflect how *your* team works.
3. Add new skills by creating `skills/<name>/SKILL.md` with the same frontmatter shape.
4. Remove any skill you don't want — they're independent.

Because skills are plain Markdown under git, every change is diffable and reviewable.

---

## 6. What was intentionally left out

When this plugin was merged into `kktest-dev`, two parts of the source repo were **not** brought in:

- **The TypeScript MCP server** (`mcp-server/`, Docker + CI) — a separate deployable for serving
  skills over stdio/HTTP, not part of the plugin. `kktest-dev` stays a clean plugin marketplace.
- **Project-specific skills** (e.g. `project-trader-platform`, `reference-trader-platform-layout`) —
  the plugin ships only the generic, reusable set.
