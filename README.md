# kktest-dev

A Claude Code / Cowork **plugin marketplace** by Ink. Developer-grade automation, starting with
memory hygiene.

## Plugins

| Plugin | Description |
|---|---|
| [memory-keeper](./plugins/memory-keeper) | Keep file-based agent memory lean and durable — compact the index, archive done/stale memories to cold storage, lint against a byte budget. Ships a skill, slash commands, a zero-dependency MCP server, and a stdlib CLI. |
| [focus-notify](./plugins/focus-notify) | Focus-aware desktop notifications for Claude Code on macOS, Linux & Windows — notify only when your terminal is *not* the frontmost app. Three kinds (finished, approve, question), each with its own sound, plus click-to-focus. |
| [kkskills-essentials](./plugins/kkskills-essentials) | 13 generic, **self-improving** working skills — feedback discipline, clean-architecture & conventional-commits references, proactive task reminders, secret hygiene, concurrency, MCP authoring, timezone & local-LLM selection, plus a meta-skill that folds new learnings back in (versioned + changelogged). Skills-only. |
| [kkskills-personal](./plugins/kkskills-personal) | Personal / project-specific skills split out from essentials — a user-profile calibration skill and a dated-filename reference convention. Fork and replace the specifics with your own. Skills-only. |
| [loop-ledger](./plugins/loop-ledger) | A guardrail for agent loops — a deterministic state machine (budget + stall-hash + exit predicate) that decides should-continue per iteration, plus an opt-in Stop hook that enforces it so the agent can neither quit early nor spin forever. Zero-dependency MCP server. |
| [reflexion](./plugins/reflexion) | Self-improving agent memory built on memory-keeper — recall matching lessons before a task, reflect a new lesson after it, browse the error/success library, and compress recurring lessons into higher-level patterns. |
| [critique-gate](./plugins/critique-gate) | A quality brake for agent output — generate, critic scores against a rubric, rewrite, re-score, wired to loop-ledger's retry-count backstop. Four modes: score-retry, multi-critic, adversarial, judge-ensemble. Skills-only, no new server. |
| [prompt-evolve](./plugins/prompt-evolve) | Evolve a prompt against a test set — run it, score every output, rewrite the prompt from its failures, repeat. Deterministic scorers (exact-match/regex/schema) plus a fully offline verification loop; stdlib CLI + skill, no model calls of its own. |
| [agent-loops](./plugins/agent-loops) | Playbook for the 5 categories of agent loop design patterns (Quality, Memory, Planning, Exploration, System Optimization) — when to use each, its minimal shape, and the exact `loop-ledger` brake to wire. Plus a `loop-selector` router skill. Skills-only; pairs with `loop-ledger` for enforcement. |

Together with `loop-ledger` and `memory-keeper`, these plugins complete the "self-improvement chain" —
see [docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md](./docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md) for
how they wire together (no new plugin needed — it's a composition of the ones above).

## Install

Add the marketplace, then install a plugin:

```shell
/plugin marketplace add https://github.com/Ink01101011/kktest-dev
/plugin install memory-keeper@kktest-dev
```

Or from the CLI:

```bash
claude plugin marketplace add https://github.com/Ink01101011/kktest-dev
claude plugin install memory-keeper@kktest-dev
```

Update later with `/plugin marketplace update kktest-dev`.

## Local development / testing

```bash
git clone https://github.com/Ink01101011/kktest-dev.git
claude plugin marketplace add ./kktest-dev
claude plugin install memory-keeper@kktest-dev
claude plugin validate ./kktest-dev                 # validate marketplace
claude plugin validate ./kktest-dev/plugins/memory-keeper   # validate the plugin
```

## Docs

Per-plugin guides live under [`docs/`](./docs), one folder per plugin.

**memory-keeper**

- [Concepts, usage & installation](./docs/memory-keeper/CONCEPTS.md)
- [Full specification](./docs/memory-keeper/SPEC.md)
- [Where it runs & the two meanings of "compact"](./docs/memory-keeper/RUNTIMES.md)

**focus-notify**

- [Concepts, usage & installation](./docs/focus-notify/CONCEPTS.md)
- [Full specification](./docs/focus-notify/SPEC.md)

**kkskills-essentials**

- [Concepts, usage & the skill catalog](./docs/kkskills-essentials/CONCEPTS.md)
- [Specification](./docs/kkskills-essentials/SPEC.md)

**kkskills-personal**

- [Concepts & usage](./docs/kkskills-personal/CONCEPTS.md)
- [Specification](./docs/kkskills-personal/SPEC.md)

**loop-ledger**

- [Concepts, usage & installation](./docs/loop-ledger/CONCEPTS.md)
- [Specification](./docs/loop-ledger/SPEC.md)

## License

MIT — see [LICENSE](./LICENSE).
