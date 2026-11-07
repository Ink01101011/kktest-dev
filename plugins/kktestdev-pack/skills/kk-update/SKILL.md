---
name: kk-update
description: Use when the user asks to update the team pack, "kk-update", "อัปเดต pack", "update plugins/MCP to latest", or when bantamkit's session header says the install is behind. Pulls the latest of everything kktestdev-pack manages and reports versions before and after.
---

# kk-update: pull the latest of everything in the pack

Team policy: **never pin versions.** This skill moves every pack-managed component to its latest
release and shows what changed. It only updates what is already installed. It never installs new
items (that is `/kk-onboard`).

## Steps

1. **Snapshot "before"**: `claude plugin list --json` (keep `id` + `version`),
   `npm ls -g --depth=0 --json` (keep the packages listed below).

2. **Marketplaces**: `claude plugin marketplace update` (all of them).

3. **Plugins**: for each installed plugin whose id appears in this plugin's
   `../kk-onboard/pack.json` items, run `claude plugin update <id>`. Leave the others alone. They
   are not the pack's to touch. Mention that `claude plugin update <id>` also works for them.

4. **Global npm packages** the pack installs (only the ones already installed globally):
   - `bantamkit-mcp` → `npm i -g bantamkit-mcp@latest`
   - `typescript`, `typescript-language-server` → `npm i -g typescript@latest typescript-language-server@latest`
   - `pyright` → `npm i -g pyright@latest`

   If `npm i -g` fails with EACCES, show the error and suggest the user's node version manager
   (mise / nvm / volta). Do not use `sudo`.

5. **Other language servers** (only if present): `gopls` → `go install golang.org/x/tools/gopls@latest`;
   `jdtls` → `brew upgrade jdtls` on macOS. On other OSes, print the command and skip.

6. **npx-based MCP servers** (playwright, chrome-devtools, next-devtools) are configured with
   `@latest`, so they resolve the newest release when they start. Nothing to run here. Say they
   update on the next `/mcp` reconnect or restart.

7. **Snapshot "after"** and print one table: component → before → after (or "already latest").
   Then say what needs a reload: plugins → restart Claude Code; MCP servers → `/mcp` reconnect;
   bantamkit hooks pick up the new global install on the next hook call.

## If an update breaks something

Pin temporarily, then tell the team:
- npm: `npm i -g <pkg>@<last-good-version>`, and for an npx server, edit its args from
  `@latest` to `@<version>` with `claude mcp remove <name>` + `claude mcp add ...`.
- plugin: `claude plugin uninstall <id>` and reinstall from a marketplace ref, or disable it.

Remove the pin once a fixed release is out. Policy is latest, and pins are only for incidents.
