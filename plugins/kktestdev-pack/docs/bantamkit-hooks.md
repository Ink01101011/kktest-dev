# bantamkit hooks (opt-in)

The pack installs the bantamkit **MCP server** (memory tools you or Claude call explicitly).
The **hooks** are the automatic part, and you turn them on yourself:

In your own terminal:

```sh
bantamkit-mcp --install-hooks     # shows the plan, asks, backs up ~/.claude/settings.json
bantamkit-mcp --remove-hooks      # takes them out again
```

### Turning them on from Claude Code

Claude runs commands through its Bash tool, which has **no terminal**. There `--install-hooks` cannot
ask, so it writes nothing, prints no plan and exits 2 (`bantamkit-mcp --help` has no dry-run flag).
`--yes` answers the question in advance. So the model-run form is:

1. Run `bantamkit-mcp --install-hooks` without `--yes`. Exit 0 with "already installed and match"
   means the hooks are on and point at this install: stop here. Exit 2 means it needs consent.
2. Show the plan in chat: it adds bantamkit's hook entries (the events in the table below) to
   `~/.claude/settings.json`, each running this `bantamkit-mcp` by its absolute path with `--hook`;
   entries of other tools stay; bantamkit makes a dated backup of the file first.
3. Only after the user says yes to that plan in chat: `bantamkit-mcp --install-hooks --yes`, and
   report what it prints (`installed bantamkit hooks into`, `command:`, `backup:`). Restart Claude
   Code or run `/hooks`.

Removing works the same way: `bantamkit-mcp --remove-hooks` (exit 0 "no bantamkit hooks are
installed" = nothing to do), show what goes, then `bantamkit-mcp --remove-hooks --yes` after a yes.
Never add `--yes` before the user has approved the plan in chat.

`--install-hooks` registers the global `bantamkit-mcp` you installed during onboarding, so
`/kk-update` (which runs `npm i -g bantamkit-mcp@latest`) updates the hooks too. Running it twice
changes nothing (bantamkit's own claim; this pack did not re-test it).

**Node from a version manager (mise, nvm, fnm, asdf, Volta):** the hook command is an absolute path
into one node version, e.g. `~/.local/share/mise/installs/node/26.13.0/bin/bantamkit-mcp`. After a
node upgrade that version may be removed (the hooks then fail) or left behind (they run the old
copy). `/kk-onboard`'s inventory reports this as `node-version-path`. Fix: `npm i -g
bantamkit-mcp@latest` under the new node, then the flow above again: the hooks no longer read
"already installed and match", so step 1 exits 2 and the plan shows the new command. `/kk-update`
runs this check after its updates.

If your shell says `bantamkit-mcp: command not found`:
- after `npm i -g`, npm's global bin directory is not on PATH: run `npm prefix -g` and add its
  `bin` subdirectory (macOS/Linux) or the prefix directory itself (Windows) to PATH, or
- bantamkit was set up some other way (a checkout, another prefix; `claude mcp list` shows the
  command it runs). Run that same command with `--install-hooks`, or install the npm package
  first. `/kk-update` only updates the global npm install.

## What changes when the hooks are on

| When | What happens |
|---|---|
| Session start | Your memory index (cross-project lessons) is added to context: 3.8 to 4.2 KB, about 1k tokens, measured over 43 sessions on one Mac. |
| Each prompt | Up to 3 matching memory **headers** are added (about 0.5 KB). Bodies come only on `memory_recall`. |
| Reading a file | Re-reading a file that has **not changed** in the same session is refused **once**, with a reason. The next identical read goes through. |
| After memory saves | If the memory index is ≥ 90 % of its byte budget, it auto-compacts: the stalest facts move to `~/.bantamkit/memory/archive/`. They are archived, not deleted, and `memory_recall` with `include_archived` still finds them. |
| End of a long session | If ≥ 20 tool calls and nothing was saved, Claude is asked once to save durable lessons or say there are none. |

Snapshot measured on one Mac on 2026-11-07 (Node, the first 1,066 rows of `hook-log.jsonl`):
median 4 ms (before Read) to 105 ms (session start) per hook call. Your numbers will differ.

## Does it conflict with Claude's own auto-memory?

No. They sync. This was checked on 2026-11-07 against bantamkit 0.38.x, not taken from the docs:

- **bantamkit → auto-memory**: at session start, bantamkit writes its project facts into
  Claude's `MEMORY.md` under a `## bantamkit` heading, one way, only names not already there
  (observed: 7, 5 and 1 facts exported in three repos, files tagged `source: bantamkit`).
- **auto-memory → bantamkit**: when Claude writes a new auto-memory file, bantamkit mirrors it
  into its own store (tested live: a probe file written into the auto-memory folder was
  recallable with `memory_recall` right after).
- **Limit:** auto-memory files written **before** the hooks were on (or in sessions without
  them) are not imported, so `memory_recall` cannot find those. Claude still sees them through its
  own `MEMORY.md`.
- When a project has no auto-memory folder yet, bantamkit injects its project index itself.

So you do not need to turn either one off or split them by folder.
