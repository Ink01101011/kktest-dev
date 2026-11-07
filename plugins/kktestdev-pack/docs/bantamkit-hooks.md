# bantamkit hooks (opt-in)

The pack installs the bantamkit **MCP server** (memory tools you or Claude call explicitly).
The **hooks** are the automatic part, and you turn them on yourself:

```sh
bantamkit-mcp --install-hooks     # shows the plan, asks, backs up ~/.claude/settings.json
bantamkit-mcp --remove-hooks      # takes them out again
```

`--install-hooks` registers the global `bantamkit-mcp` you installed during onboarding, so
`/kk-update` (which runs `npm i -g bantamkit-mcp@latest`) updates the hooks too. Running it twice
changes nothing.

## What changes when the hooks are on

| When | What happens |
|---|---|
| Session start | Your memory index (cross-project lessons, capped at 3,000 bytes, about 1k tokens) is added to context. |
| Each prompt | Up to 3 matching memory **headers** are added (about 0.5 KB). Bodies come only on `memory_recall`. |
| Reading a file | Re-reading a file that has **not changed** in the same session is refused **once**, with a reason. The next identical read goes through. |
| After memory saves | If the memory index is ≥ 90 % of its byte budget, it auto-compacts: the stalest facts move to `~/.bantamkit/memory/archive/`. They are archived, not deleted, and `memory_recall` with `include_archived` still finds them. |
| End of a long session | If ≥ 20 tool calls and nothing was saved, Claude is asked once to save durable lessons or say there are none. |

Measured on one Mac (Node, `hook-log.jsonl`, 1,066 calls): median 4 ms (before Read) to 105 ms
(session start) per hook call.

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
