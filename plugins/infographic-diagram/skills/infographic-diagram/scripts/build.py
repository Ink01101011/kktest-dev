#!/usr/bin/env python3
"""Render an infographic-style architecture/flow diagram from a JSON spec.

Archetypes (spec "type"): map (default) | layers | tree  -- see ../references/archetypes.md

Usage:
  python build.py spec.json out.svg            # SVG only
  python build.py spec.json out.svg --png      # also out.png (2x, needs playwright)

Spec reference: ../references/spec.md
"""
import json, sys, os, html
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from icons import icon

THEMES = {
    #          base       panel      soft       ink
    "blue":   ("#2563EB", "#EEF4FF", "#DCE8FF", "#1E3A8A"),
    "indigo": ("#4F46E5", "#EFEFFF", "#E0E0FF", "#312E81"),
    "purple": ("#7C5CD6", "#F3F0FF", "#E6DFFF", "#3B2F8F"),
    "orange": ("#E8891C", "#FFF5E8", "#FFE6C4", "#7A3D00"),
    "green":  ("#2F9E5B", "#EDF9F1", "#D4F1DF", "#14532D"),
    "teal":   ("#0EA5B7", "#E9FAFC", "#CDEFF4", "#0F4C5C"),
    "red":    ("#DC4A3F", "#FFF0EE", "#FFDCD8", "#7F1D1D"),
    "pink":   ("#D9468F", "#FFF0F7", "#FFDCEC", "#831843"),
    "slate":  ("#475569", "#F3F5F8", "#E2E8F0", "#1E293B"),
}
NAVY = "#13265C"
EDGE = "#1E2B4D"
MUTED = "#4B5563"
MIN_GAP = 32      # min px between top-level panels (edge label pills need ~pill width + 24)
PAD_IN = 16       # inner text padding of a panel
FONT = "Inter, 'Noto Sans Thai', 'Segoe UI', Helvetica, Arial, sans-serif"


def esc(s):
    return html.escape(str(s), quote=True)


def text(x, y, s, size, color, weight=400, anchor="middle", family=None, italic=False, ls=None, filt=None):
    lines = str(s).split("\n")
    lh = size * 1.22
    y0 = y - (len(lines) - 1) * lh / 2
    extra = ""
    if family:
        extra += f' font-family="{family}"'
    if italic:
        extra += ' font-style="italic"'
    if ls:
        extra += f' letter-spacing="{ls}"'
    if filt:
        extra += f' filter="url(#{filt})"'
    out = []
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x:.1f}" y="{y0 + i*lh:.1f}" font-size="{size}" '
                   f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}" '
                   f'dominant-baseline="central"{extra}>{esc(ln)}</text>')
    return "".join(out)


def wrap(s, size, width, weight=400):
    """Greedy word wrap using approx_w; keeps explicit \n breaks."""
    out = []
    for para in str(s).split("\n"):
        line = ""
        for word in para.split(" "):
            cand = (line + " " + word).strip()
            if line and approx_w(cand, size, weight) > width:
                out.append(line)
                line = word
            else:
                line = cand
        out.append(line)
    return "\n".join(out)


def approx_w(s, size, weight=400):
    """Estimate rendered width (Inter-like metrics; Thai combining marks count as 0)."""
    def w(line):
        t = 0.0
        for ch in line:
            o = ord(ch)
            if 0x0E31 == o or 0x0E34 <= o <= 0x0E3A or 0x0E47 <= o <= 0x0E4E:
                continue                      # Thai vowels/tone marks above/below
            if ch in "—–":
                t += 0.95
            elif ch.isupper() or ch in "MW@%":
                t += 0.66
            elif ch in " .,:;'|!()-ilj1/":
                t += 0.30
            else:
                t += 0.52
        return t
    longest = max((w(l) for l in str(s).split("\n")), default=0)
    return longest * size * (1.06 if weight >= 600 else 1.0)


