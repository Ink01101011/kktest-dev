---
name: kk-onboard
description: Use when someone joins the team or sets up Claude Code on a new machine, asks to "onboard", "ติดตั้ง pack", "setup kktestdev-pack", or wants to audit what skills/MCP servers/plugins/hooks they already have for duplicates and risks. Inventories first, skips what is already present, and asks before every change.
---

# kk-onboard: install the team pack and audit what is already there

The pack installs nothing by itself. This skill gathers facts and asks the user; it **never
changes anything without an explicit choice** from the user.

## Rules for this whole skill

- **Facts first, no steering.** For every question, give each option the same structure: what
  happens, what you gain, what it costs. Do **not** mark any option "(Recommended)", do not
  order options by preference, and do not use loaded words ("just", "obviously", "clutter",
  "safer"). Put "keep as it is" first in every audit question because it is the status quo,
  not because it is preferred.
- **Never print a secret value.** The inventory only reports key names. Do not open config files
  to show values either.
- **Back up before editing** a config file: copy `~/.claude.json` or `~/.claude/settings.json` to
  `<file>.bak-kk-onboard-<YYYYMMDDHHMM>` before the first edit to that file.
- **Use the CLI, not hand edits,** wherever one exists (`claude plugin ...`, `claude mcp ...`).
- Answer in the user's language. Keep tool and command names in English.

## Step 1: Inventory (read-only)

Run the inventory from this skill's base directory:

```sh
node "<this skill's base directory>/scripts/inventory.mjs"
```

It takes about 20–30 s because `claude mcp list` health-checks every server. Pass `--fast` to skip
that check if the user is in a hurry; say that connector status and claude.ai connectors are then
missing from the report. The script prints JSON:

- `pack[]`: each pack item with `status` (`present` | `disabled` | `missing`), `foundAs` (where it
  was found, which may be several places), and `missingBins` (language servers etc. not on PATH).
- `installed`: plugins, marketplaces, MCP servers (config + claude.ai connectors), skills, hooks.
- `findings[]`: `type` is `redundancy`, `risk`, or `info`, plus `category`, `title`, `evidence`.
- `notes[]`: anything the script could not check. Report these, do not hide them.

If `node` is missing, stop and tell the user Node.js 18+ is required (the MCP servers need it too).

## Step 2: Show what is already there

Print a short table of the pack items grouped by profile (`core`, `frontend`, `investigate`,
`docs`) with status. Items with `status: present` are **skipped**: say where each was found
(`foundAs`). If an item is present in **more than one place**, mention it here and leave the
decision to the audit step.

## Step 3: Choose profiles

Ask one multi-select question: which profiles to set up (`core`, `frontend`, `investigate`).
Describe each by its items, not by who "should" pick it.

## Step 4: Install what is missing

For each selected item with `status: missing` (or `disabled`):

1. Make sure its marketplace is known (`pack.json` → `marketplaces`); add it if not.
2. Plugin items: `claude plugin install <plugin> --scope user` (or `claude plugin enable <plugin>`
   when it is `disabled`).
3. MCP items: run the `steps` from `pack.json` exactly. `shadcn` is per project: only run it
   when the user is inside the target project, otherwise print the command for later.
4. `missingBins`: show the install command and ask before running it. A plugin LSP without its
   binary loads but does nothing.

Ask once for the whole batch ("install these N items?") with the list, not item by item. Report
each command's result. If a step fails, show the error and continue with the rest.

**Never pin versions** (team policy): plugins follow their marketplace and npm packages use
`@latest`. `/kk-update` refreshes everything later.

Docs-only items are never installed. Point to the file instead:
- Jira / Confluence → `docs/jira-confluence.md` in this plugin (each person uses their own
  LDAP credentials)
- Figma → `docs/figma.md`
- bantamkit hooks (opt-in) → `docs/bantamkit-hooks.md`

## Step 5: Audit (redundancy and risk)

Go through `findings[]`. Group them and ask **one question per group** (AskUserQuestion, at most 4
questions per call). Skip `info` findings in the questions; list them once at the end.

For every question, give the facts from `evidence` and options shaped like these:

| Finding | Options to offer (each with what happens / gain / cost) |
|---|---|
| `same-endpoint` / `same-package` (one service configured several times) | Keep all · Keep only `<source A>` · Keep only `<source B>` · Decide later |
| `same-skill-name` | Keep all · Keep only `<copy A>` · Keep only `<copy B>` · Decide later |
| `overlap:<group>` (different tools, same job) | Keep all · Choose which ones to keep (follow-up multi-select) · Decide later. Include the group's `note`. |
| `disabled-installed` | Keep installed and disabled · Enable · Uninstall |
| `inline-secret` | Leave as is · Move the value into an environment variable (`${VAR}`) · Remove the server |
| `local-path-mcp` / `local-path-hook` | Leave as is · Replace with the published package (when one exists) · Remove |
| `hook-every-tool` | Leave as is · Add a matcher so it only runs for some tools · Remove the hook |
| `mcp-unhealthy` | Leave as is · Authenticate now (`/mcp`) · Disable here (`/mcp` → disable) · Remove |
| `third-party-marketplace` / `skill-with-scripts` | Leave as is · Review the source first · Remove |

Neutral facts to state when they apply:
- Each enabled MCP server and skill adds its tool or skill descriptions to every session's
  context. More copies means more tokens, but removing a copy loses whatever was different
  about it (another account, another scope, another vendor).
- Two copies of the same remote endpoint usually need separate logins, and only one may be
  authenticated.
- Servers that come from a **claude.ai-synced plugin** or a **claude.ai connector** are managed
  at claude.ai. Removing them locally does not stick, because the next sync brings them back.
  Say this and offer `/mcp` → disable (per project), or changing it at claude.ai.
- Local-path hooks or servers work only on the machine where that path exists.
- Code from a third-party marketplace or a skill's scripts runs with your user's permissions.

After the answers, list the exact commands you will run for the chosen actions. Removals
(`claude plugin uninstall`, `claude mcp remove`, deleting a skill directory) need **one more
explicit yes** after that list. Back up first. Then run them and report each result.

## Step 6: Summary

End with one table: item or finding → what was done (installed / skipped: present / skipped:
user chose to keep / removed / deferred). Then:
- anything that needs a restart or `/mcp` reconnect,
- the `info` findings (e.g. servers that download their latest version on each start),
- `notes[]` from the inventory,
- "run `/kk-update` to pull the latest of everything later."
