# kkskills-essentials

Generic, **project-agnostic working skills** for Claude — a set of `SKILL.md` files that encode
working discipline (how to make changes, how to verify, how to commit) so Claude applies them
consistently across sessions. Skills-only: no MCP server, hooks, or commands.

> These skills come from Ink's personal working library. Some descriptions mention a specific
> codebase as an example trigger; the *rules* they encode are general. Treat them as reference /
> starter skills and edit triggers to fit your own projects.

## Skills

| Skill | What it enforces |
|---|---|
| `feedback-additive-changes` | Prefer additive changes; avoid destructive refactors/deletions unless explicitly scoped. |
| `feedback-migrations-additive-first` | Roll out DB schema changes additive-first across multiple deploys. |
| `feedback-no-duplicate-docs` | Don't spawn new tracking/checklist/TODO docs when one already exists. |
| `feedback-use-full-filenames` | Reference project docs by their full `DDMMYYYY_NAME.md` filename. |
| `feedback-verify-with-real-data` | Verify claims about code/API state against real data before asserting. |
| `reference-clean-architecture` | Where business logic lives, dependency direction, layering for backend services. |
| `reference-conventional-commits` | Conventional Commits format for commit messages, PR titles, changelogs. |
| `user-profile` | Calibrate tone, depth, and delivery style when collaborating with the user. |

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
