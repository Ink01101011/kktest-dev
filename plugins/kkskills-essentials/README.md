# kkskills-essentials

Generic, **project-agnostic working skills** for Claude — a set of `SKILL.md` files that encode
working discipline (how to make changes, how to verify, how to commit) so Claude applies them
consistently across sessions. Skills-only: no MCP server, hooks, or commands.

> These skills come from Ink's personal working library. Some descriptions mention a specific
> codebase as an example trigger; the *rules* they encode are general. Treat them as reference /
> starter skills and edit triggers to fit your own projects. `user-profile` is a **template** —
> replace it with your own.

Every skill carries a `version` and `updated:` in its frontmatter and a `## Changelog` at the end, so
it can be improved over time without drifting. See `meta-skill-self-improve` for the discipline that
folds new learnings back into the right skill — additively, versioned, and self-contained.

## Skills

**Feedback — working discipline**

| Skill | What it enforces |
|---|---|
| `feedback-additive-changes` | Prefer additive changes; avoid destructive refactors/deletions unless explicitly scoped. |
| `feedback-migrations-additive-first` | Roll out DB schema changes additive-first (expand-contract) across deploys. |
| `feedback-no-duplicate-docs` | Don't spawn new tracking/checklist/TODO docs when one already exists. |
| `feedback-use-full-filenames` | Reference versioned docs by their full, unambiguous (dated) filename. |
| `feedback-verify-with-real-data` | Verify claims about code/API state against real data before asserting. |
| `proactive-task-reminders` | Keep a pending-work register; surface deferred items on skip / condition-met / branch-return. |

**Reference — reusable patterns**

| Skill | Provides |
|---|---|
| `reference-clean-architecture` | Where business logic lives, dependency direction, layering for backend services. |
| `reference-conventional-commits` | Conventional Commits format for commit messages, PR titles, changelogs. |
| `secret-hygiene` | Keep secrets out of repos/logs/CI; rotation-first response to a leak. |
| `concurrency-race-conditions` | Diagnose & prevent races — atomicity, locking, idempotency, live-DB repro harness. |
| `mcp-server-authoring` | Build MCP servers — stdio vs HTTP, tool-schema design, per-host config. |
| `timezone-handling` | Store UTC, convert at edges, IANA/DST, container TZ, market-hours. |
| `local-llm-selection` | Local vs hosted LLM, VRAM/quant sizing, prompt-before-finetune (QLoRA). |

**Meta & template**

| Skill | Provides |
|---|---|
| `meta-skill-self-improve` | The self-update discipline: fold new learnings into the right skill, versioned + changelogged. |
| `user-profile` | *(Template)* Calibrate tone, depth, delivery style — replace with your own profile. |

## Install

```bash
/plugin marketplace add Ink01101011/kktest-dev
/plugin install kkskills-essentials@kktest-dev
```

Once installed, the skills are available to Claude automatically — they trigger on the situations
described in each skill's `description`, or you can invoke one explicitly from the `/` menu.

## How skills work here

Each skill is a folder under `skills/` containing a `SKILL.md` with YAML frontmatter (`name`,
`description` = trigger conditions) and a Markdown body (process, rules, examples). Claude reads the
frontmatter to decide when a skill applies, then follows the body. Nothing to configure.

See [`../../docs/kkskills-essentials/CONCEPTS.md`](../../docs/kkskills-essentials/CONCEPTS.md) for the
full concept, the skill catalog, and how to adapt these to your own projects.

## License

MIT
