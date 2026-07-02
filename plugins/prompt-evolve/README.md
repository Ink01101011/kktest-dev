# prompt-evolve

> Evolve a prompt against a test set: run/score it, find where it fails, rewrite from those failures,
> repeat. Deterministic scorers (exact-match/regex/schema) plus a fully offline verification loop;
> stdlib CLI + skill, no model calls of its own.

## Install

```
/plugin marketplace add Ink01101011/kktest-dev
/plugin install prompt-evolve@kktest-dev
```

## What it does

Most prompts get written once and never measured again. `prompt-evolve` turns tuning a prompt into a
loop: score it against a held-out test set, find where it fails, rewrite from those failures, rerun —
and keep every generation (`generations/v1.tmpl`, `v2.tmpl`, …) on disk so the evolution is diffable
and revertible under git, like the rest of this repo's plain-files-over-a-DB house style.

**This CLI never calls a model** (stdlib only, no network) — that's a deliberate constraint, not a
missing feature. It gives you two paths:

- **`run`** — a fully self-contained, deterministic, offline loop. It renders `prompt.tmpl` with plain
  `str.format(input=...)` and treats the rendered text itself as the "output"; three deterministic
  scorers (`exact_match`, `regex`, `schema`) check it; the improve step deterministically appends one
  new fact per generation, drawn from the first still-failing case's `expected`/`rubric`, so it
  provably converges within a bounded number of generations. Useful for verifying the harness itself,
  or for genuinely template-only checks — not a stand-in for actually running a real model.
- **`score`** — score an outputs file *you* (or Claude, interactively) produced by actually running the
  prompt through a real model. This is the path for real prompt-evolve work: Claude renders the
  prompt, generates the real output, judges it (critique-gate's rubric approach is the default
  interactive scorer) or runs it through a deterministic scorer, then calls `pevolve.py score` to
  persist the result and keep the generation on disk.

`report` renders `report.md`: the score curve (version → avg_score), the best version highlighted
(never just the last attempt — prompt rewrites aren't monotonic), and a failure summary of which case
ids fail most often.

## Components

| Component | What it is |
|---|---|
| Skill `prompt-evolve` | Teaches Claude the two evolve paths and the rewrite-from-failures loop; triggers on "optimize/tune this prompt" |
| Slash commands | `/prompt-evolve:prompt-evolve-run`, `/prompt-evolve:prompt-evolve-report` |
| CLI `scripts/pevolve.py` | `run` / `score` / `report` — stdlib only, no model calls, no MCP server |

## Setup

Requires only `python3` (no pip installs, no MCP server for this plugin).

```bash
export PEVOLVE_DIR="$HOME/.claude/projects/<your-project>/prompt-evolve"
```

Data model, per `docs/proposals/PROMPT-EVOLVE_SPEC.md` section 4:

```
<dir>/
├── prompt.tmpl                 # current template — ONLY a literal {input} placeholder is supported
├── testset.jsonl                # {"input": ..., "expected"?: ..., "rubric"?: ...} one per line
├── generations/
│   ├── v1.tmpl  v2.tmpl …       # every prompt version, kept forever
│   └── scores.jsonl             # {version, avg_score, per_case:[{id,score,note}], failures:[id...]}
└── report.md                    # score curve + best version + failure summary (generated)
```

## Usage

Via slash commands:

```
/prompt-evolve:prompt-evolve-run --scorer regex     # offline verification loop, or hand off to interactive scoring
/prompt-evolve:prompt-evolve-report                 # render report.md
```

Or the CLI directly:

```bash
# fully offline verification/demo — no model call, deterministic template rendering
python3 scripts/pevolve.py run --dir ./pe --scorer regex --target 0.9 --max-iter 8

# interactive path — you already generated outputs.jsonl by actually running the prompt
python3 scripts/pevolve.py score --dir ./pe --version 2 --outputs outputs.jsonl --save-prompt prompt.tmpl

python3 scripts/pevolve.py report --dir ./pe
```

`outputs.jsonl` for `score` is one `{"input": ..., "output": ...}` JSON object per line, **in the same
order as `testset.jsonl`** — matching is positional (line N ↔ case N), not by content. A count mismatch
is a hard error.

### Scorers

| Scorer | Case field used | Check |
|---|---|---|
| `exact_match` (default) | `expected` | trimmed string equality against the output |
| `regex` | `rubric` (a pattern string) | `re.search(rubric, output)` |
| `schema` | `rubric` (a JSON array of key names, e.g. `["name","age"]`) | `json.loads(output)` is a dict containing every listed key — **not** full JSON Schema, deliberately narrow |

One scoring function, `score_output()`, is shared by `run` and `score` — no duplicated logic.

## Config

Env vars (CLI flags always override):

| Var | Default | Meaning |
|---|---|---|
| `PEVOLVE_DIR` | `.` | default `--dir` |
| `PEVOLVE_TARGET` | `0.9` | `run` stops once avg_score ≥ target |
| `PEVOLVE_MAX_ITER` | `8` | `run` stops after this many generations regardless |
| `PEVOLVE_THRESHOLD` | `0.8` | per-case pass line used to build the `failures` list |
| `PEVOLVE_DRY_ROUNDS` | `2` | `run` stops if `best_so_far` hasn't improved in this many rounds |

## Safety

`run` refuses to overwrite an existing `generations/scores.jsonl` unless `--force` (which deletes the
existing generations and starts a clean v1 evolution) — it never silently clobbers a real interactive
`score` history. `score` and `report` never delete anything; `score` only appends to `scores.jsonl`.
Every generation, once written, stays on disk forever — `best_so_far` is always reported, never the
last attempt.

## What's narrowed vs. the spec

`docs/proposals/PROMPT-EVOLVE_SPEC.md` describes reusing `critique-gate` as the default scorer and
`loop-ledger`'s `gate.mjs` machinery directly inside this plugin. In this implementation:

- The CLI itself **never calls a model** — it has no MCP client and no network access. Interactive
  scoring (Claude acting as critique-gate's rubric judge) happens at the skill layer, not inside
  `pevolve.py`.
- There is no MCP server or bespoke Stop-hook state machine here. `loop-ledger`'s existing generic
  quality/optimization gate (`loop_start`/`loop_tick` with `exit_mode:"target"`) already covers the
  "bounded iteration" need once `progress` is defined as `avg_score` — see the skill's Chaining
  section for exactly how to wire it, called directly by name, not reimplemented.
- `run`'s `str.format(input=...)` rendering means a template must not contain any other `{...}` — it
  raises a clear error rather than silently escaping braces.
- The `schema` scorer's `rubric` encoding (a flat JSON array of required key names) is this
  implementation's own convention, not a JSON-Schema document.

See `../../docs/proposals/PROMPT-EVOLVE_SPEC.md` for the full spec and its place in the
[self-improvement chain](../../docs/proposals/SELF-IMPROVEMENT-CHAIN_SPEC.md).
