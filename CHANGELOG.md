# Changelog

## 1.0.0

First release as an npm package (`kktest-dev`) as well as a Claude Code plugin marketplace.

- **kktestdev-pack** (PR #12): team onboarding pack. `/kk-onboard` inventories what is already
  installed or connected, installs only the missing items you pick, and audits redundancy and risk;
  `/kk-update` pulls the latest of everything the pack manages.
- **infographic-diagram** plugin: architecture, layer-stack and tech-stack diagrams as SVG (+ 2x PNG)
  from a JSON spec, with a layout lint pass and Thai text support. Spec values are validated before
  they reach SVG attributes, and the PNG step renders in a sandboxed browser page.
- **Cross-provider export and installer**: `kktest-dev list | export | install` brings the skills
  and the loop-ledger, memory-keeper and reflexion MCP servers to Codex, Gemini CLI, GitHub Copilot,
  Cursor, Claude Desktop, claude.ai and ChatGPT. `install` is a dry run by default; with `--apply` it
  backs up every file it touches, merges instead of overwriting, and refuses collisions, JSON with
  comments, and TOML it cannot read safely. See [docs/providers.md](./docs/providers.md).
- Skills: additive `metadata.short-description` (≤ 200 chars) for the 11 skills with long
  descriptions, and short "Other agents" fallback notes where a skill names Claude-only tools.
  Behaviour on Claude Code is unchanged.
- reflexion: `reflexionctl.py` also finds a `memctl.py` bundled next to it (exported layout).
- **npm package** `kktest-dev` 1.0.0: zero runtime dependencies, Node 22 or later.
