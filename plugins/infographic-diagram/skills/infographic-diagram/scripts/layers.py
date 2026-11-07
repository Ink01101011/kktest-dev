"""Archetype: LAYERS — editorial, numbered layer stack on cream paper.
Each layer = badge + "Layer N — NAME" + tagline, a row of chips/process steps,
and a right-hand 'aside' insight box. Optional side rails and a bottom summary strip.
"""
from common import (SERIF, SpecError, approx_w, cap_height, check, check_lines, check_words, color, issue,
                    num, opt_list, opt_str, req, short, svg_wrap, text, wrap)
from icons import icon
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
    # same size as the layout pass measured (chip_w / chip_h), so the two can never drift (S18)
    it = {"label": label, "icon": ic}
    w = chip_w(it)
    h = chip_h(it)
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


def chip_h(it):
    return 40 + 18 * str(it["label"]).count("\n")


def palette(name, default, where):
    """Layers theme lookup: unknown names fall back to `default` with a SPEC lint issue."""
    if name is None:
        return MUTED[default]
    if isinstance(name, str) and name in MUTED:
        return MUTED[name]
    issue(f"SPEC      {where}: unknown theme {short(name)} (use {' '.join(MUTED)}) -> used {default}")
    return MUTED[default]


def _normalise(s):
    """Validate the layers spec up front so problems surface as SpecError, not tracebacks."""
    layers = s.get("layers")
    if not isinstance(layers, list) or not layers:
        raise SpecError("layers spec: 'layers' must be a non-empty list")
    for i, L in enumerate(layers):
        w = f"layers[{i}]"
        L["name"] = req(L, "name", w)
        for r, row in enumerate(opt_list(L, "rows", w)):
            if not isinstance(row, dict):
                raise SpecError(f"{w}.rows[{r}]: expected an object with 'items'")
            for k, it in enumerate(opt_list(row, "items", f"{w}.rows[{r}]")):
                it["label"] = req(it, "label", f"{w}.rows[{r}].items[{k}]")
        if L.get("aside") is not None:
            L["aside"]["text"] = req(L["aside"], "text", f"{w}.aside")
    rails = s.get("rails") or {}
    if not isinstance(rails, dict):
        raise SpecError("rails: expected an object with 'left' and/or 'right'")
    for side in ("left", "right"):
        if rails.get(side):
            rails[side]["title"] = req(rails[side], "title", f"rails.{side}")
            for b, bl in enumerate(opt_list(rails[side], "bullets", f"rails.{side}")):
                if not isinstance(bl, (str, int, float)):
                    raise SpecError(f"rails.{side}.bullets[{b}]: expected a string")
    for k, it in enumerate(opt_list(s, "summary", "spec")):
        it["text"] = req(it, "text", f"summary[{k}]")
    return layers, rails


