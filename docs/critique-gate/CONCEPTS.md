# critique-gate — Concepts & Usage

Install and commands are in the [plugin README](../../plugins/critique-gate/README.md). The formal
contract is in [SPEC.md](./SPEC.md).

## The problem

The model that wrote a draft is a poor judge of it. It calls the draft "done" while a paragraph is still
vague.

## The idea

Split the **generator** from a distinct **critic**. The critic scores the draft against a rubric and
lists its issues. The draft is rewritten until the score clears a threshold or the retry budget runs
out.

critique-gate adds no machinery. Each mode is a documented way to call
[loop-ledger](../loop-ledger/CONCEPTS.md)'s MCP tools: the critic's score is `progress`, the critic's
open issues are `state`. loop-ledger decides when to stop, and its Stop hook enforces it when you ask
for that. So loop-ledger must be installed too.

## Four modes

| Mode | Command | Gates on |
|---|---|---|
| score-retry | `/critique-gate:critique-score` | one critic's score |
| multi-critic | `/critique-gate:critique-multi` | the weakest of N lenses |
| adversarial | `/critique-gate:critique-adversarial` | no unrebutted objection left |
| judge-ensemble | `/critique-gate:critique-ensemble` | the mean of K judges; a wide spread is reported |

## Stop means stop

If a rewrite does not change the critic's issue list, loop-ledger reports `stalled`. The rule is to
stop and tell the user, not to keep rewriting the same paragraph.

## Where it fits

agent-loops' `quality-loops` skill is the broad pattern reference for the same Quality loops.
critique-gate is the "just run it" version with fixed defaults and one command per mode. prompt-evolve
uses the same rubric approach as its interactive scorer.
