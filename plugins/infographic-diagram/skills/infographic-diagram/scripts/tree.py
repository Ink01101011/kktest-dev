"""Archetype: TREE — dark, neon, top-down taxonomy of a stack.
Root request at top, then rows of category groups; each group has a glowing icon,
an UPPERCASE title, and a bracket of item icons with labels underneath.
"""
import sys
from build import text, approx_w
from icons import icon

ISSUES = []

NEON = {
    "green": "#3BE26B", "purple": "#B15CFF", "blue": "#3D8BFF", "orange": "#FF8A2B",
    "yellow": "#FACC15", "pink": "#FF4FA3", "cyan": "#22D3EE", "red": "#FF5A4E",
    "white": "#F3F4F6", "violet": "#8B5CF6",
}
LINE = "#E5E7EB"
BG = "#05060A"


def col(c):
    return NEON.get(c, c or NEON["white"])


def item_w(it):
    return max(92, approx_w(it["label"], 16, 600) + 22)


def group_w(g):
    return max(sum(item_w(i) for i in g.get("items", [])), approx_w(g["title"], 22, 800) + 40, 120)


def render_tree(s):
    W = s.get("width", 1200)
    P = []
    y = 60
    if s.get("icon"):
        P.append(icon(s["icon"], W / 2 - 34, y, 68, col(s.get("icon_color", "violet")), 1.8)
                 .replace("<g ", '<g filter="url(#glow)" ', 1))
        y += 96
    if s.get("title"):
        t = s["title"]
        nl = t.count("\n") + 1
        P.append(text(W / 2, y + (nl - 1) * 33, t, 54, "#FFFFFF", 800, ls=2))
        y += nl * 66
    prev = (W / 2, y - 14)
    if s.get("root"):
        R = s["root"]
        lw = approx_w(R["label"], 22, 700)
        P.append(f'<line x1="{W/2}" y1="{y-14}" x2="{W/2}" y2="{y+6}" stroke="{LINE}" stroke-width="2"/>')
        P.append(icon(R.get("icon", "user"), W / 2 - (lw + 50) / 2, y + 8, 40, col(R.get("color", "blue")), 2))
        P.append(text(W / 2 - (lw + 50) / 2 + 50, y + 30, R["label"], 22, "#FFFFFF", 700, anchor="start"))
        y += 58
        prev = (W / 2, y)

    for row in s["rows"]:
        groups = row["groups"] if isinstance(row, dict) else row
        dashed = ' stroke-dasharray="7 6"' if isinstance(row, dict) and row.get("dashed") else ""
        gap = 56
        widths = [group_w(g) for g in groups]
        total = sum(widths) + gap * (len(groups) - 1)
        if total > W - 40:
            ISSUES.append(f"OVERFLOW  tree row is {total:.0f}px wide (> {W-40}px) -> split the row or shorten labels")
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
        for g, cx, w in zip(groups, centers, widths):
            c = col(g.get("color"))
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
                for it, icx in zip(items, ic_cent):
                    ic_col = col(it.get("color", g.get("item_color", "white")))
                    P.append(icon(it.get("icon", "box"), icx - 22, iy, 44, ic_col, 1.9))
                    P.append(text(icx, iy + 64, it["label"], 16, "#F3F4F6", 600))
                gy = iy + 82
                if g.get("box"):
                    # bracket gathering the items, then an outlined box (e.g. "Context Builder")
                    P.append(f'<path d="M{ic_cent[0]} {gy} V{gy+12} H{ic_cent[-1]} V{gy} M{cx} {gy+12} V{gy+24}" '
                             f'fill="none" stroke="{LINE}" stroke-width="2"/>')
                    bw = approx_w(g["box"], 17, 600) + 76
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
    if s.get("footer"):
        y += 20
        fw = approx_w(s["footer"], 16, 500)
        P.append(f'<line x1="{W/2-fw/2-180}" y1="{y}" x2="{W/2-fw/2-20}" y2="{y}" stroke="#6B7280" stroke-width="1.2"/>')
        P.append(f'<line x1="{W/2+fw/2+20}" y1="{y}" x2="{W/2+fw/2+180}" y2="{y}" stroke="#6B7280" stroke-width="1.2"/>')
        P.append(text(W / 2, y, s["footer"], 16, "#D1D5DB", 500))
        y += 20
    H = int(y + 50)
    defs = ('<defs><filter id="glow" x="-30%" y="-30%" width="160%" height="160%">'
            '<feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/>'
            '<feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    font = "Inter, 'Noto Sans Thai', 'Segoe UI', Helvetica, Arial, sans-serif"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
            f'font-family="{font}">{defs}<rect width="100%" height="100%" fill="{s.get("background", BG)}"/>'
            + "".join(P) + "</svg>")
