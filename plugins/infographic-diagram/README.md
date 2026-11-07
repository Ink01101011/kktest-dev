# infographic-diagram

Presentation-ready **architecture, layer-stack and tech-stack diagrams** as a crisp SVG plus a 2x
PNG, built from a JSON spec. The agent (Claude or any other) writes the spec, and `scripts/build.py`
draws it, so spacing, icons, shadows and arrow routing stay consistent.

| `type` | Answers | Look |
|---|---|---|
| `map` (default) | How do the components talk? | Light tinted panels, cards, orthogonal arrows |
| `layers` | What is each layer for? | Cream paper, serif title, numbered rows, side rails, summary strip |
| `tree` | What is in the landscape, by category? | Black background, neon category icons, bracket tree |

The build lints the result (`--strict`) for panels that are too close or overlapping, panels,
edges and labels off the canvas, text wider (or wrapped text taller) than its room, layer chip
rows that no longer fit, labels sitting on borders, edges crossing panels, and unknown themes or
invalid colours. The exact list per archetype is in `SKILL.md`. Spec values that reach SVG
attributes are validated, and the PNG step renders the SVG as an image with JavaScript and
network access off.

Thai text works through the font stack (Noto Sans Thai, Leelawadee UI, Thonburi, Tahoma). Fonts
are not embedded, so the result depends on the fonts installed where it is rendered or viewed.

## Install

Inside Claude Code (2.1.275+):

```
/plugin install infographic-diagram --marketplace Ink01101011/kktest-dev
```

or from a shell:

```sh
claude plugin marketplace add Ink01101011/kktest-dev
claude plugin install infographic-diagram@kktest-dev
```

## Requirements

- Python 3.8+ (stdlib only) for the SVG.
- For the PNG (`--png`), the Python `playwright` package and its Chromium:
  `pip install playwright && python3 -m playwright install chromium`. Without them the build
  still writes the SVG, prints `PNG skipped: ...` and exits 3.
- Exit codes: 0 ok, 1 lint issues with `--strict`, 2 bad arguments or spec, 3 PNG not made.

## Use

Ask for a diagram ("ทำ diagram สถาปัตยกรรม…", "draw the request flow of…", "a tech-stack
overview like this screenshot"). You can also run the script directly:

```sh
python3 skills/infographic-diagram/scripts/build.py skills/infographic-diagram/examples/langgraph-mcp.json out/langgraph.svg --strict
```

Tests (stdlib only): `python3 -m unittest discover -s skills/infographic-diagram/scripts -p 'test_*.py'`.

The spec format is in `skills/infographic-diagram/references/spec.md`. The four examples under
`skills/infographic-diagram/examples/` cover each archetype, plus one Thai example.
