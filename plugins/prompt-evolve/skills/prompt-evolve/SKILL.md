---
name: prompt-evolve
description: >
  This skill should be used when asked to "optimize/tune/improve this prompt", "my prompt fails on
  X", "make this prompt more reliable", or otherwise wants to evolve a prompt against a held-out test
  set rather than hand-edit it once and hope. Runs a prompt (or has Claude run it interactively),
  scores every output, rewrites the prompt from its failures, and repeats — reporting best_so_far,
  never just the last attempt.
metadata:
  version: "0.1.0"
  author: "Ink"
---

# prompt-evolve

Turn "I tweaked the prompt and it feels better" into a measured loop: score against a test set, find
where it fails, rewrite from those failures, rerun. Every prompt generation is kept on disk
(`generations/v1.tmpl`, `v2.tmpl`, …) so the evolution is diffable and revertible, like any other file
under git.

Operate through `${CLAUDE_PLUGIN_ROOT}/scripts/pevolve.py` with the Bash tool. There is no MCP server
for this plugin and **the CLI itself never calls a model** (no network, stdlib only) — see below for
which of the two evolve paths applies.

## Data model

```
<prompt-evolve-dir>/
├── prompt.tmpl                 # current template — ONLY a literal {input} placeholder is supported
├── testset.jsonl                # {"input": ..., "expected"?: ..., "rubric"?: ...} one per line
├── generations/
│   ├── v1.tmpl  v2.tmpl …       # every prompt version, kept forever
│   └── scores.jsonl             # {version, avg_score, per_case:[{id,score,note}], failures:[id...]}
└── report.md                    # score curve + best version + failure summary (generated)
```

`prompt.tmpl` is rendered with plain `str.format(input=case["input"])`. Do not put any other
`{...}` in the template (e.g. a JSON example) — it will raise and `pevolve.py run` reports a clear
error rather than silently mangling it. If a template needs literal braces, that's a real limitation
of this narrow renderer, not something to work around silently.

## Two evolve paths — pick the right one

1. **Offline verification / demo (fully deterministic, no model call at all).** `pevolve.py run`
   renders the template with `str.format` and treats the rendered text itself as the "output" — it
   never calls a model. It is only useful for testing whether a *rendered template's literal text*
   satisfies a deterministic check (e.g. "contains this required instruction word"). Use it to sanity
   check the harness itself, or for genuinely template-only checks. Its scorers are `exact_match`
   (trimmed string equality vs `expected`), `regex` (`re.search(rubric, output)`), and `schema`
   (`json.loads(output)` is a dict containing every key in `rubric`, a JSON array of key names —
   deliberately narrow, NOT full JSON Schema).

2. **Interactive evolve (the default for a real prompt).** You — Claude — actually run the prompt:
   render `prompt.tmpl` for each case, produce the real output (calling whatever model/tool the prompt
   targets), and score it. The default *interactive* scorer is **critique-gate's rubric approach**:
   you read each case's `rubric` and judge the output against it yourself, the same way a human
   reviewer would grade a rubric — the CLI's deterministic `exact_match`/`regex`/`schema` scorers are
   the fallback for extraction-style tasks (where a literal/regex/JSON check really is "correct") and
   for the fully-offline `run` mode above. Write one `{"input": ..., "output": ...}` line per case (in
   the same order as `testset.jsonl` — matching is positional, not by content) to an outputs file, then
   persist the scores and the prompt you used:

   ```
   python3 pevolve.py score --dir <dir> --version <N> --outputs outputs.jsonl --save-prompt prompt.tmpl
   ```

   Rewrite `prompt.tmpl` from the reported `failures`, bump the version, re-render, re-score. Repeat
   until the score curve (see `report.md`) is good enough or plateaus.

## Workflow

1. **Set up.** Ensure `prompt.tmpl` and `testset.jsonl` exist in the target directory (`--dir` or
   `$PEVOLVE_DIR`).
2. **Evolve.** Pick a path above. For the interactive path, loop: render → generate → score (rubric
   judgment or a deterministic scorer) → `pevolve.py score --save-prompt` → rewrite from failures.
   For the offline path, `pevolve.py run` does the whole loop itself.
3. **Stop conditions** (same for both paths, conceptually): avg_score ≥ `--target`/`PEVOLVE_TARGET`
   (default 0.9), `--max-iter`/`PEVOLVE_MAX_ITER` generations reached (default 8), or no improvement
   for `--dry-rounds`/`PEVOLVE_DRY_ROUNDS` rounds (default 2) — report `best_so_far`, never the last
   attempt, since prompt rewrites aren't monotonic.
4. **Report.** `pevolve.py report` renders `report.md`: the score curve, the best version highlighted,
   and a failure summary (which case ids fail most often — feed those to `reflexion` as a lesson, or
   use them to hand-write the next test case).

## Chaining

`prompt-evolve` is the **system-optimization** node of the
[self-improvement chain](../../../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md). For a *bounded*
interactive evolve loop, wrap the workflow above in `loop-ledger`: call `loop_start` with
`exit_mode:"target"`, `target_value:<PEVOLVE_TARGET>`, `direction:"increase"`, `enforce:true`; after
each generation call `loop_tick` with `state` = a hash of the sorted failing case ids and
`progress` = `avg_score` (the ledger's own generic quality gate — no bespoke state machine needed);
stop when `should_continue` is false and report the loop's `status` (`target_reached` success,
`stalled` means the same cases keep failing and need human insight or better test cases — not more
retries, `dry`/`converged` means no new progress). Its default interactive scorer is critique-gate's
rubric approach (Claude scores each case, then calls `pevolve.py score` to persist it); its
deterministic scorers are the fallback for extraction-style tasks and the offline `run` verification
mode. Failure summaries from `report.md` feed [`reflexion`](../../../reflexion/README.md) as durable
lessons once a case fails repeatedly across evolve rounds.

## Notes

- Never hardcode paths; use `${CLAUDE_PLUGIN_ROOT}` for plugin files.
- `score`'s outputs-file matching is positional (line N ↔ testset case N) — preserve testset order
  when producing outputs.
- `run` is safe-by-default: it refuses to overwrite an existing `generations/scores.jsonl` unless
  `--force` (which starts a clean v1 evolution). It never touches a history the interactive path built.
- Everything is plain files under `--dir` — diffable and revertible under git like any other artifact.
- See `../../../../docs/proposals/PROMPT-EVOLVE_SPEC.md` for the formal spec (this implementation
  narrows a few points — the CLI never calls a model, and the offline `run` mode and `schema` scorer's
  rubric encoding are both intentionally narrow; see the plugin README for exactly what changed).
