# prompt-evolve — Concepts & Usage

Install, commands and examples are in the [plugin README](../../plugins/prompt-evolve/README.md). The
formal contract is in [SPEC.md](./SPEC.md).

## The problem

Most prompts are written once and never measured again. When one fails, someone edits it by hand and
hopes.

## The loop

1. Run the prompt on a held-out test set.
2. Score every output.
3. Find the cases that fail.
4. Rewrite the prompt from those failures.
5. Repeat, and keep every version on disk (`generations/v1.tmpl`, `v2.tmpl`, ...).

The report always names the **best** version so far, not the last one: rewrites do not improve
monotonically.

## No model calls of its own

`pevolve.py` is stdlib only, with no network and no model client. That is on purpose. It has two paths:

- **`score`** is the real path. Claude (or you) runs the prompt through a real model, writes the
  outputs to a file, and `score` grades them and keeps the generation. Grading can be a deterministic
  scorer, or Claude's own rubric grade (`--scorer rubric`, the critique-gate approach).
- **`run`** is an offline check of the harness itself. It renders the template and treats the rendered
  text as the output, so it only tests template-only checks. It is not a stand-in for a model.

## Where it fits

prompt-evolve is the System Optimization category of [agent-loops](../agent-loops/CONCEPTS.md), in a form
you can run. To bound an interactive evolve loop, wire loop-ledger with `progress` = `avg_score`; the
skill's Chaining section shows how.
