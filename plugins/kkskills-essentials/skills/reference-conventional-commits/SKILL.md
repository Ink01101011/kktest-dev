---
name: reference-conventional-commits
description: "Use this skill whenever you're about to write a git commit message, a PR title, or a changelog entry.
  Triggers include: 'commit message', 'commit this', 'write a commit', 'PR title', 'changelog entry', 'how should I name this commit', any `git commit -m` invocation, any PR description that needs a one-line summary.
  Also use when reviewing a draft commit — flag any that don't follow the format.
  Do NOT use for casual chat-level summaries, blog posts, or anything that isn't going into git history."
version: "0.1.0"
updated: "2026-06-19"
---

# Reference — Conventional Commits

## Overview

Commit messages follow the **Conventional Commits 1.0** format: `<type>(<scope>): <subject>` for the subject line, then optionally a body that explains *why*. Subject is imperative, lowercase, under 72 chars, no trailing period. Body wraps at 72 chars and explains the reasoning a `git blame` reader will need years from now.

This unlocks: automated changelog generation, semver bump detection (`feat` → minor, `fix` → patch, `BREAKING CHANGE` → major), clean `git log --oneline` reading.

## When to Use

- ✅ Every commit, in every repo.
- ✅ Every PR title (so squash-merge produces a clean log).
- ✅ Changelog entry summaries.
- ❌ Pure WIP commits on a personal branch that you intend to squash/rebase before merge.

## Process / Steps

### Step 1 — Pick the type

| Type       | When to use                                                          |
|------------|----------------------------------------------------------------------|
| `feat`     | New feature — anything user-visible or new API surface.              |
| `fix`      | Bug fix in existing code.                                            |
| `docs`     | Documentation only — `*.md`, comments, doctrings, examples.          |
| `refactor` | Internal restructure with **no** behavior change. Same in, same out. |
| `test`     | Adding or modifying tests only.                                      |
| `chore`    | Tooling, deps, build config; nothing in `src/` or runtime behavior.  |
| `perf`     | Performance improvement with no functional change.                   |
| `build`    | Changes to build system, package metadata, lockfiles.                |
| `ci`       | CI config only (`.github/`, GitLab CI, etc.).                        |
| `style`    | Whitespace / formatting / lint fix. **Never** logic changes.         |
| `revert`   | Reverts a previous commit. Body must reference the reverted SHA.     |

**Example mapping:**

- Added a new `/api/signal/dismiss` endpoint → `feat`
- Fixed a 500 when `signal_id` is missing → `fix`
- Renamed `helper.py` to `utils.py`, no logic change → `refactor`
- Reformatted with `black` → `style`
- Bumped `typescript` from 5.6 → 5.7 in `package.json` → `chore` (or `build` if it affects bundling)
- Reverted `709c2d5` → `revert: revert "feat(news): add 3-layer dedup"`

### Step 2 — Pick the scope (optional but encouraged)

Scope = the area of the codebase touched. Keep it short, lowercase, single word.

| Codebase shape          | Good scopes                                       |
|-------------------------|---------------------------------------------------|
| Layered backend         | `entities`, `repos`, `use-cases`, `routers`, `migrations` |
| Feature-based monorepo  | feature name — `signal`, `portfolio`, `news`, `auth` |
| Frontend                | `pages`, `components`, `hooks`, area name         |
| Cross-cutting           | `deps`, `ci`, `release`, `docs`, `tooling`        |

Omit the scope if the change is genuinely repo-wide:

```
chore: bump all node deps to v20
```

### Step 3 — Write the subject

Rules:

