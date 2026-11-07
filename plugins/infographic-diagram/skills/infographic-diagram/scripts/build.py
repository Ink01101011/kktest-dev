#!/usr/bin/env python3
"""Render an infographic-style architecture/flow diagram from a JSON spec.

Archetypes (spec "type"): map (default) | layers | tree  -- see ../references/archetypes.md

Usage (flags may appear anywhere):
  python3 build.py spec.json out.svg                     # SVG only
  python3 build.py spec.json out.svg --png               # also out.png (2x, needs playwright)
  python3 build.py spec.json out.svg --png-out x.png     # PNG at a chosen path (implies --png)
  python3 build.py spec.json out.svg --strict            # exit 1 while lint issues remain

Exit codes:
  0  SVG (and PNG if asked) written; lint clean, or issues without --strict
  1  --strict and the LINT report has issues (files are still written)
  2  bad arguments or bad spec (clear message on stderr; nothing written)
  3  --png asked but the PNG could not be made (playwright/Chromium missing or failed);
     the SVG is written. With --strict, lint issues (1) take precedence.

Spec reference: ../references/spec.md
"""
import argparse
import base64
import json
import math
import os
import sys

sys.dont_write_bytecode = True          # do not litter the (possibly read-only) plugin dir
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import common                                                      # noqa: E402
from common import (MAX_CANVAS, SpecError, approx_w, check, cap_height, color, issue,  # noqa: E402
                    num, opt_list, opt_str, req, short, svg_wrap, text)
from icons import icon                                             # noqa: E402

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
SIDES = ("top", "bottom", "left", "right")


def theme(name, default, where):
    """Map-archetype theme lookup: unknown names fall back to `default` with a SPEC lint issue."""
    if name is None:
        return THEMES[default]
    if isinstance(name, str) and name in THEMES:
        return THEMES[name]
    issue(f"SPEC      {where}: unknown theme {short(name)} (use {' '.join(THEMES)}) -> used {default}")
    return THEMES[default]


def item_theme(name, fallback, where, what="the panel colours"):
    """Optional per-item/edge theme: None -> fallback; unknown -> fallback + SPEC lint issue."""
    if name is None:
        return fallback
    if isinstance(name, str) and name in THEMES:
        return THEMES[name]
    issue(f"SPEC      {where}: unknown theme {short(name)} (use {' '.join(THEMES)}) -> used {what}")
    return fallback


def _vert(side):
    return side in ("top", "bottom")


