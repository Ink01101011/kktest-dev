# infographic-diagram — Concepts & Usage

Install, requirements and examples are in the [plugin README](../../plugins/infographic-diagram/README.md).
The spec format is in the skill's [references/spec.md](../../plugins/infographic-diagram/skills/infographic-diagram/references/spec.md).
The formal contract is in [SPEC.md](./SPEC.md).

## The idea

A model is good at deciding *what* goes in a diagram and bad at pixel layout. So the agent writes a
small JSON spec (panels, cards, layers, edges), and a deterministic script draws it. Spacing, icons,
shadows and arrow routing then stay the same every time, and a lint pass catches layouts that break.

## Three archetypes

| `type` | Answers | Look |
|---|---|---|
| `map` (default) | How do the components talk? | light tinted panels, cards, orthogonal arrows |
| `layers` | What is each layer for? | cream paper, numbered rows, side rails, summary strip |
| `tree` | What is in the landscape, by category? | black background, neon icons, bracket tree |

[references/archetypes.md](../../plugins/infographic-diagram/skills/infographic-diagram/references/archetypes.md)
says which one fits a request.

## Output

An SVG always. A 2x PNG with `--png`, rendered from the SVG in a headless Chromium page (playwright)
with JavaScript and network off. Without playwright the SVG is still written and the PNG step is
skipped (exit 3).

## Thai text

Thai works through the font stack (Noto Sans Thai, Leelawadee UI, Thonburi, Tahoma). Fonts are not
embedded, so the look depends on the fonts where the file is viewed.

## Other AI tools

The skill exports to other tools (`npx kktest-dev`, tier "with fallbacks": needs python3; the PNG needs
playwright + Chromium, which sandboxed web hosts usually lack).
