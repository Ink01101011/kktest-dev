# kkskills-situational

Generic working skills that are **correct but not everyday** — split out of
[`kkskills-essentials`](../kkskills-essentials) so they can be switched on and off as one unit.

> Every installed skill's `description` is loaded into context in **every** session, and Claude Code
> enables or disables whole *plugins*, never individual skills. These nine had not matched a task in
> the measured window, so they live behind one toggle. That is a routing fact, not a quality
> judgement: `secret-hygiene` and `timezone-handling` are exactly right — they just wait for the work
> that needs them.

Turn it on when the work calls for it:

```bash
/plugin install kkskills-situational@kktest-dev
```

## Skills

**Feedback — working discipline**

| Skill | What it enforces |
|---|---|
| `feedback-migrations-additive-first` | Roll out DB schema changes additive-first (expand-contract) across deploys. |
| `feedback-verify-with-real-data` | Verify claims about code/API state against real data before asserting. |

**Reference — reusable patterns**

| Skill | Provides |
|---|---|
| `reference-clean-architecture` | Where business logic lives, dependency direction, layering for backend services. |
| `secret-hygiene` | Keep secrets out of repos/logs/CI; rotation-first response to a leak. |
| `concurrency-race-conditions` | Diagnose & prevent races — atomicity, locking, idempotency, live-DB repro harness. |
| `mcp-server-authoring` | Build MCP servers — stdio vs HTTP, tool-schema design, per-host config. |
| `timezone-handling` | Store UTC, convert at edges, IANA/DST, container TZ, market-hours. |
| `local-llm-selection` | Local vs hosted LLM, VRAM/quant sizing, prompt-before-finetune (QLoRA). |

**Meta**

| Skill | Provides |
|---|---|
| `meta-skill-self-improve` | The self-update discipline: fold new learnings into the right skill, versioned + changelogged, pressure-tested. |

## Cross-links to kkskills-essentials

Several skills here cross-link siblings with `[[skill-name]]`, and some of those siblings stayed in
`kkskills-essentials`:

- `feedback-migrations-additive-first` → `[[feedback-additive-changes]]` (×2)
- `meta-skill-self-improve` → `[[feedback-additive-changes]]` (×2), `[[proactive-task-reminders]]`
- `reference-clean-architecture` → `[[feedback-additive-changes]]`
- `secret-hygiene` → `[[proactive-task-reminders]]` (×2)

That is 9 link instances across 5 skill pairs, measured.

`[[…]]` is a prose pointer, not a resolved link — nothing dereferences it, so nothing errors. Install
both plugins together and every pointer names an available skill; run this one alone and those four
name skills Claude cannot load. Each skill is self-contained regardless.

## Format

Same contract as `kkskills-essentials`: one folder per skill under `skills/`, a `SKILL.md` with YAML
frontmatter (`name`, `description`) plus `version:`/`updated:` and a `## Changelog`. See
[`../../docs/kkskills-essentials/SPEC.md`](../../docs/kkskills-essentials/SPEC.md).

## License

MIT
