# Changelog

## 1.1.0

Every commit on `release/1.1.0` since 1.0.0 (`997c209`), grouped. The npm package version is set by
the release step.

- **kktestdev-pack 0.2.0: dedupe and routing** (ea6e937, #14-#18). `chrome-devtools` moved from
  core to frontend; `playwright` is the core browser tool (#14). Planning routing: superpowers for a
  plan that fits one session, bantamkit shiftwork for units that fan out agents (#15). `serena`
  removed; a `code-nav` overlap group reports one you installed yourself (#16). The built-in
  `/code-review` is the default diff review (#17). Next.js docs: `next-devtools` while a dev server
  runs, `context7` otherwise (#18). The routing table lives in the pack README and the kk-onboard
  SKILL, checked by a test.
- **jdtls needs Java 25+** (358cd92, b3cee36, #21). jdtls 1.63 fails on Java 17/21, and its wrapper
  prefers `$JAVA_HOME`. The inventory now works out the Java jdtls will start on and notes when it is
  older than 25 (`requires[].java` in `pack.json`).
- **First real `/kk-onboard` run, gaps fixed** (b4cd6a3, b3cee36, #21). A fresh account's
  "No MCP servers configured" is an empty list, not an unknown format. `options --diff` shows plugin
  version changes. Read-only host files are never offered as write targets. bantamkit hooks: check
  `--install-hooks` without `--yes` first (exit 2 = changes pending), show the plan, back up settings,
  then apply only after a yes. New risk finding `node-version-path`: an MCP server or hook that runs
  from a mise/nvm/fnm/asdf/Volta node version that is gone or not active; `/kk-update` re-checks hooks
  after updates. New `onboard-e2e.test.mjs` and the owner checklist [docs/kk-onboard-e2e.md](./docs/kk-onboard-e2e.md).
- **Secret redaction: eight known gaps closed** (50273f3, 5ba8e54, #19; more in the release gate fixes
  below). Redaction is best effort over known shapes, not a guarantee that every secret is masked. Redaction moved to
  `redact.mjs`. Now masked: `-p VALUE` after password-taking commands, `PGPASSWORD=x`, a glued
  `-pX` (ports and flag bundles exempt), escaped JSON keys, schemeless `user:S@host`, `KEY = value`
  with spaces, unquoted numbers, single-quoted keys. Nothing the old code masked leaks now (6195
  cases). A linear-time test guards against slow regexes (made robust on shared CI runners).
- **More hosts and package managers** (64070df, #22). The inventory also reads Claude Code
  `managed-mcp.json` and the MCP servers of enabled plugins, Gemini CLI extensions, VS Code Insiders,
  VSCodium, profiles and Flatpak/Snap builds, Microsoft Store Claude Desktop, and the Windows-side
  configs from inside WSL. Global folders of pnpm, yarn, bun, Volta and mise are found without
  running a package manager. Overlap groups get an optional `with` rule, and a plugin, its servers and
  its skills count as one tool.
- **Windows CI** (47dd777, #20; the windows-latest cells were red on one test until the gate fix below,
  so re-check the matrix on the release commit). CI runs the inventory on an empty fake HOME on every OS and an opt-in
  MCP `initialize` smoke test on Windows. New Windows tests (junctions, `taskkill /T`, `cmd /c` step
  shapes, WSL, `CLAUDE_CONFIG_DIR`). [docs/windows.md](./docs/windows.md) lists every POSIX-only skip
  with what protects that path, kept in step by a test.
- **CLI provider targets re-verified, npm publish workflow** (f38ac41, #24). The Windsurf/Devin user
  config on Windows is `%APPDATA%\devin\mcp_config.json` (was `~/.config/devin`). Export notes give the
  documented ChatGPT API and claude.ai limits. `.github/workflows/publish.yml` publishes on a `v*` tag
  (tag must match `package.json`, all suites run, `npm publish --provenance`), or runs a manual dry
  run. It needs an `NPM_TOKEN` secret.
- **Clean-code items from the release gates** (4cd45a0, #23). `tools/lib/providers.mjs` is the one
  provider table the CLI reads, and a test keeps `docs/providers.md` in step with it (CLI output
  unchanged). infographic-diagram's long render functions split, with golden SVG hashes unchanged.
  `pack.schema.json` for `pack.json`. `ctx.run`/`ctx.runClaude` renamed `ctx.exec`/`ctx.execClaude`.
  Global copies from pnpm, yarn, bun, Volta and mise count as trusted when reading options.
- **Docs synced with the code** (#25). New concepts and specification pages for agent-loops,
  critique-gate, prompt-evolve, reflexion, infographic-diagram, kkskills-situational, kktestdev-pack and
  tool-metrics. `docs/proposals/` and `docs/superpowers/` marked historical. memory-keeper and reflexion
  docs say they were folded into bantamkit. `ADD_PLUGIN.md` covers `TIERS`, `package.json` files, docs
  and CI. ChatGPT: custom GPTs are being retired, so knowledge files are not a target; what is and is
  not verified is in [docs/providers.md](./docs/providers.md). The Windsurf help text says what is
  still unverified. agent-loops' memory and system-optimization skills say what bantamkit and
  prompt-evolve now serve. Plugin homepages point at `tree/master`. The pack README's options and audit
  sections point to one place instead of repeating the SKILL, and a test keeps its publisher table in
  step with `pack.json`.

- **Release gate fixes** (G1 review, G2 pentest).
  - Windows CI: the `#22` env-var test built Windows paths but checked them with Linux rules; it now
    uses the host's rules, and a win32 simulation pins why.
  - The Java probe never runs a `java` given by a relative path or lying inside the current project
    (`JAVA_HOME`, the jdtls wrapper default, `java` on PATH): a cloned repo could set `JAVA_HOME` and
    ship `bin/java`. The version is read from the JDK's `release` file first, with no process at all.
  - Redaction: numbered and plural secret names (`TOKEN2`, `SECRETS`, `API_KEYS`), `PASSPHRASE`,
    `JWT`, `CREDS`, `dbpass` and the key-material `*_KEY` names (`SSH_KEY`, `SIGNING_KEY`,
    `ENCRYPTION_KEY`, `SESSION_KEY`, `LICENSE_KEY`, `APP_KEY`); a secret `--flag VALUE` inside a quoted
    command (`bash -c "notify --api-key X"`, which leaked into hook findings); npm, Hugging Face,
    PyPI, Slack app, Google `ya29.`, SendGrid, Shopify, Linear, Figma, Perplexity and DigitalOcean
    tokens; Slack/Discord/Telegram webhook URLs; PEM private key blocks; `<password>X</password>`.
    Counts stay readable (`max_tokens`, `tokens: 1200`). Diffed old vs new: 0 new leaks on the 6195-case
    corpus, the 547 curated cases and the gate's fuzz harnesses (200k+ random cases).
  - Host reads: a plugin's `mcpServers` path that leaves the plugin through a linked folder, a FIFO
    as a config file (the scan hung), and a linked Windows-side config seen from WSL are no longer
    read. `--run-help` never picks a package-manager global copy that is a link out of its folder.
  - `publish.yml`: the tagged commit must be on master (`git merge-base --is-ancestor` against
    `origin/master`), and a registry lookup that fails for any reason other than "not found" stops the
    run instead of publishing. docs/providers.md asks the owner to give the `npm-publish` environment
    required reviewers and a `v*` tag rule.
  - Smaller: kk-update backs settings up with `cp -p` (keeps mode 0600); infographic-diagram 0.1.1
    (its render scripts were split in #23); the prompt-evolve SKILL links the spec by URL (the
    relative link did not resolve inside an installed plugin); no tracked file cites the ignored
    `.shiftwork` folder.

### Owner checks still open

- **`npm-publish` environment protection**: required reviewers and a deployment rule for `v*` tags
  (docs/providers.md, "Releasing"). Anyone who can push a tag can otherwise start the publish job.

- **Windows "Connected" check on a real machine** (#20): register the pack's MCP servers through
  Claude Code with `cmd /c` and see "Connected". CI covers launch and `initialize` only. Checklist in
  [docs/windows.md](./docs/windows.md).
- **A real fresh-account run** of `/kk-onboard` (#21): needs a new macOS user, login and network.
  Checklist in [docs/kk-onboard-e2e.md](./docs/kk-onboard-e2e.md).
- **Paths that are reasoned, not documented** (#22): the Microsoft Store (MSIX) Claude Desktop config
  path and the per-profile VS Code `mcp.json` name. A Store install on Windows and a VS Code profile
  would confirm them.
- **bantamkit `--install-hooks` with an old hook entry** (#21): not confirmed whether it replaces an
  entry that points at an old path or adds a second one. The docs only claim the check exits 2 and
  shows the new command.
- **npm publish**: pushing tag `v1.1.0` runs `publish.yml`; without the `NPM_TOKEN` secret the run fails
  and nothing is uploaded (publish by hand, and the workflow then skips that version).

## 1.0.0

First release as an npm package (`kktest-dev`) as well as a Claude Code plugin marketplace.

- **kktestdev-pack** (PR #12): team onboarding pack. `/kk-onboard` inventories what is already
  installed or connected, installs only the missing items you pick, and audits redundancy and risk;
  `/kk-update` pulls the latest of everything the pack manages.
  `/kk-onboard` also reads Codex CLI (`config.toml`, `CODEX_HOME`) and Gemini CLI (`settings.json`)
  MCP configs, with a read-only TOML reader that refuses what it cannot parse; values never leave it.
- **infographic-diagram** plugin: architecture, layer-stack and tech-stack diagrams as SVG (+ 2x PNG)
  from a JSON spec, with a layout lint pass and Thai text support. Spec values are validated before
  they reach SVG attributes, and the PNG step renders in a sandboxed browser page.
- **Cross-provider export and installer**: `kktest-dev list | export | install` brings the skills
  and the loop-ledger, memory-keeper and reflexion MCP servers to Codex, Gemini CLI, GitHub Copilot,
  Cursor, Claude Desktop, claude.ai and ChatGPT. `install` is a dry run by default; with `--apply` it
  backs up every file it touches, merges instead of overwriting, and refuses collisions, JSON with
  comments, and TOML it cannot read safely. See [docs/providers.md](./docs/providers.md).
- Skills: additive `metadata.short-description` (≤ 200 chars) for the 13 skills with long
  descriptions, and short "Other agents" fallback notes where a skill names Claude-only tools.
  Behaviour on Claude Code is unchanged.
- reflexion: `reflexionctl.py` also finds a `memctl.py` bundled next to it (exported layout).
- **npm package** `kktest-dev` 1.0.0: zero runtime dependencies, Node 22 or later.