class Diagram:
    def __init__(self, spec):
        self.spec = spec
        self.W = spec.get("width", 1200)
        self.boxes = {}       # id -> (x, y, w, h)
        self.parts = []
        self.issues = []

    # ---------- panels ----------
    def panel(self, p):
        base, tint, soft, ink = THEMES[p.get("theme", "blue")]
        x, y, w, h = p["x"], p["y"], p["w"], p["h"]
        self.boxes[p["id"]] = (x, y, w, h)
        P = self.parts
        P.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{tint}" '
                 f'stroke="{base}" stroke-width="2.5" filter="url(#sh)"/>')

        style = p.get("style", "cards")   # cards | columns | solid (whole panel = one node)
        if style == "solid":
            # single highlighted node, e.g. "API Gateway"
            P[-1] = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{base}" '
                     f'filter="url(#sh)"/>')
            has_sub = bool(p.get("subtitle"))
            cy = y + h / 2
            tw = approx_w(p["title"], 24, 700)
            sw = approx_w(p["subtitle"], 15, 500) if has_sub else 0
            bw = max(tw, sw)                       # text block width
            ic = 34 if p.get("icon") else 0
            gap = 14 if ic else 0
            self.check(p["title"], 24, 700, w - 2 * PAD_IN - ic - gap, f'panel "{p["id"]}" title')
            if has_sub:
                self.check(p["subtitle"], 15, 500, w - 2 * PAD_IN - ic - gap, f'panel "{p["id"]}" subtitle')
            tx = x + w / 2 + (ic + gap) / 2          # centre of text block
            if ic:
                P.append(icon(p["icon"], tx - bw / 2 - gap - ic, cy - ic / 2, ic, "#fff", 2.2))
            P.append(text(tx, cy - (12 if has_sub else 0), p["title"], 24, "#fff", 700))
            if has_sub:
                P.append(text(tx, cy + 18, p["subtitle"], 15, "#E6EEFF", 500))
            return

        # header
        hy = y + 34
        tw = approx_w(p["title"], 22, 700)
        ic = 28 if p.get("icon") else 0
        gap = 10 if ic else 0
        self.check(p["title"], 22, 700, w - 2 * PAD_IN - ic - gap, f'panel "{p["id"]}" title')
        if p.get("subtitle"):
            self.check(p["subtitle"], 15, 600, w - 2 * PAD_IN, f'panel "{p["id"]}" subtitle')
        tx = x + w / 2 + (ic + gap) / 2
        if ic:
            P.append(icon(p["icon"], tx - tw / 2 - gap - ic, hy - ic / 2, ic, ink, 2.1))
        P.append(text(tx, hy, p["title"], 22, "#111827", 700))
        top = y + 58
        if p.get("subtitle"):
            P.append(text(x + w / 2, y + 60, p["subtitle"], 15, "#1F2937", 600))
            top = y + 80

        items = p.get("items", [])
        if not items:
            return
        footer = p.get("footer")
        bottom = y + h - 16 - (40 if footer else 0)
        pad, gapc = 18, (34 if p.get("flow") else 14)
        n = len(items)
        cw = (w - 2 * pad - (n - 1) * gapc) / n
        ch = bottom - top
        for i, it in enumerate(items):
            cx = x + pad + i * (cw + gapc)
            iid = f'{p["id"]}.{it.get("id", i)}'
            self.boxes[iid] = (cx, top, cw, ch)
            if style == "columns":
                self.column(cx, top, cw, ch, it, base, ink)
                if i < n - 1:
                    lx = cx + cw + gapc / 2
                    P.append(f'<line x1="{lx}" y1="{top+6}" x2="{lx}" y2="{bottom-6}" '
                             f'stroke="{base}" stroke-opacity=".35" stroke-width="1.5"/>')
            else:
                self.card(cx, top, cw, ch, it, base, soft, ink)
            if p.get("flow") and i < n - 1:
                ax = cx + cw + 4
                ay = top + ch / 2
                P.append(f'<line x1="{ax}" y1="{ay}" x2="{ax+gapc-10}" y2="{ay}" stroke="{EDGE}" '
                         f'stroke-width="3" marker-end="url(#ah)"/>')
        if footer:
            fx1, fx2 = x + pad + 30, x + w - pad - 30
            fy = bottom + 8
            mid = (fx1 + fx2) / 2
            P.append(f'<path d="M{fx1} {fy} q0 10 10 10 H{mid-10} q10 0 10 8 q0 -8 10 -8 '
                     f'H{fx2-10} q10 0 10 -10" fill="none" stroke="{EDGE}" stroke-width="2"/>')
            P.append(text(mid, fy + 32, footer, 15, "#111827", 600))

    def card(self, x, y, w, h, it, base, soft, ink):
        P = self.parts
        kind = it.get("style", "soft")
        theme = it.get("theme")
        if theme:
            base, _, soft, ink = THEMES[theme]
        if kind == "solid":
            P.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="12" '
                     f'fill="{base}" filter="url(#sh2)"/>')
            ic = min(40, h * 0.5)
            sub = it.get("sublabel")
            if w >= 150 and it.get("icon"):
                P.append(icon(it["icon"], x + 16, y + h / 2 - ic / 2, ic, "#fff", 2.2))
                tx = x + 16 + ic + 12 + (w - ic - 44) / 2
            else:
                if it.get("icon"):
                    P.append(icon(it["icon"], x + w / 2 - ic / 2, y + 12, ic, "#fff", 2.2))
                tx = x + w / 2
            ty = y + h / 2 if w >= 150 or not it.get("icon") else y + 12 + ic + (h - ic - 12) / 2
            self.check(it["label"], 17, 650, w - (ic + 24 if w >= 150 and it.get("icon") else 0))
            P.append(text(tx, ty - (9 if sub else 0), it["label"], 17, "#fff", 650))
            if sub:
                self.check(sub, 13, 500, w - (ic + 24 if w >= 150 and it.get("icon") else 0), "card sublabel")
                P.append(text(tx, ty + 14, sub, 13, "#EEF2FF", 500))
        else:
            P.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="12" '
                     f'fill="{soft}" stroke="{base}" stroke-opacity=".55" stroke-width="1.5"/>')
            ic = min(30, h * 0.32)
            lab = it["label"]
            nl = lab.count("\n") + 1 + (1 if it.get("sublabel") else 0)
            block = ic + 8 + nl * 19
            iy = y + (h - block) / 2
            if it.get("icon"):
                P.append(icon(it["icon"], x + w / 2 - ic / 2, iy, ic, ink, 2.2))
            ly = iy + ic + 8 + (lab.count("\n") + 1) * 19 / 2
            self.check(lab, 15, 600, w)
            P.append(text(x + w / 2, ly, lab, 15, "#111827", 600))
            if it.get("sublabel"):
                self.check(it["sublabel"], 13, 500, w, "card sublabel")
                P.append(text(x + w / 2, ly + 19 + lab.count("\n") * 9, it["sublabel"], 13, MUTED, 500))

    def column(self, x, y, w, h, it, base, ink):
        P = self.parts
        color = THEMES[it["theme"]][0] if it.get("theme") else base
        ic = min(46, h * 0.45)
        sub = it.get("sublabel")
        block = ic + 10 + 20 + (18 if sub else 0)
        iy = y + (h - block) / 2
        if it.get("icon"):
            P.append(icon(it["icon"], x + w / 2 - ic / 2, iy, ic, color, 2.0))
        ly = iy + ic + 10 + 10
        fs = 16 if w >= 120 else 14
        self.check(it["label"], fs, 650, w)
        P.append(text(x + w / 2, ly, it["label"], fs, "#111827", 650))
        if sub:
            self.check(sub, fs - 2, 500, w, "column sublabel")
            P.append(text(x + w / 2, ly + 20, sub, fs - 2, MUTED, 500))

    def check(self, s, size, weight, avail, where="label"):
        need = approx_w(s, size, weight)
        if need > avail - 4:
            self.issues.append(f"OVERFLOW  {where}: '{s}' needs ~{need:.0f}px, has {avail-4:.0f}px "
                               "-> widen the box, break with \\n, or shorten")

    def lint_layout(self):
        """Spacing/overlap rules for top-level panels (hand-placed coordinates)."""
        tops = [(pid, b) for pid, b in self.boxes.items() if "." not in pid]
        for i in range(len(tops)):
            (a, (ax, ay, aw, ah)) = tops[i]
            if ax < 0 or ax + aw > self.W:
                self.issues.append(f"CANVAS    panel \"{a}\" spills outside width {self.W} (x={ax}, right={ax+aw})")
            for j in range(i + 1, len(tops)):
                (b_, (bx, by, bw, bh)) = tops[j]
                gx = max(bx - (ax + aw), ax - (bx + bw))   # horizontal gap (<0 = overlap on x)
                gy = max(by - (ay + ah), ay - (by + bh))   # vertical gap
                if gx < 0 and gy < 0:
                    self.issues.append(f"OVERLAP   panels \"{a}\" and \"{b_}\" overlap")
                elif max(gx, gy) < MIN_GAP:
                    self.issues.append(f"TOO CLOSE panels \"{a}\" and \"{b_}\" are {max(gx, gy):.0f}px apart "
                                       f"(min {MIN_GAP}px) -> move one or shrink it")

    def edge_lint(self, e, pts, pill):
        a, b = e["from"].split(".")[0], e["to"].split(".")[0]
        # segments must not pass through unrelated panels
        for pid, (x, y, w, h) in self.boxes.items():
            if "." in pid or pid in (a, b):
                continue
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                lx, hx, ly, hy = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
                if lx < x + w - 2 and hx > x + 2 and ly < y + h - 2 and hy > y + 2:
                    self.issues.append(f"CROSSING  edge {e['from']}->{e['to']} passes through panel \"{pid}\" "
                                       "-> set fromSide/toSide/midX/midY")
                    break
        # label pill must sit in open space, not on top of a panel border
        if pill:
            px, py, pw, ph = pill
            for pid, (x, y, w, h) in self.boxes.items():
                if "." in pid:
                    continue
                if px < x + w + 6 and px + pw > x - 6 and py < y + h + 6 and py + ph > y - 6:
                    self.issues.append(f"LABEL     '{e['label']}' on {e['from']}->{e['to']} touches panel \"{pid}\" "
                                       f"(pill {pw:.0f}px wide) -> widen the gap to ≥ pill+24px, shorten the label, "
                                       "or route the edge through more open space")
                    break

    # ---------- edges ----------
    def anchor(self, bid, side, off=0.5):
        x, y, w, h = self.boxes[bid]
        return {"top": (x + w * off, y), "bottom": (x + w * off, y + h),
                "left": (x, y + h * off), "right": (x + w, y + h * off)}[side]

    def auto_sides(self, a, b):
        ax, ay, aw, ah = self.boxes[a]
        bx, by, bw, bh = self.boxes[b]
        if ay + ah <= by:
            return "bottom", "top"
        if by + bh <= ay:
            return "top", "bottom"
        return ("right", "left") if ax < bx else ("left", "right")

    def edge(self, e):
        a, b = e["from"], e["to"]
        fs, ts = self.auto_sides(a, b)
        fs, ts = e.get("fromSide", fs), e.get("toSide", ts)
        p1 = self.anchor(a, fs, e.get("fromOffset", 0.5))
        p2 = self.anchor(b, ts, e.get("toOffset", 0.5))
        # auto-straighten: opposite sides + overlapping span + no explicit offsets
        if "fromOffset" not in e and "toOffset" not in e and {fs, ts} in ({"top", "bottom"}, {"left", "right"}):
            ax, ay, aw, ah = self.boxes[a]
            bx, by, bw, bh = self.boxes[b]
            if fs in ("top", "bottom"):
                lo, hi = max(ax, bx), min(ax + aw, bx + bw)
                if hi - lo > 24:
                    m = (lo + hi) / 2
                    p1, p2 = (m, p1[1]), (m, p2[1])
            else:
                lo, hi = max(ay, by), min(ay + ah, by + bh)
                if hi - lo > 24:
                    m = (lo + hi) / 2
                    p1, p2 = (p1[0], m), (p2[0], m)
        vert = lambda s: s in ("top", "bottom")
        # snap tiny jogs (< 28px) to a straight line when the target side can take it
        bx_, by_, bw_, bh_ = self.boxes[b]
        if vert(fs) and vert(ts) and fs != ts and 0 < abs(p1[0] - p2[0]) < 28 and bx_ + 14 < p1[0] < bx_ + bw_ - 14:
            p2 = (p1[0], p2[1])
        if not vert(fs) and not vert(ts) and fs != ts and 0 < abs(p1[1] - p2[1]) < 28 and by_ + 14 < p1[1] < by_ + bh_ - 14:
            p2 = (p2[0], p1[1])
        pts = [p1]
        if fs == ts:  # U-route around the outside (e.g. bottom -> bottom)
            o = e.get("detour", 36)
            if vert(fs):
                my = e.get("midY", max(p1[1], p2[1]) + o if fs == "bottom" else min(p1[1], p2[1]) - o)
                pts += [(p1[0], my), (p2[0], my)]
            else:
                mx = e.get("midX", max(p1[0], p2[0]) + o if fs == "right" else min(p1[0], p2[0]) - o)
                pts += [(mx, p1[1]), (mx, p2[1])]
        elif vert(fs) and vert(ts):
            if abs(p1[0] - p2[0]) > 1:
                my = e.get("midY", (p1[1] + p2[1]) / 2)
                pts += [(p1[0], my), (p2[0], my)]
        elif not vert(fs) and not vert(ts):
            if abs(p1[1] - p2[1]) > 1:
                mx = e.get("midX", (p1[0] + p2[0]) / 2)
                pts += [(mx, p1[1]), (mx, p2[1])]
        elif vert(fs):
            pts.append((p1[0], p2[1]))
        else:
            pts.append((p2[0], p1[1]))
        pts.append(p2)
        self.maxy = max(getattr(self, "maxy", 0), max(py for _, py in pts))
        d = "M" + " L".join(f"{px:.1f} {py:.1f}" for px, py in pts)
        dash = ' stroke-dasharray="8 6"' if e.get("dashed") else ""
        color = THEMES[e["theme"]][0] if e.get("theme") else EDGE
        start = ' marker-start="url(#ahs)"' if e.get("both") else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="3"{dash} '
                          f'stroke-linejoin="round" marker-end="url(#ah)"{start}/>')
        pill = None
        if e.get("label"):
            # place the pill at the half-length point of the whole path (centre of the gap)
            segs = list(zip(pts, pts[1:]))
            lens = [abs(s[0][0]-s[1][0]) + abs(s[0][1]-s[1][1]) for s in segs]
            half, acc = sum(lens) / 2, 0
            mx, my = pts[0]
            for ((sx, sy), (ex, ey)), L in zip(segs, lens):
                if acc + L >= half and L > 0:
                    t = (half - acc) / L
                    mx, my = sx + (ex - sx) * t, sy + (ey - sy) * t
                    break
                acc += L
            lw = approx_w(e["label"], 13, 600) + 18
            pill = (mx - lw / 2, my - 12, lw, 24)
            self.parts.append(f'<rect x="{mx-lw/2:.1f}" y="{my-12:.1f}" width="{lw:.1f}" height="24" '
                              f'rx="12" fill="#fff" stroke="{color}" stroke-width="1.5"/>')
            self.parts.append(text(mx, my, e["label"], 13, "#111827", 600))
        self.edge_lint(e, pts, pill)

    # ---------- page ----------
    def render(self):
        s = self.spec
        W = self.W
        head = []
        ty = 30
        if s.get("title"):
            tw = approx_w(s["title"], 32, 700) + 80
            head.append(f'<rect x="{W/2-tw/2:.1f}" y="{ty}" width="{tw:.1f}" height="60" rx="12" fill="{NAVY}"/>')
            head.append(text(W / 2, ty + 30, s["title"], 32, "#fff", 700))
        if s.get("subtitle"):
            head.append(text(W / 2, ty + 92, s["subtitle"], 22, "#2B3A55", 600))
        for p in s.get("panels", []):
            self.panel(p)
        # edges drawn after panels so arrows sit on top
        self.lint_layout()
        for e in s.get("edges", []):
            self.edge(e)
        H = s.get("height") or int(max([b[1] + b[3] for b in self.boxes.values()] + [getattr(self, "maxy", 0)]) + 40)
        defs = (
            '<defs>'
            f'<marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="{EDGE}"/></marker>'
            f'<marker id="ahs" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0L0 5L10 10z" fill="{EDGE}"/></marker>'
            '<filter id="sh" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0B1B3F" flood-opacity=".10"/></filter>'
            '<filter id="sh2" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0B1B3F" flood-opacity=".18"/></filter>'
            '</defs>')
        bg = s.get("background", "#FFFFFF")
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
                f'font-family="{FONT}">{defs}<rect width="100%" height="100%" fill="{bg}"/>'
                + "".join(head) + "".join(self.parts) + "</svg>")


