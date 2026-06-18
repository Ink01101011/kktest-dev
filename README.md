# kktest-dev

A Claude Code / Cowork **plugin marketplace** by Ink. Developer-grade automation, starting with
memory hygiene.

## Plugins

| Plugin | Description |
|---|---|
| [memory-keeper](./plugins/memory-keeper) | Keep file-based agent memory lean and durable — compact the index, archive done/stale memories to cold storage, lint against a byte budget. Ships a skill, slash commands, a zero-dependency MCP server, and a stdlib CLI. |

## Install

Add the marketplace, then install a plugin:

```shell
/plugin marketplace add YOUR_GH_USERNAME/kktest-dev
/plugin install memory-keeper@kktest-dev
```

(Replace `YOUR_GH_USERNAME` with the GitHub account hosting this repo.) Or from the CLI:

```bash
claude plugin marketplace add YOUR_GH_USERNAME/kktest-dev
claude plugin install memory-keeper@kktest-dev
```

Update later with `/plugin marketplace update kktest-dev`.

## Local development / testing

```bash
git clone [https://github.com/Ink01101011/kktest-dev](https://github.com/Ink01101011/kktest-dev.git)
claude plugin marketplace add ./kktest-dev
claude plugin install memory-keeper@kktest-dev
claude plugin validate ./kktest-dev                 # validate marketplace
claude plugin validate ./kktest-dev/plugins/memory-keeper   # validate the plugin
```

## Docs

- [Concepts, usage & installation](./docs/CONCEPTS.md)
- [Full specification](./docs/SPEC.md)

## License

MIT — see [LICENSE](./LICENSE).
