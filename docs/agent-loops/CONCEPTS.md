# agent-loops — Concepts & Usage

Install and the skill list are in the [plugin README](../../plugins/agent-loops/README.md). The formal
contract is in [SPEC.md](./SPEC.md).

## The problem

Most agents do one pass: prompt, answer, done. The loops that improve output (generate, evaluate,
learn, improve) get reinvented each time. Two things go wrong:

1. There is no shared playbook for *which* loop shape fits *which* task.
2. There is often no ground-truth exit, so the loop quits too early or never stops.

agent-loops fixes the first: it is a playbook. [loop-ledger](../loop-ledger/CONCEPTS.md) fixes the
second: it is the brake. Install both.

## Five categories

| Category | Skill | Patterns |
|---|---|---|
| Quality | `quality-loops` | Generate→Critique→Rewrite, Score-and-Retry, Multi-Critic, Adversarial Critique, Judge Ensemble |
| Memory | `memory-loops` | Reflexion, Memory Update, Error Library, Success Pattern, Memory Compression |
| Planning | `planning-loops` | Plan→Execute→Replan, Dynamic Workflow, Goal Decomposition, Progress Evaluation, Constraint Satisfaction |
| Exploration | `exploration-loops` | Branch-and-Explore, Tree Search, Debate |
| System Optimization | `system-optimization-loops` | Prompt Optimization, Workflow Optimization |

`loop-selector` is the router: describe the task and it names the category, the pattern and the
`loop_start` call.

Each pattern says when to use it, when not to, its minimal shape, and the exact loop-ledger brake
("Wire the brake").

## Turnkey versions

Three categories have a plugin that runs them:

- Quality → [critique-gate](../critique-gate/CONCEPTS.md)
- Memory → [bantamkit](https://github.com/Ink01101011/bantamkit)'s memory tools (and the
  [reflexion](../reflexion/CONCEPTS.md) plugin, which bantamkit absorbed)
- System Optimization → [prompt-evolve](../prompt-evolve/CONCEPTS.md)

## Without loop-ledger

The patterns still apply, but the "Wire the brake" sections are design intent only: there is nothing to
call.
