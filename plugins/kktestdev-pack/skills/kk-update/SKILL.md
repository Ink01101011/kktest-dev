---
name: kk-update
description: Use when the user asks to update the team pack, "kk-update", "อัปเดต pack", "update plugins/MCP to latest", or when bantamkit's session header says the install is behind. Pulls the latest of everything kktestdev-pack manages and reports versions before and after.
---

# kk-update: pull the latest of everything in the pack

Team policy: **never pin versions** (`../kk-onboard/pack.json` → `policy`). This skill moves every
pack-managed component to its latest release and shows what changed. It only updates what is
already installed. It never installs new items (that is `/kk-onboard`).

Updates run code from npm, GitHub and other registries with the user's permissions, so the
skill **shows the full command list and asks once** before running anything. Expect a few
minutes: every step is network-bound.

## Running commands

- Give each command its own timeout (about 120 s; 300 s for `npm i -g` and `go install`). If one
  fails or times out, record the error and **continue with the rest**; report all failures at
  the end.
- Never use `sudo`. On EACCES (or EPERM on Windows) from `npm i -g`, show the error and suggest a
  user-owned Node: a version manager (mise, nvm, nvm-windows, fnm, volta) or
  `npm config set prefix ~/.npm-global` and adding its `bin` to PATH.

## Steps

1. **Snapshot "before"**: `claude plugin list --json` (keep `id` + `version`),
   `npm ls -g --depth=0 --json` (keep the packages from step 4).

2. **Build the command list** from what is installed, then ask once ("run these N commands?"):
   - Marketplaces: `claude plugin marketplace update <name>` for each marketplace in
     `pack.json` → `marketplaces` that is added (`claude plugin marketplace list --json`). Other
     marketplaces are not the pack's to touch; mention that
     `claude plugin marketplace update` with no name updates all of them.
   - Plugins: for each installed plugin whose id equals an item's **`plugin`** value in
     `pack.json`, `claude plugin update <plugin>`. Leave other plugins alone; mention that
     `claude plugin update <id>` works for them too.
   - Global npm packages the pack installs, only the ones already installed globally, in **one**
     command: `npm i -g <pkg>@latest <pkg>@latest ...`. The packages are the `npm i -g` targets in
     `pack.json` (`steps` and `requires[].install`): today `bantamkit-mcp`,
     `typescript-language-server`, `pyright`. Do not add `typescript`: typescript-language-server
     uses each project's own `typescript` devDependency.
   - Other language servers, only if present: `gopls` → `go install golang.org/x/tools/gopls@latest`;
     `jdtls` → `brew upgrade jdtls` where it was installed with Homebrew. Otherwise print the
     project's download URL from `pack.json` and skip.

3. **Run** the approved commands with the rules above.

4. **bantamkit not on PATH**: if bantamkit is registered (`claude mcp list` shows it) but
   `bantamkit-mcp` is not found on PATH, it was installed some other way (a checkout, another
   prefix). Say so and skip it; do not install a second copy without asking.

5. **npx-based MCP servers** (playwright, chrome-devtools, next-devtools) are configured with
   `@latest`, so they resolve the newest release when they start. Nothing to run here. Say they
   update on the next `/mcp` reconnect or restart.

6. **Options that changed with the new versions**: run
   `node "<base>/../kk-onboard/scripts/options.mjs" --diff`. For each item in `diff[]`, say the
   version change and list only `added`, `removed` and `changed` options and `flagsAdded` /
   `flagsRemoved` (a `changed` option's doc line differs from the recorded one; show the new line
   with `options.mjs --item <id>`). When nothing changed, say "no option changes" and move on.
   For the changed options only, run the **same explain-and-ask flow as `/kk-onboard` step 5.3 to
   5.4** (what it does, choices with gain/cost, where to store it per AI tool, secrets never
   literal, confirm and back up). An option that was removed but is still set (`currentlySet`) is
   asked about as keep · remove · look it up. Items with `firstSeen: true` were never recorded:
   offer to walk through their options as in `/kk-onboard` step 5, or skip.
   npx-based servers update only when they next start, so their local copy (npx cache) may still
   be the old version here: say so, and offer `--diff --network` to compare against `@latest`.
   Then run `options.mjs --record` so the next update compares against these versions.

7. **Snapshot "after"** and print one table: component → before → after (or "already latest", or
   "failed: <reason>"). Then say what needs a reload: plugins → restart Claude Code; MCP servers
   → `/mcp` reconnect; bantamkit hooks pick up the new global install on the next hook call.

## If an update breaks something

Ask before each step below and show the exact command first. Back up `~/.claude.json` to
`~/.claude.json.bak-kk-update-<YYYYMMDDHHMM>` before removing or re-adding a server.

Pin temporarily (incident only), then tell the team:
- npm: `npm i -g <pkg>@<last-good-version>`, and for an npx server, change its args from
  `@latest` to `@<version>` with `claude mcp remove '<name>'` + `claude mcp add ...` (copy the rest
  of the config from the backup).
- plugin: `claude plugin disable <id>` first (reversible). Uninstalling
  (`claude plugin uninstall <id>`) needs one more explicit yes; note the marketplace so it can be
  reinstalled.

Remove the pin once a fixed release is out. Policy is latest, and pins are only for incidents.
