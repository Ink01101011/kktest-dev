---
description: Run the fully offline verification loop, or drive an interactive evolve/score cycle
allowed-tools: Bash, Read, Write
argument-hint: "[prompt-evolve-dir] [--scorer exact_match|regex|schema]"
---

Evolve a prompt against a test set in `$1` (or `$PEVOLVE_DIR`). This CLI never calls a model — pick
the path that matches what you're doing:

**Offline verification/demo** (deterministic scorer only, no model involved): run the self-contained
loop directly —

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/pevolve.py run ${1:+--dir "$1"} $ARGUMENTS`

This renders `prompt.tmpl` with plain `str.format(input=...)` per test case — the rendered text itself
is the "output" — scores it, and appends one deterministic hint (from the first still-failing case's
`expected`/`rubric`) per generation until the target is hit, it goes dry, or `--max-iter` is reached.
It refuses to overwrite an existing `generations/scores.jsonl` unless you pass `--force`.

**Interactive evolve** (you generate the real outputs): for each case in `testset.jsonl`, render
`prompt.tmpl` yourself and generate the actual output as you normally would (calling whatever model/tool
the prompt targets); score each case yourself against its `rubric` (critique-gate-style) if there's no
deterministic scorer; write one `{"input":..., "output":...}` line per case, in testset order, to an
outputs file — when you graded by rubric, also put your grade in each line as `"score"` (0 to 1) plus an
optional `"note"`; then persist the scores (`--scorer rubric` keeps your grades as-is; use
`exact_match`/`regex`/`schema` instead for a deterministic grader):

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/pevolve.py score --dir "$1" --version <N> --outputs <path> --scorer rubric --save-prompt prompt.tmpl`

Rewrite `prompt.tmpl` from the failures it reports, bump `<N>`, and repeat. Always keep every
generation — never overwrite `generations/vN.tmpl`. Report `best_so_far`, not the last attempt, when
summarizing to the user.
