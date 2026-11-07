---
name: "infographic-diagram"
description: Create polished infographic-style architecture, layer and stack diagrams as SVG + PNG from a JSON spec, in three looks — light system map (panels + arrows), editorial numbered layer stack (cream, serif, side rails, summary strip), and dark neon category tree. Use this whenever the user wants a system architecture diagram, tech-stack overview, agent/LLM pipeline, microservice or monorepo map, data flow, request lifecycle, or "a diagram like this" from a screenshot — including Thai requests like "ทำ diagram", "วาด flow", "ทำ infographic สถาปัตยกรรม", "ภาพ architecture". Prefer it over Mermaid when the user wants something presentation-ready or shareable rather than a quick sketch.
---

# Infographic Diagram

Produces "tech explainer infographic" diagrams as a crisp SVG plus a 2x PNG, in three archetypes:

| `type` | answers | look | example |
|---|---|---|---|
| `map` (default) | how do components talk? | light tinted panels, cards, navy orthogonal arrows | `examples/langgraph-mcp.json` |
| `layers` | what is each layer for? | cream paper, serif title, numbered rows, asides, side rails, summary strip | `examples/clean-arch-layers.json` |
| `tree` | what's the landscape by category? | black bg, neon category icons, bracket tree | `examples/ts-fullstack-tree.json` |

**Before writing any spec, read `references/archetypes.md`** — it holds the thinking for each
archetype (what goes in a layer's aside, when to use rails, how to order rows). Pick the
archetype from the viewer's question; if the user shows a reference image, match its archetype.

The work is split so layout stays consistent: **you write a JSON spec, `scripts/build.py` draws it.**
Don't hand-write SVG for these — the script owns spacing, icons, shadows and arrow routing.

## Workflow

1. **Model the system first.** List the layers/groups (each becomes a panel) and the nodes inside
   them (cards/columns), then the arrows between them. Aim for 4–7 panels; more than ~8 gets noisy —
   merge or split into two diagrams.
2. **Sketch a grid on a 1200px-wide canvas.** Title + subtitle take y=0–150, so panels start at y≈170.
   Keep ~40px gutters so arrows have room. Typical flow: entry points top-left → core in the
   middle → dependencies right → infra at the bottom (see the example).
3. **Write the spec** (full schema: `references/spec.md`). Start from the example of the chosen archetype.
   For `layers`/`tree`, x/y are computed for you — you only supply content and order.
4. **Build with lint** (run it from this skill's base directory, or give the full path to `scripts/build.py`):
   `python3 scripts/build.py spec.json <out-dir>/name.svg --png --strict`
   (`python` on Windows). `<out-dir>`: on claude.ai use `/mnt/user-data/outputs`; in Claude Code
   use a folder the user names, or `./diagrams/` in the current project. `--png` needs the Python
   `playwright` package and its Chromium (`pip install playwright && python3 -m playwright install chromium`);
   without it, build the SVG only (drop `--png`) and say the PNG step was skipped and why.
   The build prints a `LINT:` report and `--strict` exits non-zero while issues remain:
   `TOO CLOSE` / `OVERLAP` (panels < 32px apart), `CANVAS` (spills off the page),
   `OVERFLOW` (title, subtitle, label or sublabel wider than its box), `LABEL` (edge pill sitting
   on a panel border), `CROSSING` (edge cutting through an unrelated panel).
   **Fix every lint issue by changing the spec, then rebuild — don't deliver with issues.**
5. **Then look at the PNG** (claude.ai: the view tool; Claude Code: the Read tool on the PNG path). Lint catches geometry; your eye still has to
   catch meaning (wrong arrow direction, awkward reading order, crowded panel).
6. Present the PNG (and SVG): on claude.ai with `present_files`; in Claude Code give the full paths
   of the files. Also hand over the spec JSON so the user can tweak it.

## `map`: spacing rules (coordinates are hand-placed, so plan them)

- Keep **≥ 32px** between any two panels; where an edge with a `label` runs through the gap, make
  the gap **≥ pill width + 24px** (pill ≈ 7px × characters + 18px). Short labels beat wide gaps.
- Size panels from their longest text, not by eye: title ≈ 12px/char at 22px bold, plus ~40px
  for the icon and 32px padding. A solid panel's text block = the wider of title and subtitle.
- Never butt two boxes edge to edge to "save space" — drop a row lower or narrow the neighbour.
- Lay out on a coarse grid (e.g. columns at x = 20, 400, 780 for 1200px) so gutters stay equal.

## `map`: choosing panel styles

| style | use for | look |
|---|---|---|
| `cards` (default) | components inside a layer | soft tinted cards with icon over label; set `"style":"solid"` per item for highlighted nodes |
| `cards` + `"flow": true` | a pipeline / state machine | arrows drawn between the cards automatically; add `"footer"` for a bracket caption |
| `columns` | a list of peers (clients, datastores, infra) | big icons, label + sublabel, thin dividers, no card borders |
| `solid` | one important single node (gateway, LB, broker) | whole panel filled with the theme colour, white text |

Themes: `blue indigo purple orange green teal red pink slate`. Give each architectural layer its own
theme, and use item-level `theme` to colour individual icons/cards (e.g. red cache, blue DB).

## `map`: arrows

- Prefer panel-to-panel edges. Card-level ids (`"panel.item"`) are fine when the route is clear,
  but routes that start inside a panel can cut through its footer — check the render.
- Sides are picked automatically; when boxes overlap on an axis the line is auto-straightened.
  Use `fromOffset`/`toOffset` (0–1 along the side) to fan several arrows into one box,
  `fromSide`/`toSide` to force direction, `midX`/`midY` to move the elbow, `label` for a pill,
  `dashed` for async/optional, `both` for two-way.

## Content rules

- Labels short: 1–3 words; break with `\n`. Put tech names in `sublabel` like `(Cache)`.
- Use the generic icons in `scripts/icons.py` (database, layers, vector, box, wheel, cpu, server,
  bolt, shield, gear, …). Product names go in text only; don't recreate company logos.
- Thai text works (Noto Sans Thai fallback); keep Thai labels shorter since glyph widths vary.
- Need an icon that isn't there? Add a simple 24×24 stroke path to `ICONS` in `scripts/icons.py`.