def render_layers(s):
    layers, rails = _normalise(s)
    W = num(s.get("width"), "width", 1200, lo=1, hi=20000)
    P = []
    y = 46
    kicker, title = opt_str(s, "kicker", "spec"), opt_str(s, "title", "spec")
    subtitle, byline = opt_str(s, "subtitle", "spec"), opt_str(s, "byline", "spec")
    if kicker:
        kw = approx_w(kicker, 18, 700) + len(kicker) * 3
        check(kicker, 18, 700, W - 80 - 40, "kicker", ls=3)
        P.append(icon(s.get("kicker_icon", "sparkle"), W / 2 - kw / 2 - 40, y - 15, 30, "#D2703A", 2.2))
        P.append(text(W / 2 + 8, y, kicker, 18, INK, 700, ls=3))
        y += 64
    if title:
        check(title, 54, 700, W - 80, "title")
        P.append(text(W / 2, y, title, 54, INK, 700, family=SERIF))
        y += 60
    if subtitle:
        check(subtitle, 25, 600, W - 80, "subtitle", ls=0.5)
        P.append(text(W / 2, y, subtitle, 25, INK, 600, ls=0.5))
        y += 42
    if byline:
        check(byline, 18, 500, W - 80, "byline")
        P.append(text(W / 2, y, byline, 18, SOFT_INK, 500))
        y += 34

    railW = num(s.get("rail_width"), "rail_width", 160, lo=0)
    x0 = 40 + (railW + 34 if rails.get("left") else 0)
    x1 = W - 40 - (railW + 34 if rails.get("right") else 0)
    y += 20
    boxes = []
    for i, L in enumerate(layers):
        lw_ = f"layer {i + 1} {short(L['name'], 30)}"
        base, tint, ink = palette(L.get("theme"), "slate", lw_)
        h = num(L.get("h"), f"{lw_}.h", 170, lo=0)
        boxes.append((x0, y, x1 - x0, h))
        P.append(f'<rect x="{x0}" y="{y}" width="{x1-x0}" height="{h}" rx="14" fill="{CARD}" '
                 f'stroke="{base}" stroke-opacity=".35" stroke-width="1.6" filter="url(#soft)"/>')
        P.append(f'<path d="M{x0+2} {y+14} V{y+h-14}" stroke="{base}" stroke-width="5" stroke-linecap="round"/>')
        # header
        hx, hy = x0 + 24, y + 34
        badge = str(L.get("n", i + 1))
        P.append(f'<rect x="{hx}" y="{hy-15}" width="30" height="30" rx="6" fill="{base}"/>')
        P.append(text(hx + 15, hy, badge, 18, "#fff", 700))
        hx += 42
        pre = str(L.get("prefix", f"Layer {badge} \u2014 "))
        P.append(text(hx, hy, pre, 20, INK, 500, anchor="start"))
        hx += approx_w(pre, 20, 500)
        P.append(text(hx, hy, L["name"], 30, base, 700, anchor="start"))
        hx += approx_w(L["name"], 30, 700) + 28
        tagline = opt_str(L, "tagline", lw_)
        if tagline:
            P.append(text(hx, hy, tagline, 20, base, 500, anchor="start", family=SERIF, italic=True))
        head_end = hx + (approx_w(tagline, 20, 500) if tagline else -28)
        if head_end > x1 - 20:
            issue(f"OVERFLOW  {lw_} header (prefix + name + tagline) needs ~{head_end - x0 - 24:.0f}px, "
                  f"has {x1 - 20 - x0 - 24:.0f}px -> shorten the name/tagline or set prefix \"\"")

        body_t, body_b = y + 64, y + h - 16
        bx = x0 + 30
        if L.get("icon"):
            ic = 58
            lab = opt_str(L, "icon_label", lw_)
            iy = (body_t + body_b) / 2 - (ic / 2 + (12 if lab else 0))
            P.append(icon(L["icon"], bx + 10, iy, ic, SOFT_INK, 1.6))
            if lab:
                check(lab, 15, 500, 110, f"{lw_} icon_label")
                P.append(text(bx + 10 + ic / 2, iy + ic + 20, lab, 15, INK, 500))
            bx += 110
        ax = x1 - 24
        if L.get("aside"):
            A = L["aside"]
            aw = num(A.get("w"), f"{lw_}.aside.w", 170, lo=0)
            ax = x1 - 20 - aw
            P.append(f'<rect x="{ax}" y="{body_t - 14}" width="{aw}" height="{body_b - body_t + 4}" rx="10" '
                     f'fill="{tint}" stroke="{base}" stroke-opacity=".35" stroke-width="1.3"/>')
            ty = body_t + 6
            if A.get("icon"):
                P.append(icon(A["icon"], ax + aw / 2 - 13, ty - 6, 26, ink, 2))
                ty += 34
            body = wrap(A["text"], 14, aw - 24, 500)
            nlines = body.count("\n") + 1
            check_words(A["text"], 14, 500, aw - 8, f"{lw_} aside text")   # inside the box border
            last_mid = ty + 2 + (nlines - 1) * 17          # centre line of the last wrapped line
            if last_mid > body_b - 10 - 2:                 # box bottom is body_b - 10
                issue(f"OVERFLOW  {lw_} aside text: {nlines} wrapped line(s) run out of the aside box "
                      "-> shorten it, widen aside.w, or raise the layer h")
            P.append(text(ax + aw / 2, ty + (nlines - 1) * 17 / 2 + 2, body, 14, INK, 500))
            ax -= 20
        # chip rows
        rows = []
        avail = ax - bx
        for row in opt_list(L, "rows", lw_):
            if row.get("arrows"):
                rows.append(row)
                continue
            line, wsum = [], 0
            for it in opt_list(row, "items", lw_):   # auto-wrap plain chip rows that don't fit
                cw = chip_w(it) + (14 if line else 0)
                if line and wsum + cw > avail:
                    rows.append({**row, "items": line})
                    line, wsum = [], 0
                    cw = chip_w(it)
                line.append(it)
                wsum += cw
            if line:
                rows.append({**row, "items": line})
        note = opt_str(L, "note", lw_)
        area_b = body_b - (30 if note else 0)
        n = max(len(rows), 1)
        step = (area_b - body_t) / n
        tallest = max((chip_h(it) for row in rows for it in row.get("items", [])), default=0)
        if rows and tallest > step + 1:
            want = h + tallest * n - (area_b - body_t) + 4
            issue(f"OVERFLOW  {lw_}: {len(rows)} chip row(s) (after auto-wrap) need ~{tallest * n:.0f}px of height, "
                  f"have {area_b - body_t:.0f}px, so chips overlap or leave the card -> raise h to >= {want:.0f}, "
                  "use fewer/shorter chips, or narrow the aside")
        for r, row in enumerate(rows):
            items = row["items"]
            arrows = row.get("arrows", False)
            gap = 44 if arrows else 14
            total = sum(chip_w(it) for it in items) + gap * (len(items) - 1)
            if total > avail:
                issue(f"OVERFLOW  {lw_} row {r+1} is {total:.0f}px wide, only {avail:.0f}px available "
                      "-> shorten labels, narrow the aside, or drop the rails")
            cx = bx + max(0, (avail - total) / 2) if row.get("align") != "left" else bx
            cy = body_t + step * (r + 0.5)
            for k, it in enumerate(items):
                w = _chip(P, cx, cy, it["label"], it.get("icon"), base, tint, ink)
                if arrows and k < len(items) - 1:
                    P.append(f'<line x1="{cx+w+8}" y1="{cy}" x2="{cx+w+gap-8}" y2="{cy}" stroke="{EDGE}" '
                             f'stroke-width="2.2" marker-end="url(#ah)"/>')
                cx += w + gap
        if note:
            check(note, 15, 500, ax - bx, f"{lw_} note")
            P.append(text((bx + ax) / 2, body_b - 12, note, 15, INK, 500))
        y += h + num(s.get("gap"), "gap", 18)

    # rails
    def rail(side, R):
        base, tint, ink = palette(R.get("theme"), "orange", f"rails.{side}")
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
        check_words(R["title"], 26, 700, railW - 8, f"rails.{side} title")
        nl = t.count("\n") + 1
        P.append(text(rx + railW / 2, cy + (nl - 1) * 16 + 12, t, 26, INK, 700))
        cy += nl * 32 + 10
        P.append(f'<line x1="{rx+railW/2-14}" y1="{cy}" x2="{rx+railW/2+14}" y2="{cy}" stroke="{base}" stroke-width="2.5"/>')
        cy += 26
        for bl in R.get("bullets", []):
            bt = wrap(bl, 16, railW - 44, 500)
            check_words(bl, 16, 500, railW - 34, f"rails.{side} bullet")
            k = bt.count("\n") + 1
            P.append(f'<circle cx="{rx+18}" cy="{cy}" r="3.5" fill="{base}"/>')
            P.append(text(rx + 30, cy + (k - 1) * 9.8, bt, 16, INK, 500, anchor="start"))
            cy += k * 20 + 16
        if cy - 26 > bot - 8:
            issue(f"OVERFLOW  rails.{side}: title + bullets need ~{cy - 26 - top:.0f}px, the rail is "
                  f"{bot - top:.0f}px tall -> fewer/shorter bullets or taller middle layers")
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
        if not isinstance(items, list):
            raise SpecError("summary: expected a list")
        y += 10
        sh = 96
        P.append(f'<rect x="40" y="{y}" width="{W-80}" height="{sh}" rx="14" fill="{CARD}" '
                 f'stroke="#D9D2C6" stroke-width="1.5"/>')
        slot = (W - 80 - 40) / len(items)
        layer_themes = [L.get("theme", "slate") if L.get("theme") in MUTED else "slate" for L in layers]
        for k, it in enumerate(items):
            base = palette(it.get("theme", layer_themes[k % len(layer_themes)]), "slate", f"summary[{k}]")[0]
            sx = 60 + k * slot
            cy = y + sh / 2
            P.append(f'<rect x="{sx}" y="{cy-26}" width="52" height="52" rx="10" fill="#fff" '
                     f'stroke="{base}" stroke-width="1.6"/>')
            P.append(icon(it.get("icon", "box"), sx + 12, cy - 14, 28, base, 1.9))
            t = wrap(it["text"], 14, slot - 100, 500)
            check_words(it["text"], 14, 500, slot - 100, f"summary[{k}] text")
            check_lines(t, 17, sh - 16, f"summary[{k}] text")
            P.append(text(sx + 64, cy, t, 14, INK, 500, anchor="start"))
            if k < len(items) - 1:
                arx = sx + slot - 26
                P.append(f'<line x1="{arx}" y1="{cy}" x2="{arx+18}" y2="{cy}" stroke="{EDGE}" '
                         f'stroke-width="2.2" marker-end="url(#ah)"/>')
        y += sh
    H = cap_height(int(y + 40))
    defs = (
        '<defs>'
        f'<marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="{EDGE}"/></marker>'
        f'<marker id="ahs" viewBox="0 0 10 10" refX="1.5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M10 0L0 5L10 10z" fill="{EDGE}"/></marker>'
        '<filter id="soft" x="-3%" y="-5%" width="106%" height="115%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#5A4A30" flood-opacity=".08"/></filter>'
        '</defs>')
    bg = color(s.get("background"), PAPER, "background")
    return svg_wrap(W, H, defs, bg, "".join(P)), W, H
