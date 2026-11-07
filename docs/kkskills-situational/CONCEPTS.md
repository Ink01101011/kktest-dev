# kkskills-situational — Concepts & Usage

The skill list is in the [plugin README](../../plugins/kkskills-situational/README.md). The full catalog,
with what each skill does, is shared with its sibling in
[docs/kkskills-essentials/CONCEPTS.md](../kkskills-essentials/CONCEPTS.md). The formal contract is in
[SPEC.md](./SPEC.md).

## Why a separate plugin

Every installed skill's `description` is in context in every session, and Claude Code turns whole
plugins on and off, never single skills. So skills that are correct but not needed every day sit behind
one toggle here, instead of costing context in [kkskills-essentials](../kkskills-essentials/CONCEPTS.md).

Nine of the ten moved because they had not matched a task in the measured window. That is a routing
fact, not a quality judgement. The tenth, `plan-decompose-orchestrate`, moved (in 0.2.0) because it
overlaps superpowers' planning skills, so it is opt-in.

## When to turn it on

```
/plugin install kkskills-situational@kktest-dev
```

Turn it on for work that needs it: a schema migration, a secrets review, concurrency bugs, an MCP server,
timezone code, picking a local LLM, or a multi-step plan you want decomposed. Turn it off again when
done, if you like.

## Works best with essentials

Five of these skills point at skills in kkskills-essentials with `[[name]]` (for example
`[[feedback-additive-changes]]`). These are prose pointers; nothing breaks without essentials, but the
pointer then names a skill Claude cannot load. Install both for the full set.

## Other tools

All ten skills are portable (`npx kktest-dev`, tier "portable").