def to_png(svg_path, png_path, scale=2):
    from playwright.sync_api import sync_playwright
    svg = open(svg_path, encoding="utf-8").read()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(device_scale_factor=scale)
        pg.set_content(f'<html><body style="margin:0">{svg}</body></html>')
        pg.locator("svg").screenshot(path=png_path)
        b.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    kind = spec.get("type", "map")
    if kind == "layers":
        from layers import render_layers as render
    elif kind == "tree":
        from tree import render_tree as render
    else:
        def render(s):
            d = Diagram(s)
            svg = d.render()
            render.issues = d.issues
            return svg
    render.issues = []
    open(out, "w", encoding="utf-8").write(render(spec))
    issues = render.issues + [l for l in getattr(sys.modules.get("layers"), "ISSUES", [])] \
        + [l for l in getattr(sys.modules.get("tree"), "ISSUES", [])]
    if issues:
        print(f"\nLINT: {len(issues)} layout issue(s) — fix before delivering:", file=sys.stderr)
        for i in dict.fromkeys(issues):
            print("  - " + i, file=sys.stderr)
    else:
        print("LINT: clean")
    print("wrote", out)
    if "--png" in sys.argv:
        png = os.path.splitext(out)[0] + ".png"
        to_png(out, png)
        print("wrote", png)
    if issues and "--strict" in sys.argv:
        sys.exit(1)
