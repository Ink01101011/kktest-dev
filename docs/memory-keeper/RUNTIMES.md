# memory-keeper — Where it runs & the two meanings of "compact"

A short, practical guide to a common point of confusion: there are **two different things called
"compact"**, and memory-keeper's automatic mode behaves differently depending on *where* you run
Claude (Claude Code, Cowork, or the plain Claude Desktop chat tab).

---

## 1. Two things named "compact" — don't mix them up

| | **memory-keeper compact** | **Claude Code auto-compact** |
|---|---|---|
| What it compacts | The index file `MEMORY.md` (file-based long-term memory) | The conversation history in the context window |
| What it does | Regenerates the index from each memory file's frontmatter, so it stays small and can't drift | Summarizes/condenses older turns when the context window is filling up |
| How to trigger manually | `/memory-keeper:memory-compact`, the `memory-maintenance` skill, the `memory_compact` MCP tool, or `memctl.py compact` | `/compact` (a built-in Claude Code command) |
| Owned by | memory-keeper (this plugin) | Claude Code itself |
| Related? | **No.** They just happen to share the word "compact." | |

In one sentence: **memory-keeper tidies your long-term memory store; Claude Code's auto-compact
tidies the current conversation.** They are unrelated systems.

The rest of this document is only about **memory-keeper's** compact.

---

## 2. memory-keeper's auto-compact is a pair of hooks

"Automatic mode" is implemented as two hooks (`hooks/hooks.json`), both running the same
`auto_compact.py`:

| Hook | Fires when | Effect |
|---|---|---|
| `PostToolUse` (matcher `Write\|Edit`) | The agent writes or edits a memory file | Regenerate that store's `MEMORY.md` from frontmatter |
| `SessionEnd` | The session ends | Regenerate once more, so the index is clean on exit |

The hook is **compact-only** (safe and idempotent) — it never archives or edits memory bodies. It
auto-discovers the store from the written file's path, or from `MEMCTL_DIR` / `./memory` /
`~/.claude/projects/<project>/memory`, and always exits 0 so it can never block the agent.

Because compaction is hook-driven, **whether auto-compact happens at all depends on whether your
environment runs hooks.**

---

## 3. Where memory-keeper runs, by environment

| Environment | Auto-compact (hooks) | Manual (skill / MCP tools / slash) |
|---|---|---|
| **Claude Code (CLI)** | ✅ Full — hooks fire on `PostToolUse` + `SessionEnd`, so the index self-heals with zero config | ✅ Everything: `/memory-keeper:*` slash commands, the skill, MCP tools, `memctl.py` |
| **Cowork (desktop)** | ✅ Hooks run in Cowork | ✅ Skill via the `/` menu, MCP tools |
| **Claude Desktop — plain chat tab** | ❌ Hooks are inactive here (they show grayed out) | ✅ Skill via `/` and MCP tools still work — you just run compact yourself |

### Why the earlier "hooks are Cowork-only" caveat is *not* about Claude Code

Inside the **Claude Desktop app**, hooks and sub-agents run in **Cowork** but not in the ordinary
**chat tab** — that's the comparison that statement was making. It does **not** mean Claude Code lacks
hooks. The opposite is true: hooks were designed for Claude Code, and **Claude Code is where
memory-keeper's auto-compact works most completely.**

---

## 4. Practical guidance

- **On Claude Code** — install and forget. The hooks keep `MEMORY.md` compacted automatically; you
  only reach for the slash commands or `memory_archive` when you deliberately want to archive or audit.
- **In Cowork** — same automatic behavior; invoke the `memory-maintenance` skill from the `/` menu
  when you want an on-demand pass.
- **In the plain Claude Desktop chat tab** — there's no auto-compact, so periodically run the skill
  ("my memory index is over budget, compact it") or the `memory_compact` MCP tool yourself. The
  `automation/scheduled-task.md` weekly-upkeep template is a good fit here.

---

## 5. Takeaway

> On **Claude Code**, memory-keeper auto-compacts your `MEMORY.md` index for you via hooks — a
> different system from Claude Code's own `/compact`, which condenses the conversation. In the plain
> **Claude Desktop chat tab**, hooks don't run, so trigger memory-keeper's compact manually via the
> skill or MCP tool.

See also: [CONCEPTS.md](./CONCEPTS.md) (full walkthrough) · [SPEC.md](./SPEC.md) (formal spec).
