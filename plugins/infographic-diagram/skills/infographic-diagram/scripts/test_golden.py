"""Byte-identical output pin for the render refactor (issue #23, G6 S16).

Each case is rendered and hashed (SVG text, lint issues, canvas size). The hashes were taken BEFORE the long render
functions were split into helpers, so any change in output turns this red. When output is meant to change, re-pin:
  python3 plugins/infographic-diagram/skills/infographic-diagram/scripts/test_golden.py --print
and paste the printed table over GOLDEN (say why in the commit).
"""
import copy
import hashlib
import json
import os
import sys
import unittest

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402

EXAMPLES = os.path.join(os.path.dirname(HERE), "examples")


def _layers_full():
    rows = [{"items": [{"label": "alpha", "icon": "box"}, {"label": "beta"}, {"label": "two\nlines", "icon": "db"}]},
            {"arrows": True, "items": [{"label": "in"}, {"label": "step", "icon": "gear"}, {"label": "out"}]},
            {"align": "left", "items": [{"label": "left aligned chip"}]}]
    return {"type": "layers", "kicker": "KICKER", "kicker_icon": "bolt", "title": "Layers", "subtitle": "Sub",
            "byline": "by someone", "rail_width": 150, "gap": 22, "background": "#fffaf0",
            "rails": {"left": {"title": "Left rail title", "icon": "user", "bullets": ["one", "two words here", 3],
                               "arrows": "both", "theme": "teal"},
                      "right": {"title": "R", "bullets": ["x"], "arrows": "out", "theme": "nope"}},
            "layers": [{"name": "ONE", "theme": "teal", "tagline": "the first", "icon": "box", "icon_label": "lbl",
                        "aside": {"text": "an aside that wraps over a few lines of text", "icon": "info", "w": 180},
                        "note": "a note", "rows": rows, "h": 260},
                       {"name": "TWO", "theme": "purple", "prefix": "", "n": "B", "rows": rows[:1]},
                       {"name": "THREE", "theme": "bogus", "rows": [{"items": [{"label": "w" * 40}] * 6}],
                        "aside": {"text": "x " * 80}}],
            "summary": [{"text": "first summary", "icon": "check"}, {"text": "second", "theme": "red"},
                        {"text": "third with a longer text that wraps"}]}


def _layers_overflow():
    return {"type": "layers", "title": "T" * 60, "width": 600,
            "rails": {"right": {"title": "Rail", "bullets": ["b " * 30] * 6}},
            "layers": [{"name": "N" * 30, "tagline": "tag " * 10, "h": 60,
                        "rows": [{"items": [{"label": "c" * 30}]}, {"arrows": True, "items": [{"label": "z" * 50}] * 3}]}]}


def _tree_full():
    return {"type": "tree", "icon": "spark", "icon_color": "#123456", "title": "Tree\nTitle",
            "root": {"label": "Root", "icon": "user", "color": "pink"}, "footer": "footer text", "background": "#000",
            "rows": [[{"title": "Solo", "icon": "box", "items": [{"label": "a"}, {"label": "b", "color": "red"}],
                       "box": "Boxed", "box_icon": "plug"}],
                     {"dashed": True, "groups": [{"title": "G1", "icon": "db", "color": "cyan", "items": [{"label": "x"}]},
                                                 {"title": "G2", "inline": True, "icon": "gear", "item_color": "yellow",
                                                  "items": [{"label": "y", "icon": "cloud"}, {"label": "z"}], "box": "B2"},
                                                 {"title": "G3", "color": "not-a-colour"}]}]}


def _tree_overflow():
    return {"type": "tree", "width": 500, "footer": "f" * 80,
            "rows": [[{"title": "W" * 20, "items": [{"label": "l" * 20}] * 5}, {"title": "Q"}]]}


def _map_full():
    return {"title": "Map", "subtitle": "sub", "width": 1400, "height": 900,
            "panels": [{"id": "a", "x": 20, "y": 170, "w": 360, "h": 220, "title": "Cards", "subtitle": "s", "icon": "box",
                        "flow": True, "footer": "foot",
                        "items": [{"id": "i", "label": "Item", "icon": "db", "sublabel": "sub"},
                                  {"label": "Solid", "style": "solid", "icon": "gear", "sublabel": "s2"},
                                  {"label": "Two\nlines", "theme": "green"}]},
                       {"id": "b", "x": 520, "y": 170, "w": 340, "h": 220, "title": "Cols", "style": "columns", "theme": "purple",
                        "items": [{"label": "c1", "icon": "user", "sublabel": "x"}, {"label": "c2", "theme": "orange"}]},
                       {"id": "c", "x": 520, "y": 520, "w": 300, "h": 100, "title": "Gateway", "subtitle": "solid", "style": "solid",
                        "icon": "bolt", "theme": "green"},
                       {"id": "d", "x": 20, "y": 520, "w": 200, "h": 120, "title": "Plain"},
                       {"id": "e", "x": 1000, "y": 170, "w": 300, "h": 160, "title": "Wide solid items",
                        "items": [{"label": "Wide", "style": "solid", "icon": "cloud"}]}],
            "edges": [{"from": "a", "to": "b", "label": "auto"},
                      {"from": "a.i", "to": "c", "fromSide": "bottom", "toSide": "left", "label": "elbow", "dashed": True},
                      {"from": "c", "to": "d", "fromSide": "bottom", "toSide": "bottom", "detour": 50, "both": True},
                      {"from": "b", "to": "c", "label": "straight", "theme": "red"},
                      {"from": "d", "to": "a", "fromSide": "right", "toSide": "right", "midX": 400},
                      {"from": "b", "to": "e", "fromOffset": 0.2, "toOffset": 0.8, "label": "offsets"},
                      {"from": "e", "to": "d", "fromSide": "left", "toSide": "top", "midY": 450},
                      {"from": "c", "to": "e", "fromSide": "top", "toSide": "bottom", "midY": 100, "theme": "x"}]}


