# kktestdev-pack — Concepts & Usage

Install, the item table, routing and publishers are in the
[plugin README](../../plugins/kktestdev-pack/README.md). The agent's step-by-step flow is in the
[kk-onboard](../../plugins/kktestdev-pack/skills/kk-onboard/SKILL.md) and
[kk-update](../../plugins/kktestdev-pack/skills/kk-update/SKILL.md) skills. Script contracts are in
[SPEC.md](./SPEC.md).

## The problem

A new team member installs plugins and MCP servers by hand from a wiki. Some are already there in
another form (a claude.ai connector, a plugin that starts the same server), some overlap, some store a
token in plain text. Nobody notices.

## The idea

One plugin, two skills, and nothing installed by the plugin itself:

- **`/kk-onboard`** first takes an inventory (read-only), **skips** pack items you already have in any
  form, installs only the missing items you pick, helps you set their options, then **audits** everything
  for redundancy and risk and asks you, finding by finding, what to keep.
- **`/kk-update`** pulls the latest of everything the pack manages and shows versions before and after.

Every change goes through a question to you. Options are offered neutrally, with no answer picked for
you.

## Data, not code, decides the pack

The catalog is [`pack.json`](../../plugins/kktestdev-pack/skills/kk-onboard/pack.json): items (by
profile: core, frontend, investigate, docs), how each is detected, how it is installed (POSIX and
Windows steps), and overlap groups for the audit. `pack.schema.json` describes it, and the tests check
the file against it. Changing the pack is an edit to `pack.json`.

## Options come from the installed version

The pack stores no option lists. `options.mjs` reads each item's options from the copy installed on your
machine (README, docs, `claude plugin configure`, and its `--help` only if you agree). So a new release's
options show up without a pack change, and `/kk-update` asks only about what changed.

## Safe by default

- The scripts are read-only, except `options.mjs --record`, which writes one state file of names and
  hashes.
- Secret values are never printed: only key names and a state (`literal`, `ref`, `empty`).
- Text read from third-party packages is treated as data, never as instructions.
- No versions are pinned (team policy).

## Checks still open

A real fresh-account run is described in [docs/kk-onboard-e2e.md](../kk-onboard-e2e.md), and the Windows
checks in [docs/windows.md](../windows.md). Both are owner checklists that have not been run yet.
