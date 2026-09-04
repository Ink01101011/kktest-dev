# kkskills-essentials

Generic, **project-agnostic working skills** for Claude — a set of `SKILL.md` files that encode
working discipline (how to make changes, how to verify, how to commit) so Claude applies them
consistently across sessions. Skills-only: no MCP server, hooks, or commands.

> These skills come from Ink's personal working library, kept **generic and project-agnostic**.
> Personal and project-specific skills (a user profile, a private filename convention) live in the
> sibling [`kkskills-personal`](../kkskills-personal) plugin instead, and nine situational skills
> (migrations, clean architecture, secrets, concurrency, timezones, MCP authoring, local-LLM
> selection, verify-with-real-data, the self-improve meta-skill) live in
> [`kkskills-situational`](../kkskills-situational) — correct skills that simply do not come up
> every day, kept behind their own toggle because a skill's `description` costs context in every
> session whether or not it fires.

Every skill carries a `version` and `updated:` in its frontmatter and a `## Changelog` at the end, so
it can be improved over time without drifting. See `meta-skill-self-improve` in
[`kkskills-situational`](../kkskills-situational) for the discipline that folds new learnings back
into the right skill — additively, versioned, and self-contained.

## Skills

**Feedback — working discipline**

| Skill | What it enforces |
|---|---|
| `feedback-additive-changes` | Prefer additive changes; avoid destructive refactors/deletions unless explicitly scoped. |
| `feedback-no-duplicate-docs` | Don't spawn new tracking/checklist/TODO docs when one already exists. |
| `proactive-task-reminders` | Keep a pending-work register; surface deferred items on skip / condition-met / branch-return. |

**Reference — reusable patterns**

| Skill | Provides |
|---|---|
| `reference-conventional-commits` | Conventional Commits format for commit messages, PR titles, changelogs. |

**Workflow — planning & execution**

| Skill | Provides |
|---|---|
| `plan-decompose-orchestrate` | When planning before code: explode each plan item into implement/test/review, orchestrate parallel-vs-sequential, and root-cause (deep-down) any failure. |

## Cross-links to kkskills-situational

`feedback-additive-changes`, `plan-decompose-orchestrate`, and `proactive-task-reminders` cross-link
siblings with `[[skill-name]]`, and some of those siblings now live in
[`kkskills-situational`](../kkskills-situational):

- `feedback-additive-changes` → `[[feedback-migrations-additive-first]]` (×5)
- `plan-decompose-orchestrate` → `[[concurrency-race-conditions]]` (×2), `[[feedback-verify-with-real-data]]` (×2), `[[reference-clean-architecture]]`, `[[timezone-handling]]`
- `proactive-task-reminders` → `[[secret-hygiene]]`

That is 11 link instances across 6 skill pairs, measured.

`[[…]]` is a prose pointer, not a resolved link — nothing dereferences it, so nothing errors when the
other plugin is off. Each skill's own guidance is self-contained; install both plugins if you want
every pointer to name a skill Claude can actually load.

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
full concept, the skill catalog, and how to adapt these to your own projects, and
[`../../docs/kkskills-essentials/SPEC.md`](../../docs/kkskills-essentials/SPEC.md) for the SKILL.md
format contract, versioning, and curation rules.

## License

MIT