def _map_lint():
    return {"title": "L" * 80, "width": 800, "height": 300,
            "panels": [{"id": "a", "x": -10, "y": 10, "w": 300, "h": 200, "title": "A" * 40, "theme": "nope",
                        "items": [{"label": "i" * 40}, {"label": "j", "sublabel": "s" * 40}]},
                       {"id": "b", "x": 295, "y": 20, "w": 300, "h": 320, "title": "B"},
                       {"id": "c", "x": 650, "y": 20, "w": 200, "h": 100, "title": "C", "style": "solid", "subtitle": "x" * 50}],
            "edges": [{"from": "a", "to": "c", "label": "a long label that will not fit in the gap"},
                      {"from": "c", "to": "b", "fromSide": "top", "toSide": "top", "detour": 400}]}


def cases():
    out = {}
    for n in sorted(f for f in os.listdir(EXAMPLES) if f.endswith(".json")):
        with open(os.path.join(EXAMPLES, n), encoding="utf-8") as f:
            out["examples/" + n] = json.load(f)
    out.update({"layers-full": _layers_full(), "layers-overflow": _layers_overflow(), "tree-full": _tree_full(),
                "tree-overflow": _tree_overflow(), "map-full": _map_full(), "map-lint": _map_lint()})
    return out


def digest(spec):
    svg, issues, size = build.build(copy.deepcopy(spec))
    h = hashlib.sha256()
    h.update(svg.encode("utf-8"))
    h.update(b"\0" + "\n".join(issues).encode("utf-8") + b"\0" + repr(size).encode())
    return h.hexdigest()


GOLDEN = {
    "examples/clean-arch-layers.json": "861628a3f236ffe011bf885ebba3382fb57015d1745a224dd22eddb5713ce346",
    "examples/langgraph-mcp.json": "84c7a1831e3941040f5a6cb6602d55e9c0da5da5a5efe02a44b8e3d57773ddf8",
    "examples/ts-fullstack-tree.json": "ded36b3f8729fad38123f2175288f61bee7245834a126348d2c379b00d50b1e6",
    "examples/water-tracker-th.json": "72d8b9a20c68507b34e78639caf68d6cc3763b294359456e24fe69d4a8a73f32",
    "layers-full": "9b0d7ead09b89db8168f26d467b8637f96516b3ce7076127cfeeb51c0f97650d",
    "layers-overflow": "e3f5827334e5d9e8e010f6e201459136d6366c16c740ee996982ad82215cde9a",
    "tree-full": "9f4258c8817adb59dcd393e1d321f60b58ae2c15b68d2981c8f8bd21810ff189",
    "tree-overflow": "8cbc92910cd66923f6d3254a8350ec07f3bce72c909c77ad5153597a593c6bc7",
    "map-full": "0241eeadd9e6bb8658907cf8401ebed0f7ac2dbfad663660ccb1446bc88af21c",
    "map-lint": "a2a477b229d3832d3635558cab167c4737cf6839fb9291406bdccd3e2b89f2b6",
}


class Golden(unittest.TestCase):
    def test_every_case_renders_byte_identical(self):
        cs = cases()
        self.assertEqual(sorted(cs), sorted(GOLDEN), "a case was added or removed: re-pin with --print")
        for name, spec in cs.items():
            with self.subTest(case=name):
                self.assertEqual(digest(spec), GOLDEN[name], f"{name}: output changed")

    def test_cases_reach_the_lint_branches(self):
        # the pin is only as good as what the cases exercise: the lint-heavy cases must report issues
        for name in ("layers-overflow", "tree-overflow", "map-lint", "layers-full", "tree-full"):
            with self.subTest(case=name):
                self.assertTrue(build.build(copy.deepcopy(cases()[name]))[1], f"{name}: expected lint issues")


if __name__ == "__main__":
    if "--print" in sys.argv:
        for name, spec in cases().items():
            print(f'    "{name}": "{digest(spec)}",')
    else:
        unittest.main()
