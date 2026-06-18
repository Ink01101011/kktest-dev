# kkskills-personal — Specification

Status: 0.1.0 · Date: 2026-06-19 · Author: Ink

## 1. Problem

Some working skills are genuinely useful but **not generic** — they encode one person's collaboration
preferences or one project's private conventions. Shipping them inside a "project-agnostic" library
(`kkskills-essentials`) would break that promise and mislead anyone who installs it. They still deserve a
home with the same format and self-improvement discipline — just curated separately and clearly marked as
"fork before use."

## 2. Goals & non-goals

**Goals**
- Hold the **personal / project-specific** skills split out of `kkskills-essentials`.
- Keep them to the same `SKILL.md` format contract, versioning, and Changelog discipline.
- Make it explicit that each skill is a **starting point to fork**, not a universal default.

**Non-goals**
- Not generic — do not treat these as project-agnostic.
- No MCP/hooks/commands — **skills-only**, like the essentials plugin.
- Not a dumping ground — a skill lands here only because it's personal/project-bound, not because it's
  low quality.

## 3. Format contract

Identical to `kkskills-essentials` — see `docs/kkskills-essentials/SPEC.md` §3–§6 for the full
`SKILL.md` frontmatter schema (`name`, `description`, `version`, `updated`), body structure, SemVer-for-
skills, Changelog format, and the self-contained / self-improving rules. Skills here carry the same
frontmatter and `## Changelog`.

## 4. Curation boundary (what belongs here)

A skill belongs in `kkskills-personal` (not `essentials`) when it depends on something a generic user
would have to replace:

- **A specific person** — preferences, tone, language register (e.g. `user-profile`).
- **A specific project's convention** — a private filename scheme, directory layout, or naming rule
  (e.g. `feedback-use-full-filenames`'s `DDMMYYYY_NAME.md`).

If, after stripping the person/project specifics, a skill would still be useful to everyone, it belongs
in `essentials` instead.

## 5. Skills

| Skill | Personal/project dependency | How to adapt |
|---|---|---|
| `user-profile` | One person's tone/depth/delivery preferences | Replace the Overview + examples with your own profile; keep the structure (detect register → compose → close) |
| `feedback-use-full-filenames` | A dated `DDMMYYYY_NAME.md` doc convention | Swap in your own doc-naming scheme, or drop the skill if you don't version docs by filename |

Both are marked as templates in their bodies and carry `version`/`updated`/`Changelog` like every other
skill in the marketplace.

## 6. Fork / replace workflow

1. Install the plugin, then edit each `SKILL.md` in place — these are yours to rewrite.
2. Replace the person/project specifics with your own.
3. Record the change in the skill's `## Changelog` and bump its `version` (per the SemVer-for-skills
   rules in the essentials SPEC).
4. Optionally rename the skill folder + `name` if its scope changed (keep them equal).

## 7. Directory layout

```
plugins/kkskills-personal/
├── .claude-plugin/plugin.json
├── README.md
└── skills/
    ├── user-profile/SKILL.md
    └── feedback-use-full-filenames/SKILL.md
docs/kkskills-personal/
├── CONCEPTS.md
└── SPEC.md                         # this file
```

## 8. Relationship to kkskills-essentials

Same marketplace (`kktest-dev`), same conventions. `essentials` is the generic core that anyone can use
unmodified; `personal` is the bespoke layer meant to be forked. The split keeps `essentials`' "project-
agnostic" claim honest. See `docs/kkskills-essentials/SPEC.md`.
