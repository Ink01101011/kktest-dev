# kktest-dev

A Claude Code / Cowork **plugin marketplace** by Ink. Developer-grade automation, starting with
memory hygiene.

## Plugins

| Plugin | Description |
|---|---|
| [memory-keeper](./plugins/memory-keeper) | Keep file-based agent memory lean and durable — compact the index, archive done/stale memories to cold storage, lint against a byte budget. Ships a skill, slash commands, a zero-dependency MCP server, and a stdlib CLI. |
| [focus-notify](./plugins/focus-notify) | Focus-aware desktop notifications for Claude Code on macOS, Linux & Windows — notify only when your terminal is *not* the frontmost app. Three kinds (finished, approve, question), each with its own sound, plus click-to-focus. |
| [kkskills-essentials](./plugins/kkskills-essentials) | 15 generic, **self-improving** working skills — feedback discipline, clean-architecture & conventional-commits references, proactive task reminders, secret hygiene, concurrency, MCP authoring, timezone & local-LLM selection, plus a meta-skill that folds new learnings back in (versioned + changelogged). Skills-only. |

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

## License

MIT — see [LICENSE](./LICENSE).
