# /kk-onboard end to end on a fresh account (#21)

What was run for release 1.1.0, what it found, and what is left for a person on a real fresh account.

## How it was run

Creating a macOS user needs `sudo`, so a clean account was simulated instead:

- `HOME` = an empty folder under `.shiftwork/tmp/110/I7/home`, started through `env -i` (no inherited
  variables), so no plugins, MCP servers, skills, settings or AI tool configs exist.
- `PATH` = a folder with only `node` 26.13, `npm`/`npx` and `claude` 2.1.319, plus `/usr/bin:/bin`, so
  no language server or package manager from the real account is visible.
- `NPM_CONFIG_PREFIX` = an empty folder, so `npm root -g` is empty, as on a fresh account.

The real `claude` CLI was used for every read-only call (`plugin list --json`, `plugin marketplace
list --json`, `mcp list`, and `--help` of every command the skill builds). Nothing was installed:
the result of each approved Step 4 command was written into the fake HOME in the shape the CLI
writes it, and a stub `claude` that refuses every other command served the post-install lists.
`claude -p` was not run.

The skill was walked as `kk-onboard/SKILL.md` describes it, for `core` and for `core+frontend`:
Step 1 inventory, Step 3 profile pick, Step 4 command list, (simulated) install, inventory again,
Step 5 options with seeded fake secrets, Step 5.5 record, then a version bump and `/kk-update`
Step 6 (`options.mjs --diff`).

The same walk runs in CI as `kk-onboard/scripts/onboard-e2e.test.mjs` (stub CLI, every OS).

## Results

| Step | Result |
|---|---|
| 1 Inventory, fresh account | every item `missing`, all counts 0, no findings. Before the fix it also said "claude mcp list printed output in an unknown format" (defect 1). |
| 4 Command list | `core`: 2 marketplace adds, 7 plugin installs, `npm i -g bantamkit-mcp@latest`, 2 `claude mcp add`; `core+frontend` adds 1 marketplace, 1 plugin, 2 `claude mcp add`, and `npx shadcn@latest mcp init` per project. Every command matches its `--help` in claude 2.1.319 and `pack.json`; nothing is pinned. |
| Inventory after install | every chosen item `present` (shadcn once the project's `.mcp.json` exists). Left: the pack's own findings (its marketplaces, `overlap:browser` for core+frontend) and `runs-latest-from-registry` info. `gopls` and `jdtls` stay in `missingBins` (not npm; the user installs them). |
| 5 Options, secrets | Fake secrets were seeded in the shell env, `~/.claude/settings.json` env, the server's `env` and args in `~/.claude.json`, Cursor's `mcp.json`, a project `.mcp.json` and a package README. None of them appeared in any output (inventory compact and `--full`, options compact, `--item`, `--run-help`, `--record`) or in `options-seen.json`. The `--run-help` child saw only `PATH, HOME, TMPDIR, LANG`. |
| 5.5 Record | `~/.claude/kktestdev-pack/options-seen.json`, mode 0600, names and hashes only. |
| `/kk-update` diff | after bumping `bantamkit-mcp` and the `superpowers` plugin: only `bantamkit` has option changes (added, removed, changed, pending as expected); the plugin's version change is named (defect 2). Unchanged options are not listed. |

### Defects found and fixed (each with a test that goes red without the fix)

1. **Fresh account read as a broken one.** `claude mcp list` prints `No MCP servers configured...`
   when there are none; the inventory reported it as an unknown format. Now an empty list.
2. **`--diff` said "nothing installed" for an installed plugin** and never showed a plugin's
   version change. `options.mjs` now keeps `pluginVersion` (from `claude plugin list`) and `--diff`
   gives `against: plugin <v>`, `pluginVersionBefore` / `pluginVersionNow`.
3. **Read-only config files looked like write targets.** `options.mjs` → `hosts[].files` dropped
   `variant` / `side` / `plugin`, so a VS Code Insiders, profile, Microsoft Store or WSL Windows-side
   file read as a normal user file. Files now carry those fields and `readOnly: true`; SKILL.md
   Step 5.4 never writes a `readOnly` file.
4. **Skill text.** SKILL.md now describes `hosts[]`, `packageManagers[]`, `providers[]` (inventory:
   only with a signal; options: all, `signals` may be empty), the off-PATH `missingBins` note, the
   trusted places for `--run-help` (npm, pnpm, yarn, bun, Volta, mise global folders, npx cache,
   user-level config paths), how to tell which marketplaces are added, and what to do when
   `claude-plugins-official` is not listed yet on a fresh account. `/kk-update` names the plugin
   version fields.

### Not fixed

- Doc lines are redacted a little too eagerly: `| BANTAMKIT_API_TOKEN | token for the sync
  service |` comes out as `token *** the sync service`. The meaning survives; loosening the
  `token <word>` rule could let a short secret through, so it was left as it is.
- `--pending NAME` is refused for an option no doc names (for example an option of an npx server
  that has no local copy yet). Run `--network` first to read its README, then defer.

## Time and tokens

Script wall time on the fresh HOME (Apple Silicon, warm disk): inventory 0.7-1.5 s (`--fast` 0.5 s),
options 0.5-0.7 s, `--item` 0.3 s, `--record` 0.3 s, `--diff` 0.15 s. The real flow is dominated by
the network installs (not run here) and by the user's answers.

Tokens were **estimated from output sizes**, not measured (no model run): skill text 29.5 KB +
7.1 KB, about 9.5k tokens; script output for one full pass (inventory twice, options compact,
`--item` for two items, `--record`, `--diff`, `/kk-update` snapshots) about 56 KB, about 15k tokens.
With about 25 turns of questions and commands, a model walk is roughly 25-30k distinct input tokens
plus 8-15k output tokens; with prompt caching most of the re-read context is cache reads.

## Left for the owner on a real fresh account

- [ ] Create a macOS user with no Claude Code config, log in to Claude Code, run `/kk-onboard`.
- [ ] Pick `core`, approve the batch; note whether `claude plugin install <x>@claude-plugins-official`
      works before `claude plugin marketplace add anthropics/claude-plugins-official` (not checked here).
- [ ] Check `claude mcp list` shows bantamkit and playwright connected (the npx download is real).
- [ ] Repeat with `core+frontend`; run the shadcn step inside a project.
- [ ] In Step 5, set one non-secret option and defer one; read the chat: no secret value in it.
- [ ] Wait for (or simulate) a release of one pack item, run `/kk-update`, confirm it asks only
      about that item's changed and deferred options.
- [ ] Note the session's token count (`/cost`) and wall time, and add them to #21.
