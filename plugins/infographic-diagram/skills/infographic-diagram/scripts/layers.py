"""Archetype: LAYERS — editorial, numbered layer stack on cream paper.
Each layer = badge + "Layer N — NAME" + tagline, a row of chips/process steps,
and a right-hand 'aside' insight box. Optional side rails and a bottom summary strip.
"""
from build import text, approx_w, wrap, esc
from icons import icon

ISSUES = []

SERIF = "Georgia, 'Noto Serif', 'DejaVu Serif', 'Noto Sans Thai', serif"
#          base       tint       ink
MUTED = {
    "olive":  ("#5E7F3A", "#F3F6EC", "#2F4119"),
    "teal":   ("#2C6E7F", "#EAF3F5", "#163843"),
    "orange": ("#C9732A", "#FBF1E6", "#5C3210"),
    "purple": ("#6A4FA3", "#F2EEF8", "#33245A"),
    "green":  ("#3C7A5A", "#EAF4EE", "#1C3D2C"),
    "blue":   ("#3A63A8", "#ECF1F9", "#1A3159"),
    "red":    ("#B04A3C", "#F8ECE9", "#4F1E17"),
    "slate":  ("#5B6472", "#F1F2F4", "#262B33"),
}
PAPER = "#FBF8F2"
CARD = "#FFFDF9"
INK = "#2A2724"
SOFT_INK = "#5C5650"
EDGE = "#3A3631"


def _chip(P, x, y, label, ic, base, tint, ink):
    lines = label.count("\n") + 1
    w = approx_w(label, 15, 500) + (34 if ic else 0) + 26
    h = 40 + 18 * (lines - 1)
    P.append(f'<rect x="{x:.1f}" y="{y - h/2:.1f}" width="{w:.1f}" height="{h}" rx="8" '
             f'fill="{tint}" stroke="{base}" stroke-opacity=".45" stroke-width="1.4"/>')
    tx = x + 13
    if ic:
        P.append(icon(ic, tx, y - 10, 20, base, 2))
        tx += 30
    P.append(text(tx + (w - (tx - x) - 13) / 2, y, label, 15, ink, 500))
    return w


def chip_w(it):
    return approx_w(it["label"], 15, 500) + (34 if it.get("icon") else 0) + 26


