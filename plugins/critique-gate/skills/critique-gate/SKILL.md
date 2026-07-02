---
name: critique-gate
description: "Use this skill whenever output should not ship until a distinct critic role — not the
  model that wrote it — says it clears a quality bar. Triggers include: 'critique this before it
  ships', 'score this against a rubric and don't stop until it passes', 'get a second opinion and
  keep rewriting', 'red-team this', 'have a few judges grade this', or any request that wants the
  retry to be enforced rather than advisory. Covers four modes: score-retry (one critic), multi-critic
  (N independent lenses, weakest gates), adversarial (one attacker, no unrebutted objection), and
  judge-ensemble (K judges, mean gates + variance flagged). Do NOT use for a plain count-bounded retry
  with no quality score (that's just a `loop-ledger` target/manual loop) — use the broader
  `agent-loops` plugin's `quality-loops` skill instead if you only want the *pattern reference*, not a
  named, enforceable command per mode."
version: "0.1.0"
updated: "2026-07-02"
---

# Critique Gate

## Overview

The model that generates an output is not the best judge of it — it calls a draft "done" while
paragraph 3 is vague and the conclusion is unsupported. `critique-gate` separates **generator** from
**critic** and won't let the draft through until a critic — playing a distinct role, not the same pass
that just wrote the text — says the score clears a threshold, or the retry budget runs out.

**This plugin adds zero new machinery.** There is no critique-gate server, no critique-gate Stop hook,
no state file of its own. Every mode below is "how you call `loop-ledger`'s existing MCP tools"
(`loop_start` / `loop_tick` / `loop_status` / `loop_end`) with the critic's score as `progress` and the
critic's issues as `state`. `loop-ledger`'s own Stop hook already enforces this end to end — it blocks
session-end while an `enforce:true` loop is open and releases automatically the moment the loop closes
for *any* reason (`target_reached`, `stalled`, `budget_exhausted`, `done`). You are not building an
enforcement mechanism here; you are *using* one that already ships in this marketplace. Install
`loop-ledger` alongside this plugin — without it there is nothing to call.

If you only want the conceptual pattern reference (when to use Generate→Critique→Rewrite vs
Multi-Critic vs Adversarial vs Judge-Ensemble, in prose, without named slash commands or enforced
defaults), see the sibling `agent-loops` plugin's `quality-loops` skill — it covers the same five
patterns as general-purpose guidance. `critique-gate` is the opinionated, "just run it" version: fixed
defaults, one slash command per mode, and an explicit stance on enforcement.

## When to Use

- ✅ Output should not ship until a distinct critic role — not the model that just wrote it — says it
  clears a quality bar (`/critique-gate:critique-score`, or "score this against a rubric and don't
  stop until it passes").
- ✅ You want more than one lens on the same draft in a single pass, gated on the weakest one, not an
  average (`/critique-gate:critique-multi` — "review this for correctness, style, and security
  independently before merge").
- ✅ The draft must survive active pushback (counterexamples, exploits, edge cases), not a rubric score
  (`/critique-gate:critique-adversarial` — "red-team this before it ships").
- ✅ You want several independent judges' opinions combined, with disagreement surfaced rather than
  quietly averaged away (`/critique-gate:critique-ensemble` — "have a few judges grade this").
- ✅ The retry needs to be **enforced** (session blocked from ending until it clears), not just
  advisory — set `CRITIQUE_ENFORCE`/`--enforce` true to arm `loop-ledger`'s real Stop hook.
- ❌ A plain count-bounded retry with no quality score — that's just a `loop-ledger` `target`/`manual`
  loop directly; there is no critic role to separate out here.
- ❌ You only want the conceptual pattern reference (prose guidance, no named command, no fixed
  defaults) — use the sibling `agent-loops` plugin's `quality-loops` skill instead.
- ❌ You're choosing among several *different* candidate drafts rather than improving *one* draft
  through rewrites — that's exploration/selection, not a critique gate.

## Conventions (documented defaults, not env vars)

There is no running critique-gate process — this is a skills-only plugin, prose the model reads, not
code that starts up and reads `os.environ`. So these are **documented conventions the skill tells you
to apply as `loop_start` arguments**, not values auto-read from the environment:

| Name | Default | Used as |
|---|---|---|
| `CRITIQUE_THRESHOLD` | `0.8` (of 1.0) | `target_value` passed to `loop_start` |
| `CRITIQUE_MAX_RETRIES` | `3` | `max_iterations` passed to `loop_start` |
| `CRITIQUE_ENSEMBLE_K` | `3` | number of independent judges in judge-ensemble mode |
| `CRITIQUE_ENFORCE` | `false` | `enforce` passed to `loop_start` (arms `loop-ledger`'s Stop hook) |

If the project's `CLAUDE.md` states different values, or the user gives an explicit number in the
request, use those instead. Otherwise use the defaults above. Never claim you "read an env var" — you
are applying a documented default because nothing in this plugin runs as a process that could read one.

## Common shape (all four modes)

Every mode is exactly one `loop_start` / `loop_tick` pair per draft — never multiple concurrent loops
on the same draft, and never a second, hand-rolled stall/retry check on top of `loop-ledger`'s.

```
draft = generate(...)
loop_start {
  goal: "<mode> critique clears threshold",
  max_iterations: CRITIQUE_MAX_RETRIES,   // default 3
  exit_mode: "target",
  target_value: CRITIQUE_THRESHOLD,        // default 0.8
  direction: "increase",
  enforce: CRITIQUE_ENFORCE                // default false
}
repeat:
  { score, issues } = critique(draft, rubric, mode)   // you, playing the critic role
  loop_tick { loop_id, state: issues, progress: score, note: "<human-readable summary>" }
  read `state` and `note` back to the user every tick — do not just check `should_continue`.
    A boolean alone loses *which* critic/objection is still failing.
  if !should_continue: break     // target_reached | stalled | budget_exhausted
  draft = rewrite(draft, issues)
loop_end (if not already closed)
```

`state` is always the critic's **issues** (joined/summarized text), never the draft text and never a
hash you compute yourself — `loop-ledger` hashes `state` internally. If the same issues recur
unchanged, `loop-ledger` reports `stalled` for you; that IS the stall detector, there is nothing else
to build. **On `stalled`: surface the unresolved issue(s) to the user and stop. Do not keep rewriting
the same way — that is exactly what `stalled` means.**

## Modes

### score-retry — one critic

The simplest case: a single critic scores the draft 0–1 against a rubric and lists issues.

- `progress` = that one critic's score.
- `loop_start { max_iterations: 3, exit_mode: "target", target_value: 0.8, direction: "increase",
  enforce: false }` (defaults; adjust per the Conventions table).
- `state` = the critic's issues for this round.

Use `/critique-gate:critique-score` to run this mode.

### multi-critic — N named critic lenses, one pass

Score the *same* draft against N independent, named lenses in a single pass (e.g. correctness, style,
safety, domain-fit) rather than one blended rubric. Each lens returns its own 0–1 score and its own
issues.

- `progress` = **`min()` across the N lens scores** — the loop only reports success when the *weakest*
  lens clears the bar, never the average. An average would let a strong style score paper over a
  failing correctness score.
- `state` = which lens(es) are currently below threshold, plus their issues (e.g. `"safety: 0.5 —
  missing input validation; style: 0.9 (pass)"`). Do not just say "min score 0.5" — name the failing
  lens so a rewrite can target it.
- Same `loop_start` shape as score-retry; only `progress`'s computation and `state`'s content differ.
- Rewrite between ticks should target whichever lens(es) are still failing, not the whole draft
  blindly.

Use `/critique-gate:critique-multi` to run this mode.

### adversarial — one attacker, no unrebutted objection

One critic actively attacks the draft (counterexamples, edge cases, exploits) instead of scoring
against a rubric. Use for security-sensitive text, claims that must survive pushback, or code that
must survive a hostile reviewer — not for style/clarity, where there's nothing to "attack."

- `progress` = `1.0` if the attacker raises **zero unrebutted objections** this round; otherwise a
  partial score defined as `issues_resolved / issues_raised` for that round (e.g. 2 of 3 prior
  objections patched, 1 new one raised → report the partial fraction, not a guess).
- `state` = the current objection list (unrebutted ones). An unchanging objection list after a patch
  means the patch didn't address it — `loop-ledger` will report `stalled`; that means change approach
  (actually fix the underlying gap), not reword the same paragraph again.
- `loop_start` still uses `exit_mode: "target"`, `direction: "increase"`, `target_value: 1.0` (perfect
  score = no unrebutted objections) with the same defaults for `max_iterations`/`enforce`.

Use `/critique-gate:critique-adversarial` to run this mode.

### judge-ensemble — K independent judges

K independent judges (default `CRITIQUE_ENSEMBLE_K = 3`) each score the draft 0–1 without seeing each
other's scores.

- `progress` = `mean()` of the K scores. This is the **only** value `loop-ledger`'s target-mode exit
  predicate sees — `loop_start`/`loop_tick`'s `progress` field is scalar-only, so a variance/spread
  check cannot be a native, enforced exit condition here. This narrows the general judge-ensemble idea
  ("mean ≥ threshold **and** variance ≤ limit") to: mean is the enforced predicate, variance is a
  **mandatory surfaced flag**, not a second silent gate.
- **Every tick**, compute and report the spread across the K scores (e.g. max − min, or stdev) in the
  tick's `note` and to the user, even on a tick where `target_reached` fires. Say explicitly if
  variance is high (e.g. "mean 0.83 clears 0.8, but judges ranged 0.5–1.0 — treat this as unresolved
  disagreement, not consensus" ) rather than silently averaging disagreement away.
- `state` = the per-judge scores/issues, so `loop-ledger`'s stall check catches judges repeating the
  exact same split round after round.
- `loop_start { max_iterations: 3, exit_mode: "target", target_value: 0.8, direction: "increase",
  enforce: false }` (defaults; K is a critique-gate-side loop count, not a `loop-ledger` parameter).

Use `/critique-gate:critique-ensemble` to run this mode.

## Rules & Constraints

- ALWAYS wire exactly one `loop_start`/`loop_tick` pair per draft per mode — never a second, hand-built
  retry/stall check on top of `loop-ledger`'s.
- ALWAYS pass `state` as the critic's issue/objection content (or per-lens/per-judge breakdown), never
  the draft text and never a score-only string — that is what lets `loop-ledger`'s stall detector catch
  "rewriting without actually changing anything."
- ALWAYS read `state` and `note` back to the user every tick, not just the `should_continue` boolean —
  the rich "which critic/objection is failing" detail lives there, not in the scalar `progress`.
- On `status: "stalled"` — surface the unresolved issue(s) to the user and stop. Do not keep rewriting
  the same way; that is precisely what `stalled` means.
- Multi-critic's `progress` is `min()`, never an average — a strong lens must never hide a failing one.
- Judge-ensemble's `progress` is `mean()`, but variance is a mandatory surfaced side-channel, never a
  silent average-away. `loop-ledger` cannot gate on it natively; you must say it out loud every tick.
- `CRITIQUE_THRESHOLD` / `CRITIQUE_MAX_RETRIES` / `CRITIQUE_ENSEMBLE_K` / `CRITIQUE_ENFORCE` are
  documented conventions this skill applies as `loop_start` arguments — never claim a running process
  read them from the environment; there is no such process here.
- Prefer `enforce: false` (advisory) unless the user or project config explicitly wants the session
  blocked from ending until the gate clears — `enforce: true` arms `loop-ledger`'s real Stop hook, a
  shared, marketplace-wide mechanism, not something this plugin owns or can special-case.

## Examples

**Scenario:** "Score this incident summary and don't let it out the door below an 8."
→ score-retry, `target_value: 0.8`, `max_iterations: 3`. Round 1 scores 0.4 (vague scope, no metrics,
hedged conclusion) → rewrite → round 2 scores 0.85 → `target_reached`, ship it.

**Scenario:** "Review this PR for correctness, style, and security independently before merge."
→ multi-critic, three lenses, `progress = min(3 scores)`, `target_value: 0.8`. Round 2: style and
correctness clear, security still at 0.5 → rewrite targets security only → round 3 all three ≥ 0.8 →
`target_reached`.

**Scenario:** "This design doc needs to survive a hostile security review before it ships."
→ adversarial, `target_value: 1.0`, `direction: increase`. Round 3: the same objection ("no rate
limiting") recurs verbatim after a cosmetic patch → `stalled` → escalate to the user: actually add rate
limiting, don't reword the paragraph again.

**Scenario:** "Get three independent opinions on this policy proposal before it's final."
→ judge-ensemble, K=3, `progress = mean(3 scores)`, `target_value: 0.8`. Round 2: mean 0.83 clears the
bar, but scores were 0.5/0.9/1.0 (spread 0.5) → report `target_reached` but flag to the user that the
judges disagreed sharply and consensus is weak, rather than presenting it as a clean pass.

## Changelog

- 0.1.0 (2026-07-02) — initial version; four modes (score-retry, multi-critic, adversarial,
  judge-ensemble), each wired to one `loop-ledger` `loop_start`/`loop_tick` pair. No new server, no new
  Stop hook — reuses `loop-ledger`'s enforcement verbatim. Dogfooded score-retry mode end to end against
  the real `loop-ledger` MCP tools (see `README.md` / plan test evidence).
