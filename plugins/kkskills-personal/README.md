# kkskills-personal

**Personal / project-specific** working skills, intentionally kept separate from
[`kkskills-essentials`](../kkskills-essentials) (which is generic and project-agnostic). The skills here
encode *one person's* preferences and *one project's* conventions — they are starting points to fork,
not universal defaults.

## Why a separate plugin?

`kkskills-essentials` promises project-agnostic skills. A personal collaboration profile and a private
filename convention don't meet that bar — they're useful, but only after you replace the specifics with
your own. Splitting them out keeps `essentials` clean and lets you install the personal set only if you
want it.

## Skills

| Skill | What it is | Adapt by |
|---|---|---|
| `user-profile` | Calibrate tone, depth, and delivery style for a specific person | Replacing the Overview + examples with your own profile |
| `feedback-use-full-filenames` | Reference versioned docs by their full dated filename (`DDMMYYYY_NAME.md`) | Swapping in your own doc-naming convention (or skip if you don't date docs) |

## Install

```bash
/plugin marketplace add Ink01101011/kktest-dev
/plugin install kkskills-personal@kktest-dev
```

Both skills carry `version` + `updated:` frontmatter and a `## Changelog`, and follow the
self-improvement discipline from `kkskills-essentials`' `meta-skill-self-improve`.

See [`../../docs/kkskills-personal/CONCEPTS.md`](../../docs/kkskills-personal/CONCEPTS.md).

## License

MIT
