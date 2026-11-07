# kkskills-situational — Specification

Checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).

## 1. Format

The same contract as kkskills-essentials: one folder per skill under `skills/`, a `SKILL.md` with YAML
frontmatter (`name`, `description`, `version`, `updated`) and a `## Changelog`. Versioning and the
self-improve rules are in [docs/kkskills-essentials/SPEC.md](../kkskills-essentials/SPEC.md). Skills
only: no server, hook, script or command.

## 2. Skills (10)

| Skill | Kind |
|---|---|
| `feedback-migrations-additive-first` | feedback |
| `feedback-verify-with-real-data` | feedback |
| `reference-clean-architecture` | reference |
| `secret-hygiene` | reference |
| `concurrency-race-conditions` | reference |
| `mcp-server-authoring` | reference |
| `timezone-handling` | reference |
| `local-llm-selection` | reference |
| `plan-decompose-orchestrate` | reference (moved from kkskills-essentials in 0.2.0) |
| `meta-skill-self-improve` | meta |

## 3. Curation boundary

A skill belongs here when it is generic (not tied to one person or project) and correct, but not needed
in most sessions, or when it overlaps a widely used plugin and so should be opt-in. Everyday skills go
to kkskills-essentials; personal ones to kkskills-personal.

## 4. Cross-links

Cross-links use `[[skill-name]]` in prose. They are not resolved by any tool. Links to skills in
kkskills-essentials (`feedback-additive-changes`, `proactive-task-reminders`) come from five skills:
`feedback-migrations-additive-first`, `meta-skill-self-improve`, `plan-decompose-orchestrate`,
`reference-clean-architecture`, `secret-hygiene`.

## 5. Other tools

Tier "portable": every skill exports as is (`npx kktest-dev export|install`).
