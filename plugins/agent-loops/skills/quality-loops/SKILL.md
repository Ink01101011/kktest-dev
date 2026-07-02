---
name: quality-loops
description: "Use this skill whenever an output needs to clear a quality bar before it ships — a draft,
  a piece of code, an analysis, a report — and 'looks fine to me' from the model that wrote it is not
  good enough. Triggers include: 'make this better', 'critique and improve', 'is this good enough',
  'grade this', 'get a second opinion', 'stress-test this argument', or any request to iterate on
  quality rather than count or explore. Covers Generate→Critique→Rewrite, Score-and-Retry, Multi-Critic,
  Adversarial Critique, and Judge Ensemble. Do NOT use for count-bounded retries with no quality score
  (that's just a plain loop-ledger 'target' or 'manual' loop with no critic), or for exploring multiple
  designs to pick from (see exploration-loops)."
version: "0.1.1"
updated: "2026-07-02"
---

# Quality Loops

## Overview

The model that generates an output is not the best judge of it — it declares "good enough" while the
argument in paragraph 3 is circular. Quality loops fix this by separating **generator** from **critic**
and iterating generate→critique→rewrite until a critic (not the generator) says the bar is cleared.
Every pattern here needs a **numeric, measurable score** — if quality can't be scored, this category
doesn't apply; use judgment prose instead and skip the loop.

Companion plugin: **`critique-gate`** (built alongside `agent-loops`) turns these patterns into an
*enforced* Stop-hook gate — the session cannot end until the score clears the threshold or the retry
budget is exhausted. Install it when you want the brake to be non-optional; use the patterns below
directly (calling `loop-ledger`'s tools yourself) when you want the discipline without the hard gate.

## When to Use

- ✅ An output has a measurable quality dimension (correctness, clarity, safety, style-fit) and "the
  generator's own opinion" isn't trustworthy enough to ship on.
- ✅ You want a bounded number of rewrite passes, not an open-ended "keep polishing forever."
- ❌ There's no way to score the output numerically — that's a judgment call, not a quality loop.
- ❌ You're picking among several *different* candidates rather than improving *one* — see
  `exploration-loops` (Debate, Tree Search) instead.

## Patterns

### Generate → Critique → Rewrite

One critic reviews the draft against a rubric, the generator rewrites addressing the critique, repeat.
Use it for a single well-defined rubric (e.g. "clarity + correctness") and a small number of passes —
it's the simplest quality loop and the default choice when you don't need multiple independent critics.
Don't use it when the rubric actually has several unrelated dimensions (correctness *and* style *and*
safety) that could pass/fail independently — that's Multi-Critic below, since one blended score hides
which dimension is failing.

**Shape:** draft → critic scores 0–10 against rubric + lists issues → generator rewrites addressing
issues → re-score.

**Wire the brake:** `loop_start { goal: "draft clears rubric", max_iterations: 4, exit_mode: "target",
target_value: 8, direction: "increase" }`. Each `loop_tick` passes `progress: <critic score>` and
`state: <the issues list text>` (identical issues twice ⇒ `stalled`, meaning the rewrite isn't
addressing feedback — escalate, don't rewrite the same way again).

### Score-and-Retry

The degenerate single-critic case: no rewrite guidance beyond the score itself, just "retry until the
score clears the bar." Use it when you don't have (or need) a structured issues list — e.g. an
automated scorer (a classifier, a test, a heuristic) rather than a prose critique. Don't use it when you
*do* have actionable feedback available — throwing away the "why" and retrying blind wastes iterations
that Generate→Critique→Rewrite would spend more efficiently.

**Shape:** draft → scorer returns a number → if below bar, regenerate → re-score.

**Wire the brake:** `loop_start { goal: "score ≥ threshold", max_iterations: 5, exit_mode: "target",
target_value: <threshold>, direction: "increase" }`. `progress: <score>` each tick; `state` should be a
hash-worthy summary of *what changed* in the regenerated attempt (not the score itself) so identical
regenerations are caught as `stalled`.

### Multi-Critic

N independent critics (e.g. correctness, style, safety, domain-fit) score separately; the loop continues
until **all** pass their own bar. Use it whenever quality has genuinely independent dimensions that
should be able to fail without hiding each other. Don't use it for a single-dimension rubric — that's
needless overhead; use Generate→Critique→Rewrite.

**Shape:** draft → run N critics in parallel, each returns its own score → rewrite targeting whichever
critic(s) failed → re-score all N.

**Wire the brake:** `loop_start { goal: "all N critics pass", max_iterations: 6, exit_mode: "target",
target_value: <lowest-critic threshold, e.g. 7>, direction: "increase" }`, with `progress: min(scores
across all N critics)` — the ledger only sees one number, so feed it the *weakest* critic's score
(the "weakest link" gates progress, not the average). `state` should list which critic(s) are currently
failing.

### Adversarial Critique

One critic actively attacks the output (finds counterexamples, edge cases, exploits) rather than scoring
it against a rubric. Use it when the failure mode is "the happy path looks fine but breaks under
scrutiny" — security-sensitive text, claims that need to survive pushback, code that needs to survive a
hostile reviewer. Don't use it for style/clarity quality, where there's nothing to "attack."

**Shape:** draft → attacker proposes an objection/counterexample → defender either patches the draft or
rebuts the objection with evidence → repeat until the attacker finds nothing new.

**Wire the brake:** `loop_start { goal: "no unrebutted objection", max_iterations: 5, exit_mode:
"target", target_value: 0, direction: "decrease" }` with `progress: <count of currently-unrebutted
objections>` (starts nonzero, must hit 0). `state` is the current objection list — an unchanging
objection list after a patch means the patch didn't address it ⇒ `stalled`, escalate rather than
re-patching the same way.

### Judge Ensemble

K independent judges each score the same output; the loop continues until judges agree it's good
(consensus), not just until one judge says so. Use it for high-stakes or subjective outputs where a
single critic's idiosyncrasies shouldn't decide the outcome. Don't use it for cheap/low-stakes drafts —
running K judges per iteration multiplies cost for marginal benefit.

**Shape:** draft → K judges score independently → compute mean and variance → rewrite if mean is below
bar or judges disagree too much → re-score with all K.

**Wire the brake:** don't use `exit_mode: "target"` here even though there's a numeric mean score —
`target`-mode exit is unconditional on `progress` alone (verified against `ledger.js`:
`targetReached()` fires the instant `progress` crosses `target_value`, and it does **not** consult
`done`; there is no way to hold a `target`-mode loop open past that crossing while a variance check
catches up, and a tick on an already-closed loop just returns `"loop already closed — start a new
one"` instead of re-opening it). Use `exit_mode: "manual"` instead, where `done` is the *only* thing
that ends the loop: `loop_start { goal: "judge consensus", max_iterations: 5, exit_mode: "manual" }`.
Each tick, compute mean and variance across the K judges, pass `progress: <mean judge score>` purely
for reporting/history (manual mode never auto-exits on `progress`, so there's no unconditional
crossing to trip over), and set `done: true` only on the tick where *both* mean ≥ threshold **and**
your own variance check passes — otherwise keep `done: false` and call `loop_tick` again next round,
which is always possible since the loop hasn't closed. `state` should include per-judge scores so the
"unchanged state" stall check catches judges giving the exact same split repeatedly.

## Rules & Constraints

- ALWAYS name a numeric progress metric before starting the loop — no metric, no quality loop.
- ALWAYS pass `state` as the *feedback content* (issues/objections/failing critic names), not the score
  itself, so `loop-ledger`'s stall detector catches "rewriting without actually changing anything."
- NEVER treat `stalled` as a signal to keep retrying the same rewrite — it means change approach
  (different critic framing, escalate to a human, or accept partial progress and report it).
- NEVER blend independent quality dimensions into one score if you need Multi-Critic — use the weakest
  link, not an average, or a real failure can hide behind a strong one.
- Prefer the `critique-gate` plugin over hand-rolling enforcement when the gate must be non-optional
  (session cannot end until quality clears bar).

## Examples

**Scenario:** "Make this incident postmortem better before I send it."
→ Generate→Critique→Rewrite: one critic scores clarity+completeness 0–10, `target_value: 8`,
`max_iterations: 4`. Two rounds later `target_reached` at 8 → ship it.

**Scenario:** "Review this PR for correctness, style, and security independently."
→ Multi-Critic, three critics, `progress = min(3 scores)`, `target_value: 7`. Round 2 style clears but
security still fails at 5 → rewrite targets security specifically → round 3 all three ≥ 7 →
`target_reached`.

**Scenario:** "This design doc needs to survive a hostile security review."
→ Adversarial Critique, `target_value: 0` unrebutted objections, `direction: decrease`. Round 3: same
objection ("no rate limiting") recurs verbatim after a cosmetic patch → `stalled` → escalate: actually
add rate limiting, don't reword the paragraph again.

## Changelog

- 0.1.1 (2026-07-02) — fix: Judge Ensemble's "Wire the brake" previously described withholding
  `done:true` to gate `target`-mode's exit on a variance check; live-verified against `loop-ledger`
  that `target`-mode's `targetReached()` fires unconditionally on `progress` and never consults `done`,
  so that gate was impossible and a second `loop_tick` on the now-closed loop would fail. Switched
  Judge Ensemble to `exit_mode: "manual"` with `done` as the sole, genuinely-gating exit condition.
- 0.1.0 (2026-07-02) — initial version; 5 Quality-category patterns (Generate→Critique→Rewrite,
  Score-and-Retry, Multi-Critic, Adversarial Critique, Judge Ensemble), each with a real
  `loop-ledger` `loop_start` wiring. Cross-references the `critique-gate` companion plugin for enforced
  gating.
