# infographic-diagram — Specification

Formal reference, checked against the code on 2026-11-08. For the idea see [CONCEPTS.md](./CONCEPTS.md).

## 1. Components

All under `plugins/infographic-diagram/skills/infographic-diagram/`:

| File | Role |
|---|---|
| `SKILL.md` | when to draw, how to write the spec, the lint list per archetype |
| `references/spec.md` | the JSON spec format |
| `references/archetypes.md` | choosing `map`, `layers` or `tree` |
| `scripts/build.py` | CLI entry, `map` renderer, lint, PNG step |
| `scripts/common.py`, `layers.py`, `tree.py`, `icons.py` | shared helpers, the `layers` and `tree` renderers, icons |
| `examples/*.json` | `langgraph-mcp` (map), `clean-arch-layers` (layers), `ts-fullstack-tree` (tree), `water-tracker-th` (Thai) |
| `scripts/test_build.py`, `test_golden.py` | unit tests and golden SVG hashes (not shipped in the npm package) |

Python 3.8+, stdlib only. The PNG step needs the `playwright` package and its Chromium.

## 2. CLI

```
python3 scripts/build.py [--png] [--png-out PATH] [--strict] SPEC OUT
```

| Argument | Meaning |
|---|---|
| `SPEC` | spec JSON (UTF-8, BOM allowed) |
| `OUT` | SVG path; missing folders are created |
| `--png` | also write a 2x PNG next to the SVG |
| `--png-out PATH` | write the PNG to `PATH` (implies `--png`) |
| `--strict` | exit 1 while the lint report has issues |

Exit codes: 0 ok, 1 lint issues with `--strict`, 2 bad arguments or spec, 3 PNG not made (SVG kept).

## 3. Lint

The build always prints a lint report. It flags panels too close or overlapping; panels, edges and
labels off the canvas; text wider (or wrapped text taller) than its room; layer chip rows that no longer
fit; labels on borders; edges crossing panels; unknown themes and invalid colours. `SKILL.md` has the
exact list per archetype.

## 4. Safety

- Spec values that reach SVG attributes are validated first (colours, ids, numbers), so a spec cannot
  inject markup.
- The PNG renders the SVG as an image in a page with JavaScript and network access off.

## 5. Tests

`python3 -m unittest discover -s plugins/infographic-diagram/skills/infographic-diagram/scripts -p "test_*.py"`
(run in CI on Linux, macOS and Windows). `test_golden.py` pins the SVG bytes of the examples and of extra
specs that cover every layout branch; `python3 scripts/test_golden.py --print` re-pins after an intended
change.
