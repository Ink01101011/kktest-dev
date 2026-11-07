# Archetypes — how to think before drawing

Three looks, distilled from popular tech-explainer infographics. Choose by **what question the
viewer is asking**, not by which looks nicest. Each archetype is a `"type"` in the spec.

## 1. `map` — "How do the pieces talk to each other?"
*Light system map: tinted panels per layer, cards inside, thick navy orthogonal arrows.*

Thinking:
- Nodes are **runtime components**; arrows are **requests/data flow**. If an arrow can't be
  described as a verb ("calls", "reads", "publishes"), it probably shouldn't exist.
- Read order = request order: entry point top-left → gateway → core → dependencies on the right
  → infra/deploy along the bottom.
- One colour per architectural layer; inside a panel, colour individual nodes only to mark
  different technology families (cache red, DB blue, vector green).
- A pipeline inside a component (planner → executor → validator) becomes a `flow` card row with a
  bracket `footer` naming the mechanism ("Agent State Machine").
- Fan-in/fan-out: several arrows landing on one panel at spread `toOffset`s reads as "many
  sources write here".

## 2. `layers` — "What is each layer for, and why does it exist?"
*Editorial cream paper, serif title, numbered layer rows, side rails, bottom summary strip.*

Thinking:
- This is a **concept explainer**, not a runtime diagram. Each layer answers three things:
  1. **Name + role** → `name` (CAPS, coloured) + `tagline` in italic ("The Memory Layer").
  2. **Mechanism** → chips in `rows`; use `arrows: true` when it is a sequence
     (event fires → matcher checks → command runs), plain chips when it is a set of members.
  3. **The one insight** → `aside`: a 1–2 line takeaway or analogy ("Think Git hooks for your
     agent", "Always loaded. Always active."). Analogies to things the reader already knows
     are the most valuable sentence in the layer.
- Order layers so each builds on the one above (foundation first, distribution last).
- **Rails** are cross-cutting concerns that touch several layers (external integrations, teams,
  testing, DI). Keep 3–5 short bullets.
- **Summary strip** retells the whole stack as one sentence chain — one verb per layer
  ("sets rules → provides expertise → enforces quality → delegates → distributes").
- A `note` under chips states the rule of the mechanism in one line.

## 3. `tree` — "What is the whole landscape, by category?"
*Dark neon taxonomy: root request at top, category groups branching down, item icons below.*

Thinking:
- It is a **catalogue**, not a flow: categories (frontend, orchestration, models, tools, data,
  observability, deploy) with 3–4 representative members each. Resist adding a 5th or 6th item.
- Top-to-bottom = closer-to-user → closer-to-metal.
- Put parallel concerns on the same row (frontend ‖ orchestration; knowledge ‖ models ‖ tools).
  Rows with one group render inline (icon beside title) to change rhythm.
- Use `dashed: true` on a row to signal "these converge/feed into" rather than "contains".
- A group's `box` (e.g. "Context Builder") gathers its items into one derived output.
- Each category has one neon colour; item icons stay white unless colour carries meaning.
- Ends with a one-line footer (credit, takeaway, or call to action).

## Shared rules
- 4–7 top-level groups. More → split into two images.
- Labels 1–3 words. Explanations belong in `aside`, `note`, `subtitle` or the summary strip.
- Generic icons only; product names live in text. Don't redraw vendor logos.
- Always render, look at the PNG, and fix overflow/overlap before delivering.