- ☐ Imperative mood — "add", "fix", "remove", not "added", "fixes", "removing".
- ☐ Lowercase first letter (unless it's a proper noun like `OAuth`, `PostgreSQL`).
- ☐ No trailing period.
- ☐ Aim for ≤ 50 chars, hard limit 72.
- ☐ Describe what the commit *does*, not the file it touched. ("add idempotency key" not "edit signal_router.py").

**Worked examples:**

```
feat(signal): add dismissed_at column + dismiss use case
fix(news): handle empty url_hash on dedup
docs(architecture): add §8 PoC scope to audit
refactor(repos): extract base ORM repo
test(signal): cover dismiss conflict path
chore(deps): bump @modelcontextprotocol/sdk to 1.0.4
build(docker): add multi-stage runtime image
ci: fail PR if import-linter reports new violations
perf(news): batch sentiment enrichment to 50/req
revert: revert "feat(scheduler): switch to APScheduler 4 alpha"
```

### Step 4 — Write the body (when needed)

The body is for *why*, not *what*. The diff already shows what.

Format:

- ☐ Blank line between subject and body.
- ☐ Wrap at 72 chars.
- ☐ Lead with the motivation / context.
- ☐ End with verification or follow-up notes if relevant.
- ☐ Reference issues / PRs by number — `Closes #123`, `Refs #456`.

**Example body:**

```
fix(news): handle empty url_hash on dedup

The 3-layer dedup pipeline (a/b/c) crashed on rows where url_hash is
NULL because layer-c assumed a string. Production migration 25052026
backfills hash but a window of ~6 hours of rows came in before that
backfill, so we still need defensive handling at the layer-c boundary.

Verified by replaying the affected window through the dedup with a
synthetic NULL row — no crash, dedup falls back to layer-b
(title+source).

Closes #142
Refs PR #138 (the backfill migration)
```

### Step 5 — Breaking changes

Two ways to mark:

```
feat(api)!: rename /signal/dismiss to /signal/{id}:dismiss
```

The `!` before the colon flags a breaking change in the subject. **And** include a `BREAKING CHANGE:` footer in the body:

```
feat(api)!: rename /signal/dismiss to /signal/{id}:dismiss

BREAKING CHANGE: the dismiss endpoint moved from a query param to a
path-style action. Clients on v0.5 must update. See migration guide
in docs/UPGRADING.md.
```

### Step 6 — Trailers

- `Co-authored-by: Name <email>` for pair work.
- `Signed-off-by: Name <email>` if the repo requires DCO.
- `Closes #N`, `Fixes #N`, `Refs #N` for issue tracker links.

Trailers go at the very end of the body, blank-line separated.

## Checklist Before `git commit`

- ☐ Subject ≤ 72 chars, imperative, lowercase, no period.
- ☐ Type is one of the allowed set.
- ☐ Scope (if used) is a single short word in lowercase.
- ☐ Body explains *why*, not *what*.
- ☐ Breaking change marked with `!` AND footer.
- ☐ Issue links in trailers, not in the subject.
- ☐ One logical change per commit — if the body has "also" or "and", consider splitting.

## Rules & Constraints

- ALWAYS: subject in imperative mood, lowercase, no period.
- ALWAYS: one logical change per commit.
- ALWAYS: body wraps at 72.
- ALWAYS: mark breaking changes with both `!` and a `BREAKING CHANGE:` footer.
- NEVER: use `style` for logic changes (`style` is whitespace / formatting only).
- NEVER: stuff multiple types into one commit (`feat: add X and fix Y` → split).
- NEVER: write subject in past tense ("added X" — wrong; "add X" — right).
- NEVER: rely on the PR title to convey what the commits don't — squash-merge will eat your commit history.

## Examples

**Wrong:**

```
Updated stuff and fixed some bugs
```

→ No type, no scope, vague subject, past tense, plural change.

**Right:**

```
fix(news): handle empty url_hash on dedup
```

**Wrong:**

```
feat: Implement comprehensive dashboard analytics system with multiple chart types and filtering capabilities for the user interface.
```

→ Subject too long (137 chars), too vague, ends with period.

**Right:**

```
feat(dashboard): add filterable analytics charts

Adds line / bar / candle chart components with a date-range and
symbol-filter sidebar. Charts read from the new /analytics endpoint
introduced in #128. Replaces the static png export that used to live
on the home page.

Closes #129
```

**Wrong (mixing types):**

```
feat: add signal dismiss + fix typo in README
```

**Right (split into two commits):**

```
feat(signal): add dismiss use case
docs: fix typo in README quick-start
```

## Changelog

- 0.1.0 (2026-06-19) — initial version, vendored into kktest-dev/kkskills-essentials.
