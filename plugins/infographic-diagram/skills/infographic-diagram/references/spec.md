# Spec schema

Build flags: `--png` (2x PNG via headless Chromium), `--strict` (exit 1 if the LINT report has issues).
Lint thresholds live at the top of `scripts/build.py`: `MIN_GAP = 32`, `PAD_IN = 16`.

```jsonc
{
  "title": "string",            // navy pill at top (optional)
  "subtitle": "string",         // line under the pill (optional)
  "width": 1200,                // canvas width; height auto-fits (or set "height")
  "background": "#FFFFFF",
  "panels": [ Panel ],
  "edges":  [ Edge ]
}
```

## Panel
| key | type | notes |
|---|---|---|
| id | string | required, used by edges |
| x, y, w, h | number | absolute px |
| theme | string | blue, indigo, purple, orange, green, teal, red, pink, slate |
| title, subtitle | string | header; subtitle adds ~22px to header height |
| icon | string | header icon name |
| style | `cards` \| `columns` \| `solid` | default `cards` |
| flow | bool | arrows between items (cards style) |
| footer | string | bracket + caption under items (~40px) |
| items | Item[] | laid out left→right, equal width |

Sizing guide: header ≈ 58px (80 with subtitle), 16px bottom pad, +40 for footer.
Card rows feel right at 80–100px tall; columns at 100–110px.
Minimum comfortable item width: ~95px for columns, ~150px for solid cards with side icon.

## Item
| key | notes |
|---|---|
| id | addressable as `"panelId.itemId"` in edges |
| label | `\n` for line breaks |
| sublabel | smaller grey line |
| icon | icon name |
| style | `soft` (default) or `solid` (cards panels only) |
| theme | override colour for this item |

## Edge
| key | notes |
|---|---|
| from, to | panel id or `panel.item` |
| fromSide, toSide | top/bottom/left/right (auto if omitted) |
| fromOffset, toOffset | 0–1 position along the side (disables auto-straighten) |
| midX, midY | elbow position override |
| detour | px outside the boxes for same-side U routes (default 36) |
| label | text pill on the longest segment |
| dashed, both | bool |
| theme | colour the line with a theme base colour |

## Icons
monitor globe web mobile watch code terminal bolt share network clipboard gear shield wrench
database layers vector rocket box wheel cpu server cloud user users lock key search file chart
sparkle mail message check queue stream bell clock card bank droplet git plug refresh
brain book folder tag store package

---

# `"type": "layers"`

```jsonc
{
  "type": "layers",
  "kicker": "CLAUDE CODE",          // small letter-spaced line above title (+ kicker_icon)
  "title": "...", "subtitle": "...", "byline": "...",
  "rail_width": 160,                 // width of side rails
  "gap": 18,                         // space between layers
  "layers": [{
    "theme": "olive|teal|orange|purple|green|blue|red|slate",
    "name": "SKILLS",                // big coloured word
    "tagline": "The Knowledge Layer",// italic serif
    "prefix": "Layer 2 — ",          // default "Layer N — "; "" to hide
    "n": 2,                          // badge number (default index+1)
    "h": 170,                        // row height; raise to ~200 when chips wrap to 2 lines
    "icon": "folder", "icon_label": "SKILL.md",
    "rows": [{"items": [{"label": "auto-\ninvoked", "icon": "bolt"}], "arrows": true, "align": "left"}],
    "note": "Event fires → Matcher checks → Command runs",
    "aside": {"icon": "shield", "text": "Deterministic. Not AI.", "w": 170}
  }],
  "rails": {
    "left":  {"title": "MCP Servers", "icon": "share", "theme": "orange", "bullets": ["..."], "arrows": "in|out|both"},
    "right": {...}
  },
  "summary": [{"icon": "file", "text": "CLAUDE.md sets rules", "theme": "olive"}]
}
```
Plain chip rows auto-wrap when too wide; arrow rows don't (a WARN is printed — shorten labels,
narrow the aside, or drop the rails). Rails span layers 2…N-1 and connect to the first and last layer.

# `"type": "tree"`

```jsonc
{
  "type": "tree",
  "icon": "brain", "icon_color": "violet",
  "title": "AI APPLICATION\nARCHITECTURE",
  "root": {"label": "User Request", "icon": "user", "color": "blue"},
  "rows": [
    [ Group, Group ],                       // plain array = one row
    {"dashed": true, "groups": [ Group ]}   // object form for row options
  ],
  "footer": "Follow ... for more"
}
// Group
{"title": "TOOLS (MCP)", "icon": "wrench", "color": "yellow",
 "items": [{"label": "GitHub", "icon": "git", "color": "white"}],
 "item_color": "white", "inline": false,
 "box": "Context Builder", "box_icon": "plug"}
```
Neon colours: green purple blue orange yellow pink cyan red violet white (or any hex).
Single-group rows render inline (icon beside title). Keep each row under ~1160px — the script warns.