class Diagram:
    def __init__(self, spec):
        self.spec = spec
        self.W = num(spec.get("width"), "width", 1200, lo=1, hi=MAX_CANVAS)
        self.Hset = None if spec.get("height") in (None, 0) else num(spec.get("height"), "height", lo=1, hi=MAX_CANVAS)
        self.boxes = {}       # id -> (x, y, w, h)
        self.parts = []
        self.maxy = 0
        self.edge_extent = []   # (minx, maxx, maxy) per edge, for canvas lint

    # ---------- panels ----------
    def panel(self, p, k):
        where = f"panels[{k}]"
        pid = req(p, "id", where)
        if "." in pid:
            raise SpecError(f'{where}.id "{pid}": panel ids must not contain "." (edges use "panel.item")')
        if pid in self.boxes:
            raise SpecError(f'{where}.id "{pid}": duplicate panel id')
        where = f'panel "{pid}"'
        base, tint, soft, ink = theme(p.get("theme", "blue"), "blue", where)
        x, y = num(p.get("x"), f"{where}.x"), num(p.get("y"), f"{where}.y")
        w, h = num(p.get("w"), f"{where}.w", lo=0), num(p.get("h"), f"{where}.h", lo=0)
        title = req(p, "title", where)
        subtitle = opt_str(p, "subtitle", where)
        self.boxes[pid] = (x, y, w, h)
        style = p.get("style", "cards")   # cards | columns | solid (whole panel = one node)
        if style not in ("cards", "columns", "solid"):
            raise SpecError(f'{where}.style: {short(style)} is not one of cards, columns, solid')
        if style == "solid":
            self.solid_panel(p, where, (x, y, w, h), title, subtitle, base)
            return
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="18" fill="{tint}" '
                          f'stroke="{base}" stroke-width="2.5" filter="url(#sh)"/>')
        top = self.panel_header(p, where, (x, y, w, h), title, subtitle, ink)
        items = opt_list(p, "items", where)
        if not items:
            return
        footer = opt_str(p, "footer", where)
        bottom = y + h - 16 - (40 if footer else 0)
        self.panel_items(p, pid, where, items, (x, w), top, bottom, style, (base, soft, ink))
        if footer:
            self.panel_footer(footer, where, (x, w), bottom)

    def solid_panel(self, p, where, box, title, subtitle, base):
        """single highlighted node, e.g. "API Gateway": icon + title (+ subtitle) centred on a solid fill"""
        x, y, w, h = box
        P = self.parts
        P.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{base}" '
                 f'filter="url(#sh)"/>')
        has_sub = bool(subtitle)
        cy = y + h / 2
        tw = approx_w(title, 24, 700)
        sw = approx_w(subtitle, 15, 500) if has_sub else 0
        bw = max(tw, sw)                       # text block width
        ic = 34 if p.get("icon") else 0
        gap = 14 if ic else 0
        check(title, 24, 700, w - 2 * PAD_IN - ic - gap, f'{where} title')
        if has_sub:
            check(subtitle, 15, 500, w - 2 * PAD_IN - ic - gap, f'{where} subtitle')
        tx = x + w / 2 + (ic + gap) / 2          # centre of text block
        if ic:
            P.append(icon(p["icon"], tx - bw / 2 - gap - ic, cy - ic / 2, ic, "#fff", 2.2))
        P.append(text(tx, cy - (12 if has_sub else 0), title, 24, "#fff", 700))
        if has_sub:
            P.append(text(tx, cy + 18, subtitle, 15, "#E6EEFF", 500))

    def panel_header(self, p, where, box, title, subtitle, ink):
        """icon + title (+ subtitle) at the top of a cards/columns panel; returns the y where items start"""
        x, y, w, _ = box
        P = self.parts
        hy = y + 34
        tw = approx_w(title, 22, 700)
        ic = 28 if p.get("icon") else 0
        gap = 10 if ic else 0
        check(title, 22, 700, w - 2 * PAD_IN - ic - gap, f'{where} title')
        if subtitle:
            check(subtitle, 15, 600, w - 2 * PAD_IN, f'{where} subtitle')
        tx = x + w / 2 + (ic + gap) / 2
        if ic:
            P.append(icon(p["icon"], tx - tw / 2 - gap - ic, hy - ic / 2, ic, ink, 2.1))
        P.append(text(tx, hy, title, 22, "#111827", 700))
        if subtitle:
            P.append(text(x + w / 2, y + 60, subtitle, 15, "#1F2937", 600))
            return y + 80
        return y + 58

    def panel_items(self, p, pid, where, items, xw, top, bottom, style, colours):
        """the items side by side between top and bottom, as cards or columns, with flow arrows between them"""
        x, w = xw
        base, soft, ink = colours
        P = self.parts
        pad, gapc = 18, (34 if p.get("flow") else 14)
        n = len(items)
        cw = (w - 2 * pad - (n - 1) * gapc) / n
        ch = bottom - top
        for i, it in enumerate(items):
            iw = f"{where}.items[{i}]"
            lab = req(it, "label", iw)
            cx = x + pad + i * (cw + gapc)
            iid = f'{pid}.{it.get("id", i)}'
            self.boxes[iid] = (cx, top, cw, ch)
            if style == "columns":
                self.column(cx, top, cw, ch, it, lab, base, ink, iw)
                if i < n - 1:
                    lx = cx + cw + gapc / 2
                    P.append(f'<line x1="{lx}" y1="{top+6}" x2="{lx}" y2="{bottom-6}" '
                             f'stroke="{base}" stroke-opacity=".35" stroke-width="1.5"/>')
            else:
                self.card(cx, top, cw, ch, it, lab, base, soft, ink, iw)
            if p.get("flow") and i < n - 1:
                ax = cx + cw + 4
                ay = top + ch / 2
                P.append(f'<line x1="{ax}" y1="{ay}" x2="{ax+gapc-10}" y2="{ay}" stroke="{EDGE}" '
                         f'stroke-width="3" marker-end="url(#ah)"/>')

    def panel_footer(self, footer, where, xw, bottom):
        """a brace under the items with the footer text below it"""
        x, w = xw
        pad = 18
        fx1, fx2 = x + pad + 30, x + w - pad - 30
        fy = bottom + 8
        mid = (fx1 + fx2) / 2
        check(footer, 15, 600, w - 2 * pad, f'{where} footer')
        self.parts.append(f'<path d="M{fx1} {fy} q0 10 10 10 H{mid-10} q10 0 10 8 q0 -8 10 -8 '
                          f'H{fx2-10} q10 0 10 -10" fill="none" stroke="{EDGE}" stroke-width="2"/>')
        self.parts.append(text(mid, fy + 32, footer, 15, "#111827", 600))

    def card(self, x, y, w, h, it, lab, base, soft, ink, where):
        P = self.parts
        kind = it.get("style", "soft")
        base, _, soft, ink = item_theme(it.get("theme"), (base, None, soft, ink), where)
        sub = opt_str(it, "sublabel", where)
        if kind == "solid":
            P.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="12" '
                     f'fill="{base}" filter="url(#sh2)"/>')
            ic = min(40, h * 0.5)
            if w >= 150 and it.get("icon"):
                P.append(icon(it["icon"], x + 16, y + h / 2 - ic / 2, ic, "#fff", 2.2))
                tx = x + 16 + ic + 12 + (w - ic - 44) / 2
            else:
                if it.get("icon"):
                    P.append(icon(it["icon"], x + w / 2 - ic / 2, y + 12, ic, "#fff", 2.2))
                tx = x + w / 2
            ty = y + h / 2 if w >= 150 or not it.get("icon") else y + 12 + ic + (h - ic - 12) / 2
            check(lab, 17, 650, w - (ic + 24 if w >= 150 and it.get("icon") else 0), f"{where} label")
            P.append(text(tx, ty - (9 if sub else 0), lab, 17, "#fff", 650))
            if sub:
                check(sub, 13, 500, w - (ic + 24 if w >= 150 and it.get("icon") else 0), f"{where} sublabel")
                P.append(text(tx, ty + 14, sub, 13, "#EEF2FF", 500))
        else:
            P.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="12" '
                     f'fill="{soft}" stroke="{base}" stroke-opacity=".55" stroke-width="1.5"/>')
            ic = min(30, h * 0.32)
            nl = lab.count("\n") + 1 + (1 if sub else 0)
            block = ic + 8 + nl * 19
            iy = y + (h - block) / 2
            if it.get("icon"):
                P.append(icon(it["icon"], x + w / 2 - ic / 2, iy, ic, ink, 2.2))
            ly = iy + ic + 8 + (lab.count("\n") + 1) * 19 / 2
            check(lab, 15, 600, w, f"{where} label")
            P.append(text(x + w / 2, ly, lab, 15, "#111827", 600))
            if sub:
                check(sub, 13, 500, w, f"{where} sublabel")
                P.append(text(x + w / 2, ly + 19 + lab.count("\n") * 9, sub, 13, MUTED, 500))

    def column(self, x, y, w, h, it, lab, base, ink, where):
        P = self.parts
        col = item_theme(it.get("theme"), (base,), where)[0]
        ic = min(46, h * 0.45)
        sub = opt_str(it, "sublabel", where)
        block = ic + 10 + 20 + (18 if sub else 0)
        iy = y + (h - block) / 2
        if it.get("icon"):
            P.append(icon(it["icon"], x + w / 2 - ic / 2, iy, ic, col, 2.0))
        ly = iy + ic + 10 + 10
        fs = 16 if w >= 120 else 14
        check(lab, fs, 650, w, f"{where} label")
        P.append(text(x + w / 2, ly, lab, fs, "#111827", 650))
        if sub:
            check(sub, fs - 2, 500, w, f"{where} sublabel")
            P.append(text(x + w / 2, ly + 20, sub, fs - 2, MUTED, 500))

    def lint_layout(self):
        """Spacing/overlap rules for top-level panels (hand-placed coordinates)."""
        tops = [(pid, b) for pid, b in self.boxes.items() if "." not in pid]
        for i in range(len(tops)):
            (a, (ax, ay, aw, ah)) = tops[i]
            if ax < 0 or ax + aw > self.W:
                issue(f"CANVAS    panel \"{a}\" spills outside width {self.W} (x={ax}, right={ax+aw})")
            if ay < 0 or (self.Hset is not None and ay + ah > self.Hset):
                lim = f"height {self.Hset}" if self.Hset is not None else "the top edge"
                issue(f"CANVAS    panel \"{a}\" spills outside {lim} (y={ay}, bottom={ay+ah})")
            for j in range(i + 1, len(tops)):
                (b_, (bx, by, bw, bh)) = tops[j]
                gx = max(bx - (ax + aw), ax - (bx + bw))   # horizontal gap (<0 = overlap on x)
                gy = max(by - (ay + ah), ay - (by + bh))   # vertical gap
                if gx < 0 and gy < 0:
                    issue(f"OVERLAP   panels \"{a}\" and \"{b_}\" overlap")
                elif max(gx, gy) < MIN_GAP:
                    issue(f"TOO CLOSE panels \"{a}\" and \"{b_}\" are {max(gx, gy):.0f}px apart "
                          f"(min {MIN_GAP}px) -> move one or shrink it")

    def edge_lint(self, e, label, pts, pill):
        a, b = e["from"].split(".")[0], e["to"].split(".")[0]
        name = f"{e['from']}->{e['to']}"
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        if min(xs) < 0 or max(xs) > self.W or min(ys) < 0 or (self.Hset is not None and max(ys) > self.Hset):
            issue(f"CANVAS    edge {name} runs outside the canvas -> adjust midX/midY/detour or the sides")
        # segments must not pass through unrelated panels
        for pid, (x, y, w, h) in self.boxes.items():
            if "." in pid or pid in (a, b):
                continue
            for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
                lx, hx, ly, hy = min(x1, x2), max(x1, x2), min(y1, y2), max(y1, y2)
                if lx < x + w - 2 and hx > x + 2 and ly < y + h - 2 and hy > y + 2:
                    issue(f"CROSSING  edge {name} passes through panel \"{pid}\" "
                          "-> set fromSide/toSide/midX/midY")
                    break
        # label pill must sit in open space, not on top of a panel border, and on the canvas
        if pill:
            px, py, pw, ph = pill
            if px < 0 or px + pw > self.W or py < 0 or (self.Hset is not None and py + ph > self.Hset):
                issue(f"CANVAS    label {short(label, 60)} on {name} (pill {pw:.0f}px wide) spills off the canvas "
                      "-> shorten the label or move the edge")
            for pid, (x, y, w, h) in self.boxes.items():
                if "." in pid:
                    continue
                if px < x + w + 6 and px + pw > x - 6 and py < y + h + 6 and py + ph > y - 6:
                    issue(f"LABEL     {short(label, 60)} on {name} touches panel \"{pid}\" "
                          f"(pill {pw:.0f}px wide) -> widen the gap to >= pill+24px, shorten the label, "
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

    def edge(self, e, k):
        where = f"edges[{k}]"
        a, b = req(e, "from", where), req(e, "to", where)
        for key, bid in (("from", a), ("to", b)):
            if bid not in self.boxes:
                raise SpecError(f'{where}.{key}: "{bid}" is not a panel id or "panel.item" id '
                                f'(panels: {", ".join(k_ for k_ in self.boxes if "." not in k_)})')
        where = f"edge {a}->{b}"
        for key in ("fromSide", "toSide"):
            if e.get(key) is not None and e.get(key) not in SIDES:
                raise SpecError(f"{where}.{key}: {short(e.get(key))} is not one of {', '.join(SIDES)}")
        fs, ts = self.auto_sides(a, b)
        fs, ts = e.get("fromSide") or fs, e.get("toSide") or ts
        p1, p2 = self.edge_ends(e, where, a, b, fs, ts)
        pts = self.route(e, where, fs, ts, p1, p2)
        self.maxy = max(self.maxy, max(py for _, py in pts))
        d = "M" + " L".join(f"{px:.1f} {py:.1f}" for px, py in pts)
        dash = ' stroke-dasharray="8 6"' if e.get("dashed") else ""
        color_ = item_theme(e.get("theme"), (EDGE,), where, "the default edge colour")[0]
        start = ' marker-start="url(#ahs)"' if e.get("both") else ""
        self.parts.append(f'<path d="{d}" fill="none" stroke="{color_}" stroke-width="3"{dash} '
                          f'stroke-linejoin="round" marker-end="url(#ah)"{start}/>')
        label = opt_str(e, "label", where)
        pill = self.edge_label(label, pts, color_) if label else None
        self.edge_lint(e, label, pts, pill)

    def edge_ends(self, e, where, a, b, fs, ts):
        """start and end points on the chosen sides, straightened or snapped when the boxes allow it"""
        p1 = self.anchor(a, fs, num(e.get("fromOffset"), f"{where}.fromOffset", 0.5))
        p2 = self.anchor(b, ts, num(e.get("toOffset"), f"{where}.toOffset", 0.5))
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
        # snap tiny jogs (< 28px) to a straight line when the target side can take it
        bx_, by_, bw_, bh_ = self.boxes[b]
        if _vert(fs) and _vert(ts) and fs != ts and 0 < abs(p1[0] - p2[0]) < 28 and bx_ + 14 < p1[0] < bx_ + bw_ - 14:
            p2 = (p1[0], p2[1])
        if not _vert(fs) and not _vert(ts) and fs != ts and 0 < abs(p1[1] - p2[1]) < 28 and by_ + 14 < p1[1] < by_ + bh_ - 14:
            p2 = (p2[0], p1[1])
        return p1, p2

    def route(self, e, where, fs, ts, p1, p2):
        """orthogonal path p1 -> p2: a U around the outside (same sides), a Z (opposite sides) or an L"""
        midX = None if e.get("midX") is None else num(e.get("midX"), f"{where}.midX")
        midY = None if e.get("midY") is None else num(e.get("midY"), f"{where}.midY")
        pts = [p1]
        if fs == ts:  # U-route around the outside (e.g. bottom -> bottom)
            o = num(e.get("detour"), f"{where}.detour", 36)
            if _vert(fs):
                my = midY if midY is not None else (max(p1[1], p2[1]) + o if fs == "bottom" else min(p1[1], p2[1]) - o)
                pts += [(p1[0], my), (p2[0], my)]
            else:
                mx = midX if midX is not None else (max(p1[0], p2[0]) + o if fs == "right" else min(p1[0], p2[0]) - o)
                pts += [(mx, p1[1]), (mx, p2[1])]
        elif _vert(fs) and _vert(ts):
            if abs(p1[0] - p2[0]) > 1:
                my = midY if midY is not None else (p1[1] + p2[1]) / 2
                pts += [(p1[0], my), (p2[0], my)]
        elif not _vert(fs) and not _vert(ts):
            if abs(p1[1] - p2[1]) > 1:
                mx = midX if midX is not None else (p1[0] + p2[0]) / 2
                pts += [(mx, p1[1]), (mx, p2[1])]
        elif _vert(fs):
            pts.append((p1[0], p2[1]))
        else:
            pts.append((p2[0], p1[1]))
        pts.append(p2)
        return pts

    def edge_label(self, label, pts, color_):
        """a pill at the half-length point of the whole path (centre of the gap); returns its box"""
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
        lw = approx_w(label, 13, 600) + 18
        self.parts.append(f'<rect x="{mx-lw/2:.1f}" y="{my-12:.1f}" width="{lw:.1f}" height="24" '
                          f'rx="12" fill="#fff" stroke="{color_}" stroke-width="1.5"/>')
        self.parts.append(text(mx, my, label, 13, "#111827", 600))
        return (mx - lw / 2, my - 12, lw, 24)

    # ---------- page ----------
    def render(self):
        s = self.spec
        W = self.W
        head = []
        ty = 30
        title, subtitle = opt_str(s, "title", "spec"), opt_str(s, "subtitle", "spec")
        if title:
            tw = approx_w(title, 32, 700) + 80
            check(title, 32, 700, W - 96, "page title")      # pill (text + 80px) must fit the canvas
            head.append(f'<rect x="{W/2-tw/2:.1f}" y="{ty}" width="{tw:.1f}" height="60" rx="12" fill="{NAVY}"/>')
            head.append(text(W / 2, ty + 30, title, 32, "#fff", 700))
        if subtitle:
            check(subtitle, 22, 600, W - 40, "page subtitle")
            head.append(text(W / 2, ty + 92, subtitle, 22, "#2B3A55", 600))
        for k, p in enumerate(opt_list(s, "panels", "spec")):
            self.panel(p, k)
        # edges drawn after panels so arrows sit on top
        self.lint_layout()
        for k, e in enumerate(opt_list(s, "edges", "spec")):
            self.edge(e, k)
        H = self.Hset if self.Hset is not None else \
            cap_height(int(max([b[1] + b[3] for b in self.boxes.values()] + [self.maxy]) + 40))
        defs = (
            '<defs>'
            f'<marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="{EDGE}"/></marker>'
            f'<marker id="ahs" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0L0 5L10 10z" fill="{EDGE}"/></marker>'
            '<filter id="sh" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0B1B3F" flood-opacity=".10"/></filter>'
            '<filter id="sh2" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#0B1B3F" flood-opacity=".18"/></filter>'
            '</defs>')
        bg = color(s.get("background"), "#FFFFFF", "background")
        return svg_wrap(W, H, defs, bg, "".join(head) + "".join(self.parts)), W, H


# ---------- entry points ----------
def build(spec):
    """Render a spec dict. Returns (svg_text, lint_issues, (width, height)). Raises SpecError."""
    common.ISSUES.clear()
    if not isinstance(spec, dict):
        raise SpecError(f"spec: the top level must be a JSON object, got {type(spec).__name__}")
    kind = spec.get("type", "map")
    if kind == "layers":
        from layers import render_layers as render
    elif kind == "tree":
        from tree import render_tree as render
    elif kind == "map":
        render = lambda s: Diagram(s).render()   # noqa: E731
    else:
        raise SpecError(f"type: {short(kind)} is not one of map, layers, tree")
    svg, W, H = render(spec)
    return svg, list(dict.fromkeys(common.ISSUES)), (W, H)


class PngUnavailable(RuntimeError):
    pass


def png_html(svg, W, H):
    """Wrap the SVG as an <img> data: URL. An SVG loaded as an image runs no scripts and fetches
    nothing; the CSP below forbids everything except that one data: image."""
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return ('<!doctype html><html><head><meta charset="utf-8">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; '
            'style-src \'unsafe-inline\'">'
            f'</head><body style="margin:0"><img id="diagram" width="{W}" height="{H}" '
            f'src="data:image/svg+xml;base64,{b64}"></body></html>')


def to_png(svg, png_path, W, H, scale=2):
    """Render `svg` (text) to `png_path` with headless Chromium: JavaScript off, offline, every
    non-data: request aborted. Raises PngUnavailable with an actionable message."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise PngUnavailable("the Python 'playwright' package is not installed -> "
                             "pip install playwright && python3 -m playwright install chromium") from None
    with sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as ex:   # missing browser binary, sandbox refusal, ...
            first = (str(ex).strip().splitlines() or ["unknown error"])[0]
            raise PngUnavailable(f"Chromium could not start ({first}) -> "
                                 "python3 -m playwright install chromium") from None
        try:
            ctx = b.new_context(java_script_enabled=False, offline=True, device_scale_factor=scale,
                                viewport={"width": int(math.ceil(W)), "height": int(math.ceil(H))})
            ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("data:") else r.abort())
            pg = ctx.new_page()
            pg.set_content(png_html(svg, W, H), wait_until="load", timeout=30000)
            pg.locator("#diagram").screenshot(path=png_path, timeout=30000)
        except Exception as ex:
            first = (str(ex).strip().splitlines() or ["unknown error"])[0]
            raise PngUnavailable(f"PNG rendering failed ({first})") from None
        finally:
            b.close()


def _safe_stdio():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="backslashreplace")
        except (AttributeError, ValueError):
            pass


def _ensure_dir(path):
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)


def main(argv=None):
    _safe_stdio()
    ap = argparse.ArgumentParser(
        prog="build.py", description="Render an infographic diagram (SVG, optional PNG) from a JSON spec.",
        epilog="Exit codes: 0 ok; 1 lint issues with --strict; 2 bad arguments/spec; 3 PNG not made (SVG kept).")
    ap.add_argument("spec", help="spec JSON file (UTF-8, BOM allowed)")
    ap.add_argument("out", help="output SVG path (directories are created)")
    ap.add_argument("--png", action="store_true", help="also write a 2x PNG next to the SVG (needs playwright)")
    ap.add_argument("--png-out", metavar="PATH", help="write the PNG to PATH (implies --png)")
    ap.add_argument("--strict", action="store_true", help="exit 1 while the LINT report has issues")
    args = ap.parse_args(argv)

    def fail(msg):
        print(f"ERROR: {msg}", file=sys.stderr)
        return 2

    if args.out.lower().endswith(".png"):
        return fail(f"output {args.out!r} ends in .png but the first output is the SVG -> "
                    "give an .svg path and use --png or --png-out for the PNG")
    png = None
    if args.png or args.png_out:
        png = args.png_out or os.path.splitext(args.out)[0] + ".png"
        if os.path.abspath(png) == os.path.abspath(args.out):
            return fail("--png-out must differ from the SVG output path")
    try:
        with open(args.spec, encoding="utf-8-sig") as f:
            spec = json.load(f)
    except OSError as ex:
        return fail(f"cannot read spec {args.spec!r}: {ex.strerror or ex}")
    except UnicodeDecodeError:
        return fail(f"spec {args.spec!r} is not UTF-8 text")
    except json.JSONDecodeError as ex:
        return fail(f"spec {args.spec!r} is not valid JSON: {ex.msg} at line {ex.lineno} column {ex.colno}")
    try:
        svg, issues, (W, H) = build(spec)
    except SpecError as ex:
        return fail(f"bad spec {args.spec!r}: {ex}")
    try:
        _ensure_dir(args.out)
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(svg)
    except OSError as ex:
        return fail(f"cannot write {args.out!r}: {ex.strerror or ex}")
    if issues:
        print(f"\nLINT: {len(issues)} layout issue(s) - fix before delivering:", file=sys.stderr)
        for i in issues:
            print("  - " + i, file=sys.stderr)
    else:
        print("LINT: clean")
    print("wrote", args.out)
    rc = 1 if issues and args.strict else 0
    if png:
        try:
            _ensure_dir(png)
            to_png(svg, png, W, H)
            print("wrote", png)
        except (PngUnavailable, OSError) as ex:
            print(f"PNG skipped: {ex} (the SVG was written)", file=sys.stderr)
            rc = rc or 3
    return rc


if __name__ == "__main__":
    sys.exit(main())