def render_layers(s):
    W = s.get("width", 1200)
    P = []
    y = 46
    if s.get("kicker"):
        kw = approx_w(s["kicker"], 18, 700) + len(s["kicker"]) * 3
        P.append(icon(s.get("kicker_icon", "sparkle"), W / 2 - kw / 2 - 40, y - 15, 30, "#D2703A", 2.2))
        P.append(text(W / 2 + 8, y, s["kicker"], 18, INK, 700, ls=3))
        y += 64
    if s.get("title"):
        P.append(text(W / 2, y, s["title"], 54, INK, 700, family=SERIF))
        y += 60
    if s.get("subtitle"):
        P.append(text(W / 2, y, s["subtitle"], 25, INK, 600, ls=0.5))
        y += 42
    if s.get("byline"):
        P.append(text(W / 2, y, s["byline"], 18, SOFT_INK, 500))
        y += 34

    rails = s.get("rails", {})
    railW = s.get("rail_width", 160)
    x0 = 40 + (railW + 34 if rails.get("left") else 0)
    x1 = W - 40 - (railW + 34 if rails.get("right") else 0)
    y += 20
    boxes = []
    for i, L in enumerate(s["layers"]):
        base, tint, ink = MUTED.get(L.get("theme", "slate"), MUTED["slate"])
        h = L.get("h", 170)
        boxes.append((x0, y, x1 - x0, h))
        P.append(f'<rect x="{x0}" y="{y}" width="{x1-x0}" height="{h}" rx="14" fill="{CARD}" '
                 f'stroke="{base}" stroke-opacity=".35" stroke-width="1.6" filter="url(#soft)"/>')
        P.append(f'<path d="M{x0+2} {y+14} V{y+h-14}" stroke="{base}" stroke-width="5" stroke-linecap="round"/>')
        # header
        hx, hy = x0 + 24, y + 34
        num = str(L.get("n", i + 1))
        P.append(f'<rect x="{hx}" y="{hy-15}" width="30" height="30" rx="6" fill="{base}"/>')
        P.append(text(hx + 15, hy, num, 18, "#fff", 700))
        hx += 42
        pre = L.get("prefix", f"Layer {num} — ")
        P.append(text(hx, hy, pre, 20, INK, 500, anchor="start"))
        hx += approx_w(pre, 20, 500)
        P.append(text(hx, hy, L["name"], 30, base, 700, anchor="start"))
        hx += approx_w(L["name"], 30, 700) + 28
        if L.get("tagline"):
            P.append(text(hx, hy, L["tagline"], 20, base, 500, anchor="start", family=SERIF, italic=True))

        body_t, body_b = y + 64, y + h - 16
        bx = x0 + 30
        if L.get("icon"):
            ic = 58
            lab = L.get("icon_label")
            iy = (body_t + body_b) / 2 - (ic / 2 + (12 if lab else 0))
            P.append(icon(L["icon"], bx + 10, iy, ic, SOFT_INK, 1.6))
            if lab:
                P.append(text(bx + 10 + ic / 2, iy + ic + 20, lab, 15, INK, 500))
            bx += 110
        ax = x1 - 24
        if L.get("aside"):
            A = L["aside"]
            aw = A.get("w", 170)
            ax = x1 - 20 - aw
            P.append(f'<rect x="{ax}" y="{body_t - 14}" width="{aw}" height="{body_b - body_t + 4}" rx="10" '
                     f'fill="{tint}" stroke="{base}" stroke-opacity=".35" stroke-width="1.3"/>')
            ty = body_t + 6
            if A.get("icon"):
                P.append(icon(A["icon"], ax + aw / 2 - 13, ty - 6, 26, ink, 2))
                ty += 34
            body = wrap(A["text"], 14, aw - 24, 500)
            nlines = body.count("\n") + 1
            P.append(text(ax + aw / 2, ty + (nlines - 1) * 17 / 2 + 2, body, 14, INK, 500))
            ax -= 20
        # chip rows
        rows = []
        avail = ax - bx
        for row in L.get("rows", []):
            if row.get("arrows"):
                rows.append(row)
                continue
            line, wsum = [], 0
            for it in row["items"]:          # auto-wrap plain chip rows that don't fit
                cw = chip_w(it) + (14 if line else 0)
                if line and wsum + cw > avail:
                    rows.append({**row, "items": line})
                    line, wsum = [], 0
                    cw = chip_w(it)
                line.append(it)
                wsum += cw
            if line:
                rows.append({**row, "items": line})
        note = L.get("note")
        area_b = body_b - (30 if note else 0)
        n = max(len(rows), 1)
        step = (area_b - body_t) / n
        for r, row in enumerate(rows):
            items = row["items"]
            arrows = row.get("arrows", False)
            gap = 44 if arrows else 14
            total = sum(chip_w(it) for it in items) + gap * (len(items) - 1)
            if total > avail:
                ISSUES.append(f"OVERFLOW  layer '{L['name']}' row {r+1} is {total:.0f}px wide, only {avail:.0f}px available")
            cx = bx + max(0, (avail - total) / 2) if row.get("align") != "left" else bx
            cy = body_t + step * (r + 0.5)
            for k, it in enumerate(items):
                w = _chip(P, cx, cy, it["label"], it.get("icon"), base, tint, ink)
                if arrows and k < len(items) - 1:
                    P.append(f'<line x1="{cx+w+8}" y1="{cy}" x2="{cx+w+gap-8}" y2="{cy}" stroke="{EDGE}" '
                             f'stroke-width="2.2" marker-end="url(#ah)"/>')
                cx += w + gap
        if note:
            P.append(text((bx + ax) / 2, body_b - 12, note, 15, INK, 500))
        y += h + s.get("gap", 18)

    # rails
    def rail(side, R):
        base, tint, ink = MUTED.get(R.get("theme", "orange"), MUTED["orange"])
        rx = 40 if side == "left" else W - 40 - railW
        first, last = boxes[0], boxes[-1]
        top = boxes[1][1] if len(boxes) > 2 else first[1]
        bot = boxes[-2][1] + boxes[-2][3] if len(boxes) > 2 else last[1] + last[3]
        P.append(f'<rect x="{rx}" y="{top}" width="{railW}" height="{bot-top}" rx="14" fill="{CARD}" '
                 f'stroke="{base}" stroke-opacity=".35" stroke-width="1.6" filter="url(#soft)"/>')
        cy = top + 28
        if R.get("icon"):
            P.append(icon(R["icon"], rx + railW / 2 - 22, cy, 44, base, 1.8))
            cy += 62
        t = wrap(R["title"], 26, railW - 24, 700)
        nl = t.count("\n") + 1
        P.append(text(rx + railW / 2, cy + (nl - 1) * 16 + 12, t, 26, INK, 700))
        cy += nl * 32 + 10
        P.append(f'<line x1="{rx+railW/2-14}" y1="{cy}" x2="{rx+railW/2+14}" y2="{cy}" stroke="{base}" stroke-width="2.5"/>')
        cy += 26
        for bl in R.get("bullets", []):
            bt = wrap(bl, 16, railW - 44, 500)
            k = bt.count("\n") + 1
            P.append(f'<circle cx="{rx+18}" cy="{cy}" r="3.5" fill="{base}"/>')
            P.append(text(rx + 30, cy + (k - 1) * 9.8, bt, 16, INK, 500, anchor="start"))
            cy += k * 20 + 16
        # connectors into first and last layer
        mx = rx + railW / 2
        lx = first[0] if side == "left" else first[0] + first[2]
        d = R.get("arrows", "in")
        for (bx_, by_, bw_, bh_), ry in ((first, top), (last, bot)):
            ly = by_ + bh_ / 2
            ex = bx_ if side == "left" else bx_ + bw_
            ms = ' marker-start="url(#ahs)"' if d in ("out", "both") else ""
            me = ' marker-end="url(#ah)"' if d in ("in", "both") else ""
            P.append(f'<path d="M{mx} {ry} V{ly} H{ex}" fill="none" stroke="{EDGE}" stroke-width="2.4" '
                     f'stroke-linejoin="round"{ms}{me}/>')

    for side in ("left", "right"):
        if rails.get(side):
            rail(side, rails[side])

    # summary strip
    if s.get("summary"):
        items = s["summary"]
        y += 10
        sh = 96
        P.append(f'<rect x="40" y="{y}" width="{W-80}" height="{sh}" rx="14" fill="{CARD}" '
                 f'stroke="#D9D2C6" stroke-width="1.5"/>')
        slot = (W - 80 - 40) / len(items)
        layer_themes = [L.get("theme", "slate") for L in s["layers"]]
        for k, it in enumerate(items):
            base = MUTED.get(it.get("theme", layer_themes[k % len(layer_themes)]), MUTED["slate"])[0]
            sx = 60 + k * slot
            cy = y + sh / 2
            P.append(f'<rect x="{sx}" y="{cy-26}" width="52" height="52" rx="10" fill="#fff" '
                     f'stroke="{base}" stroke-width="1.6"/>')
            P.append(icon(it.get("icon", "box"), sx + 12, cy - 14, 28, base, 1.9))
            t = wrap(it["text"], 14, slot - 100, 500)
            P.append(text(sx + 64, cy, t, 14, INK, 500, anchor="start"))
            if k < len(items) - 1:
                arx = sx + slot - 26
                P.append(f'<line x1="{arx}" y1="{cy}" x2="{arx+18}" y2="{cy}" stroke="{EDGE}" '
                         f'stroke-width="2.2" marker-end="url(#ah)"/>')
        y += sh
    H = int(y + 40)
    defs = (
        '<defs>'
        f'<marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="{EDGE}"/></marker>'
        f'<marker id="ahs" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0L0 5L10 10z" fill="{EDGE}"/></marker>'
        '<filter id="soft" x="-3%" y="-5%" width="106%" height="115%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#5A4A30" flood-opacity=".08"/></filter>'
        '</defs>')
    font = "Inter, 'Noto Sans Thai', 'Segoe UI', Helvetica, Arial, sans-serif"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
            f'font-family="{font}">{defs}<rect width="100%" height="100%" fill="{s.get("background", PAPER)}"/>'
            + "".join(P) + "</svg>")
