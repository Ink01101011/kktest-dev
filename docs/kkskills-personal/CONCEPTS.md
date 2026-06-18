# kkskills-personal — Concepts & Usage

`kkskills-personal` holds the **non-generic** working skills — the ones tied to a specific person or a
specific project's conventions. They were split out of `kkskills-essentials` so that the essentials
plugin can honestly claim to be project-agnostic.

## Why these are separate

A reusable skill library has a curation bar: a skill should help on *any* project, not just yours.
Measured against that bar (the same standard marketplaces like `obra/superpowers` apply — they ship only
broadly-applicable techniques and keep personal/esoteric ones out of core), two skills didn't belong in
`essentials`:

- **`user-profile`** — encodes one person's tone/depth/delivery preferences. Personalization is valuable
  but it isn't a *reusable technique*; it's a profile to be replaced per user.
- **`feedback-use-full-filenames`** — enforces a private `DDMMYYYY_NAME.md` doc-naming convention. That's
  a project convention, not a general best practice.

Keeping them here means: `essentials` stays clean and shareable, and you opt into the personal set only
if you want it.

## The skills

### `user-profile` (template)

Calibrate how you collaborate with a specific person — language register, response length, what to skip
(no recap, no fluff), when to just execute vs. when to ask. The **structure** (detect register → compose
→ close cleanly) is reusable; the **specifics** are an example. To adopt it, replace the Overview and
examples with your own profile.

### `feedback-use-full-filenames`

Reference versioned project docs by their full, unambiguous filename on first mention (e.g.
`27052026_ARCHITECTURE_AUDIT.md`, then a short alias). Useful when your project layers dated versions of
docs side by side. If you don't date docs, the general principle — *reference docs unambiguously* — still
applies; adapt the trigger to your own scheme or skip the skill.

## Adapting to yourself

1. Install the plugin, then edit each `SKILL.md` in place — these are yours to rewrite.
2. Replace `user-profile`'s Overview/examples with your own preferences.
3. Replace or generalize the filename convention in `feedback-use-full-filenames`.
4. Record changes in each skill's `## Changelog` and bump its `version` (see
   `kkskills-essentials`' `meta-skill-self-improve`).

## Relationship to kkskills-essentials

Same marketplace, same conventions (versioned, changelogged, self-contained skills). `essentials` is the
generic core; `personal` is the bespoke layer. Install one or both.
