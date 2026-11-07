"""Archetype: TREE — dark, neon, top-down taxonomy of a stack.
Root request at top, then rows of category groups; each group has a glowing icon,
an UPPERCASE title, and a bracket of item icons with labels underneath.
"""
from common import SpecError, approx_w, check, color, is_color, issue, num, opt_list, opt_str, req, short, svg_wrap, text
from icons import icon

NEON = {
    "green": "#3BE26B", "purple": "#B15CFF", "blue": "#3D8BFF", "orange": "#FF8A2B",
    "yellow": "#FACC15", "pink": "#FF4FA3", "cyan": "#22D3EE", "red": "#FF5A4E",
    "white": "#F3F4F6", "violet": "#8B5CF6",
}
LINE = "#E5E7EB"
BG = "#05060A"


def col(c, where="colour", default="white"):
    """Neon name -> hex; any valid CSS colour passes; anything else -> default + SPEC lint issue."""
    if c is None or c == "":
        return NEON[default]
    if isinstance(c, str) and c in NEON:
        return NEON[c]
    if is_color(c):
        return c.strip()
    issue(f"SPEC      {where}: colour {short(c)} is not a neon name ({' '.join(NEON)}), #hex, rgb() "
          f"or CSS colour name -> used {default}")
    return NEON[default]


def _normalise(s):
    rows = s.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SpecError("tree spec: 'rows' must be a non-empty list")
    out = []
    for r, row in enumerate(rows):
        groups = row.get("groups") if isinstance(row, dict) else row
        if not isinstance(groups, list) or not groups:
            raise SpecError(f"rows[{r}]: expected a non-empty list of groups (or {{\"groups\": [...]}})")
        for g, grp in enumerate(groups):
            w = f"rows[{r}][{g}]"
            grp["title"] = req(grp, "title", w)
            for k, it in enumerate(opt_list(grp, "items", w)):
                it["label"] = req(it, "label", f"{w}.items[{k}]")
            if grp.get("box") is not None:
                grp["box"] = req(grp, "box", w)
        out.append((row, groups))
    if s.get("root") is not None:
        s["root"]["label"] = req(s["root"], "label", "root")
    return out


def item_w(it):
    return max(92, approx_w(it["label"], 16, 600) + 22)


def group_w(g):
    return max(sum(item_w(i) for i in g.get("items", [])), approx_w(g["title"], 22, 800) + 40, 120)


