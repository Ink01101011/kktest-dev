---
name: proactive-task-reminders
description: "Use this skill whenever you're working a long or multi-session project and need to keep deferred/pending work from being silently dropped.
  Triggers include: the user defers something ('ไว้ก่อน', 'later', 'after X is online'), you reach a fork and the user picks one option (A/B/C → picks C), you're about to skip a step that was previously agreed, you hit a 'pause checkpoint', or you're resuming a session and need to surface what's still open.
  Also use when the user asks 'why didn't you remind me about X' — that's a missed pending item.
  Do NOT use for a single self-contained task with no deferred items or branches."
version: "0.1.0"
updated: "2026-06-19"
---

# Feedback — Proactive Task Reminders

## Overview

Long projects accumulate deferred work, conditional follow-ups, and abandoned branches. Without a
discipline, these get silently dropped — and the user discovers the gap weeks later. This skill keeps a
**pending-work register** and surfaces the right items at the right moment, sorted by priority, so
nothing falls through.

The register lives in memory (e.g. a `project_pending_work_register` file) so it survives across
sessions; this skill is the behavior that maintains and acts on it.

## When to Use

- ✅ Any project spanning multiple sessions or with explicit "do later" items.
- ✅ At every pause/checkpoint — snapshot what's open before stopping.
- ✅ When resuming — load the register and surface relevant items before asking "what next".
- ❌ A one-shot task that fully completes in the same turn.

## The register: what to track per item

| Field | Meaning |
|---|---|
| Title | Short name of the deferred work |
| Priority | 🔴 high (blocker) / 🟡 medium (conditional) / 🟢 low (deferred pattern) |
| Trigger | What condition should resurface it (e.g. "after Reporter daemon online", "first 429 in prod") |
| Origin | Where it came from (which fork, which session) |
| Status | open / closed (closed branches kept as audit trail) |

## Process / Steps — the three trigger moments

### Trigger 1 — Skip notice

You're about to skip or defer something that was previously agreed.

- ☐ Stop and name it explicitly: "นี่คือสิ่งที่เคยตกลงว่าจะทำ — จะ defer ไหม?"
- ☐ If deferred, add/keep it in the register with a trigger condition.
- ☐ Don't silently drop it.

### Trigger 2 — Condition met

A registered item's trigger condition has now become true.

- ☐ On each pause/resume, scan the register's triggers against current state.
- ☐ Surface the items whose condition is now satisfied ("Reporter daemon is online → Round 4 probe is now due").
- ☐ Ask whether to do it now or re-defer.

### Trigger 3 — Branch return

The user chose one option from a fork (A/B/C → picked C). When C completes, the others are owed a revisit.

- ☐ When you finish the chosen branch, remind the user of the untaken branches (A, B).
- ☐ For each, state whether it's still relevant or now moot, and let the user decide.

### Presentation rules

- ☐ **Always sort high → low** (🔴 → 🟡 → 🟢).
- ☐ Group by priority with the trigger condition shown for conditional items.
- ☐ Keep closed branches in a collapsed "audit trail" section — visible but out of the way.
- ☐ **Gloss technical/domain terms inline** on first mention, concisely:
  `PEL recovery (= Pending Entries List — Redis Streams' claim mechanism for messages whose consumer crashed)`.

## Rules & Constraints

- ALWAYS: snapshot the register at every pause checkpoint before stopping.
- ALWAYS: on resume, load the register and surface relevant items before asking "what next".
- ALWAYS: sort by priority, high first.
- ALWAYS: when finishing a chosen fork branch, remind the unchosen ones.
- ALWAYS: gloss specialized terms inline the first time they appear.
- NEVER: silently drop a deferred item — defer is a decision, not a disappearance.
- NEVER: re-surface closed/abandoned branches as if open — keep them as audit trail only.

## Examples

**Scenario:** Fork — MQ choice A/B/C; user picks C (Redis Streams). C ships.
→ On completion: "C done. A (RabbitMQ) and B (SQS) were the other forks — both closed, no follow-up. Logged in audit trail." Don't leave A/B dangling.

**Scenario:** Pause checkpoint after a research round.
→ Output: register snapshot sorted 🔴→🟡→🟢, each conditional item showing its trigger ("Round 4 — when Reporter daemon online + 1 wk of data"), plus closed branches collapsed. Then the resume command.

**Scenario:** User: "ทำไมไม่เตือนว่า Alpaca paper key รั่วใน log."
→ That was a registered 🛡️ security follow-up with trigger "before live broker". Surface it, apologize once, and confirm the register's trigger so it fires next time. (See [[secret-hygiene]].)

## Changelog

- 0.1.0 (2026-06-19) — initial version; pending-work register + 3 trigger moments (skip / condition-met / branch-return) + priority sort + inline term glossing. Source: "Expensive lessons" session.
