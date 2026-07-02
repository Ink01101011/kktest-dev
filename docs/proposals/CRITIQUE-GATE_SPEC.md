# critique-gate — Specification

Status: 0.1.0 (proposal) · Date: 2026-07-02 · Author: Ink

> Proposal spec. A quality brake for Loop Category 1: output does not leave the session until it passes
> the critics. Borrows `loop-ledger`'s Stop-hook enforcement mechanism, but gates on **quality
> threshold** instead of **iteration budget**.

## 1. Problem

The model that generates is not the best judge of its own output — it declares "done" while paragraph 3
is vague and the conclusion is weak. Quality Loops (Generate→Critique→Rewrite #1, Score-and-Retry #2,
Multi-Critic #3, Adversarial #4, Judge Ensemble #5) fix this, but only if something *enforces* the
retry. Advisory "please self-check" prompts get rationalized away. `loop-ledger` already proved the
enforcement pattern for *count* (Stop hook blocks until a loop closes); `critique-gate` applies the
same mechanism to *quality* (Stop hook blocks until a score clears a threshold).

## 2. Goals & non-goals

**Goals**
- Provide a separate-critic workflow: generate → critic scores against a rubric → rewrite → re-score.
- Support single-critic (Score-and-Retry), Multi-Critic (correctness/style/safety/domain), Adversarial,
  and Judge-Ensemble modes.
- Optionally **enforce**: a Stop hook blocks session end until the latest output clears the threshold or
  the retry budget is exhausted (fail-open with a logged reason).
- Reuse `loop-ledger` as the retry-count backstop so critique can't loop forever.

**Non-goals**
- Not a content generator — it scores and demands rewrites; the generator is the user's model/skill.
- No fixed, hard-coded rubric — rubrics are supplied per task (config/skill).
- Not a linter for code style (that's deterministic tooling); this is for *judgemental* quality
  (writing, analysis, code review, reports).
- No network model calls beyond the session's own model acting as critic.

## 3. Principles

1. **Generator ≠ judge.** The critic is a distinct role with its own rubric; separation is the pattern.
2. **Enforcement over discipline.** A Stop hook that blocks is the only reliable "don't ship it yet."
3. **Bounded retries.** Quality gating rides on `loop-ledger` so `stalled`/`budget_exhausted` still
   releases the gate — never an infinite rewrite spiral.
4. **Threshold is explicit and measurable.** A numeric score + rubric, not a vibe. If quality can't be
   scored, this pattern doesn't apply.

## 4. Modes

| Mode | Critics | Exit condition |
|---|---|---|
| `score-retry` | 1 | score ≥ threshold |
| `multi-critic` | N independent (correctness, style, safety, domain) | **all** critics pass |
| `adversarial` | 1 attacker | output survives the attack (no unrebutted objection) |
| `judge-ensemble` | K judges | consensus (mean ≥ threshold **and** variance ≤ limit) |

## 5. Flow

```
generate → draft
loop_start { goal:"quality ≥ T", exit_mode:"target", target_value:T,
             direction:"increase", max_iterations:R, enforce:true }
repeat:
  score = critique(draft, rubric, mode)        // returns {score, issues[]}
  loop_tick { loop_id, state: issues.join(), progress: score }
  if !should_continue: break                   // target_reached | stalled | budget_exhausted
  draft = rewrite(draft, issues)
loop_end
```

`state = issues` means: if the critic keeps flagging the *same* issues, the ledger detects a stall and
releases the gate (rewriting isn't helping — escalate to a human) rather than looping.

## 6. Interfaces

### 6.1 Skill (`critique-gate`)
Encodes the generate/critique/rewrite loop and the four modes; triggers on "review/critique/tighten
this before it ships" phrasing.

### 6.2 Stop hook (`gate.mjs`, adapted)
Reuses `loop-ledger`'s gate. `ACTIVE.json` additionally records `last_score` and `threshold`; the hook
blocks while `last_score < threshold` **and** the loop is open, releases otherwise. Fail-open: if no
critique has run (misconfig), it logs and allows the stop rather than trapping the user.

### 6.3 Slash commands
`critique-score`, `critique-multi`, `critique-adversarial`, `critique-ensemble`.

### 6.4 Config
`CRITIQUE_THRESHOLD` (default 0.8 of 1.0), `CRITIQUE_MAX_RETRIES` (default 3),
`CRITIQUE_ENSEMBLE_K` (default 3), `CRITIQUE_ENFORCE` (default off).

## 7. Chaining

`critique-gate` is the **evaluate** node of the self-improvement chain
(see [SELF-IMPROVEMENT-CHAIN SPEC](./SELF-IMPROVEMENT-CHAIN_SPEC.md)): it produces the score that
`loop-ledger` uses as the exit metric, and the issues it finds become the raw material `reflexion`
turns into lessons. It also pairs with [`prompt-evolve`](./PROMPT-EVOLVE_SPEC.md), which reuses the
same critic as its scoring function over a test set.

## 8. Design decisions

- **Gate on quality by reusing the count-gate mechanism.** One proven Stop-hook pattern, two exit
  predicates — no new enforcement infrastructure.
- **Fail-open.** A quality gate that traps a session on misconfig is worse than one that logs and lets
  go; enforcement is opt-in per project.
- **Stall ⇒ release, not retry.** If rewrites stop moving the score, a human is needed — the ledger's
  stall detection already expresses this.

## 9. Open questions

1. **Self-critique bias.** Same model as generator and critic — is a persona/temperature split enough,
   or do we need genuinely different prompts per critic to avoid blind spots?
2. **Score calibration.** How stable is a 0–1 rubric score across runs? May need the judge-ensemble
   variance check by default.
3. **Where enforcement lives.** Project `.claude/settings.json` (like `loop-ledger`) vs plugin default.

## 10. Verification

- Unit: a draft with known defects scores below threshold, improves after rewrite, and the gate
  releases when it clears.
- Enforcement: with `CRITIQUE_ENFORCE=on`, session-end is blocked until threshold met or retries
  exhausted; a stalling case (unfixable issue) releases via `stalled`.
- `claude plugin validate` green.

## Provenance

Quality Loops (#1–5) from Rahul (@sairahul1), *"20 Loop Design Patterns Every AI Engineer Should
Know"* (x.com/sairahul1/status/2072258045460226373, Jul 1 2026). Enforcement mechanism from the repo's
`loop-ledger` Stop hook.