def render_tree(s):
    rows = _normalise(s)
    W = num(s.get("width"), "width", 1200, lo=1, hi=20000)
    P = []
    y = 60
    if s.get("icon"):
        P.append(icon(s["icon"], W / 2 - 34, y, 68, col(s.get("icon_color", "violet"), "icon_color", "violet"), 1.8)
                 .replace("<g ", '<g filter="url(#glow)" ', 1))
        y += 96
    t = opt_str(s, "title", "spec")
    if t:
        check(t, 54, 800, W - 40, "title", ls=2)
        nl = t.count("\n") + 1
        P.append(text(W / 2, y + (nl - 1) * 33, t, 54, "#FFFFFF", 800, ls=2))
        y += nl * 66
    prev = (W / 2, y - 14)
    if s.get("root"):
        R = s["root"]
        lw = approx_w(R["label"], 22, 700)
        check(R["label"], 22, 700, W - 40 - 50, "root label")
        P.append(f'<line x1="{W/2}" y1="{y-14}" x2="{W/2}" y2="{y+6}" stroke="{LINE}" stroke-width="2"/>')
        P.append(icon(R.get("icon", "user"), W / 2 - (lw + 50) / 2, y + 8, 40,
                      col(R.get("color", "blue"), "root.color", "blue"), 2))
        P.append(text(W / 2 - (lw + 50) / 2 + 50, y + 30, R["label"], 22, "#FFFFFF", 700, anchor="start"))
        y += 58
        prev = (W / 2, y)

    for r, (row, groups) in enumerate(rows):
        dashed = ' stroke-dasharray="7 6"' if isinstance(row, dict) and row.get("dashed") else ""
        gap = 56
        widths = [group_w(g) for g in groups]
        total = sum(widths) + gap * (len(groups) - 1)
        if total > W - 40:
            issue(f"OVERFLOW  tree row {r + 1} is {total:.0f}px wide (> {W-40}px) -> split the row or shorten labels")
        gx = (W - total) / 2
        centers = []
        for w in widths:
            centers.append(gx + w / 2)
            gx += w + gap
        bus = y + 22
        # connector from previous anchor
        P.append(f'<path d="M{prev[0]} {prev[1]} V{bus}" stroke="{LINE}" stroke-width="2"{dashed} fill="none"/>')
        if len(groups) > 1:
            P.append(f'<path d="M{min(centers)} {bus+10} V{bus} H{max(centers)} V{bus+10}" fill="none" '
                     f'stroke="{LINE}" stroke-width="2"{dashed}/>')
        top = bus + (16 if len(groups) > 1 else 6)
        bottoms = []
        for gi, (g, cx, w) in enumerate(zip(groups, centers, widths)):
            gw = f"rows[{r}][{gi}] \"{g['title']}\""
            c = col(g.get("color"), f"{gw}.color")
            item_c = col(g.get("item_color", "white"), f"{gw}.item_color")
            inline = len(groups) == 1 or g.get("inline")
            gy = top
            if inline:
                tw = approx_w(g["title"], 22, 800)
                ix = cx - (tw + 56) / 2
                if g.get("icon"):
                    P.append(icon(g["icon"], ix, gy + 4, 44, c, 2).replace("<g ", '<g filter="url(#glow)" ', 1))
                P.append(text(ix + 58, gy + 26, g["title"], 22, c, 800, anchor="start", filt="glow"))
                gy += 58
            else:
                if g.get("icon"):
                    P.append(icon(g["icon"], cx - 28, gy + 4, 56, c, 1.9).replace("<g ", '<g filter="url(#glow)" ', 1))
                P.append(text(cx, gy + 84, g["title"], 22, c, 800, filt="glow"))
                gy += 104
            items = g.get("items", [])
            if items:
                iws = [item_w(i) for i in items]
                ix = cx - sum(iws) / 2
                ic_cent = []
                for iw in iws:
                    ic_cent.append(ix + iw / 2)
                    ix += iw
                b2 = gy + 8
                P.append(f'<path d="M{cx} {gy-4} V{b2}" stroke="{LINE}" stroke-width="2"/>')
                if len(items) > 1:
                    P.append(f'<path d="M{ic_cent[0]} {b2+12} V{b2} H{ic_cent[-1]} V{b2+12}" fill="none" '
                             f'stroke="{LINE}" stroke-width="2"/>')
                iy = b2 + 22
                for k, (it, icx) in enumerate(zip(items, ic_cent)):
                    ic_col = col(it["color"], f"{gw}.items[{k}].color") if it.get("color") else item_c
                    P.append(icon(it.get("icon", "box"), icx - 22, iy, 44, ic_col, 1.9))
                    P.append(text(icx, iy + 64, it["label"], 16, "#F3F4F6", 600))
                gy = iy + 82
                if g.get("box"):
                    # bracket gathering the items, then an outlined box (e.g. "Context Builder")
                    P.append(f'<path d="M{ic_cent[0]} {gy} V{gy+12} H{ic_cent[-1]} V{gy} M{cx} {gy+12} V{gy+24}" '
                             f'fill="none" stroke="{LINE}" stroke-width="2"/>')
                    bw = approx_w(g["box"], 17, 600) + 76
                    check(g["box"], 17, 600, W - 40 - 76, f"{gw} box")
                    P.append(f'<rect x="{cx-bw/2}" y="{gy+24}" width="{bw}" height="48" rx="10" fill="none" '
                             f'stroke="{c}" stroke-width="2.2" filter="url(#glow)"/>')
                    P.append(icon(g.get("box_icon", "plug"), cx - bw / 2 + 14, gy + 36, 24, LINE, 1.8))
                    P.append(text(cx + 16, gy + 48, g["box"], 17, "#F3F4F6", 600))
                    gy += 80
            bottoms.append(gy)
        y = max(bottoms) + 8
        # gather this row's groups back into one anchor for the next row
        if len(groups) > 1:
            gy = y + 6
            for cx_, bt in zip(centers, bottoms):
                P.append(f'<path d="M{cx_} {bt-4} V{gy}" stroke="{LINE}" stroke-width="2"{dashed}/>')
            P.append(f'<path d="M{min(centers)} {gy} H{max(centers)}" stroke="{LINE}" stroke-width="2"{dashed}/>')
            y = gy
        prev = (W / 2, y)
        y += 14
    footer = opt_str(s, "footer", "spec")
    if footer:
        y += 20
        fw = approx_w(footer, 16, 500)
        if fw + 400 > W:
            issue(f"OVERFLOW  footer: {short(footer, 60)} needs ~{fw + 400:.0f}px with its side rules, "
                  f"canvas is {W}px -> shorten it")
        P.append(f'<line x1="{W/2-fw/2-180}" y1="{y}" x2="{W/2-fw/2-20}" y2="{y}" stroke="#6B7280" stroke-width="1.2"/>')
        P.append(f'<line x1="{W/2+fw/2+20}" y1="{y}" x2="{W/2+fw/2+180}" y2="{y}" stroke="#6B7280" stroke-width="1.2"/>')
        P.append(text(W / 2, y, footer, 16, "#D1D5DB", 500))
        y += 20
    H = int(y + 50)
    defs = ('<defs><filter id="glow" x="-30%" y="-30%" width="160%" height="160%">'
            '<feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/>'
            '<feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    bg = color(s.get("background"), BG, "background")
    return svg_wrap(W, H, defs, bg, "".join(P)), W, H
