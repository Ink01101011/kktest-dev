"""Shared helpers for every archetype: escaping, value validation, text metrics, lint.

Every value taken from a spec that ends up inside an SVG attribute goes through
`color()` or `num()`; every value that ends up as element text goes through `text()`
(which escapes). Anything that fails validation falls back to a safe default and adds a
`SPEC` lint issue, or raises `SpecError` when there is no sensible default.
"""
import html
import math
import re

# Latin-capable fonts first (so Latin text never lands in a Thai-only face), then fonts that
# carry Thai glyphs on each OS: Noto Sans Thai (Linux/any), Leelawadee UI (Windows),
# Thonburi (macOS), Tahoma (Windows/older systems). Rendering depends on installed fonts.
THAI_FALLBACK = "'Noto Sans Thai', 'Leelawadee UI', Thonburi, Tahoma"
FONT = f"Inter, 'Segoe UI', Helvetica, Arial, {THAI_FALLBACK}, sans-serif"
SERIF = f"Georgia, 'Noto Serif', 'DejaVu Serif', {THAI_FALLBACK}, serif"

ISSUES = []          # lint issues of the current build; reset by build.build()


class SpecError(ValueError):
    """A spec problem with no safe fallback (missing field, bad reference, wrong type)."""


def issue(msg):
    ISSUES.append(msg)


# Characters XML 1.0 forbids even as character references; a spec title with one would make the SVG
# malformed, so they are dropped (G2 nit). Tab, LF and CR are allowed and kept.
_XML_INVALID = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff\ud800-\udfff]")


def esc(s):
    return html.escape(_XML_INVALID.sub("", str(s)), quote=True)


MAX_CANVAS = 20000   # px, either side; Chromium cannot screenshot much more (G4-M2)


def cap_height(H):
    """Auto-computed canvas height, capped at MAX_CANVAS with a CANVAS lint issue."""
    if H > MAX_CANVAS:
        issue(f"CANVAS    the content needs a canvas {H}px tall, over the {MAX_CANVAS}px limit -> "
              f"cut at {MAX_CANVAS}px; split the diagram")
        return MAX_CANVAS
    return H


# ---------- value validation ----------
_HEX = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")
_N = r"\s*[0-9]{1,3}(?:\.[0-9]+)?%?\s*"
_RGB = re.compile(rf"rgba?\({_N},{_N},{_N}(?:,\s*(?:0|1|0?\.[0-9]+|[0-9]{{1,3}}%)\s*)?\)")
NAMED_COLORS = frozenset("""
aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray
lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon
mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue
mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin
navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen
paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle
tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent none
""".split())


def is_color(v):
    if not isinstance(v, str):
        return False
    s = v.strip()
    return bool(_HEX.fullmatch(s) or _RGB.fullmatch(s) or s.lower() in NAMED_COLORS)


def color(v, default, where):
    """Return a safe colour string: `v` if it matches the allowlist, else `default` + a lint issue."""
    if v is None:
        return default
    if is_color(v):
        return v.strip()
    issue(f"SPEC      {where}: colour {short(v)} is not #hex, rgb()/rgba() or a CSS colour name "
          f"-> used {default}")
    return default


def num(v, where, default=None, lo=None, hi=None):
    """Coerce a spec number with float(); reject NaN/inf and non-numbers. Integral -> int."""
    if v is None:
        if default is None:
            raise SpecError(f"{where}: required number is missing")
        return default
    if isinstance(v, bool):
        raise SpecError(f"{where}: expected a number, got {short(v)}")
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise SpecError(f"{where}: expected a number, got {short(v)}") from None
    if not math.isfinite(f):
        raise SpecError(f"{where}: number must be finite, got {short(v)}")
    if lo is not None and f < lo:
        raise SpecError(f"{where}: must be >= {lo}, got {short(v)}")
    if hi is not None and f > hi:
        raise SpecError(f"{where}: must be <= {hi}, got {short(v)}")
    return int(f) if f.is_integer() else f


def short(v, n=40):
    r = repr(v)
    return r if len(r) <= n else r[:n - 3] + "..."


def req(d, key, where, kind=str):
    """Fetch a required field; kind=str also accepts numbers (rendered as text)."""
    if not isinstance(d, dict):
        raise SpecError(f"{where}: expected an object, got {short(d)}")
    if key not in d or d[key] is None:
        raise SpecError(f"{where}: missing required field '{key}'")
    v = d[key]
    if kind is str:
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
        if not isinstance(v, str):
            raise SpecError(f"{where}.{key}: expected a string, got {short(v)}")
        return v
    if not isinstance(v, kind):
        raise SpecError(f"{where}.{key}: expected {kind.__name__}, got {short(v)}")
    return v


def opt_list(d, key, where):
    v = d.get(key)
    if v is None:
        return []
    if not isinstance(v, list):
        raise SpecError(f"{where}.{key}: expected a list, got {short(v)}")
    return v


def opt_str(d, key, where):
    """Optional text field: None/missing -> None, numbers -> str, other types -> SpecError."""
    v = d.get(key)
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return str(v)
    if not isinstance(v, str):
        raise SpecError(f"{where}.{key}: expected a string, got {short(v)}")
    return v


# ---------- text ----------
def text(x, y, s, size, color, weight=400, anchor="middle", family=None, italic=False, ls=None, filt=None):
    """`color`, `family`, `ls`, `filt`, `anchor` are internal values (never raw spec input)."""
    lines = str(s).split("\n")
    lh = size * 1.22
    y0 = y - (len(lines) - 1) * lh / 2
    extra = ""
    if family:
        extra += f' font-family="{esc(family)}"'
    if italic:
        extra += ' font-style="italic"'
    if ls:
        extra += f' letter-spacing="{esc(ls)}"'
    if filt:
        extra += f' filter="url(#{esc(filt)})"'
    out = []
    for i, ln in enumerate(lines):
        out.append(f'<text x="{x:.1f}" y="{y0 + i*lh:.1f}" font-size="{size}" '
                   f'font-weight="{weight}" fill="{esc(color)}" text-anchor="{anchor}" '
                   f'dominant-baseline="central"{extra}>{esc(ln)}</text>')
    return "".join(out)


def wrap(s, size, width, weight=400):
    """Greedy word wrap using approx_w; keeps explicit \\n breaks."""
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


def approx_w(s, size, weight=400, ls=0):
    """Estimate rendered width (Inter-like metrics; Thai combining marks count as 0).
    `ls` = letter-spacing in px, added per character."""
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
        return t * size * (1.06 if weight >= 600 else 1.0) + ls * len(line)
    return max((w(l) for l in str(s).split("\n")), default=0)


def check(s, size, weight, avail, where="label", ls=0):
    """OVERFLOW lint: estimated width of the longest line of `s` vs the `avail` px it has."""
    need = approx_w(s, size, weight, ls)
    if need > avail - 4:
        issue(f"OVERFLOW  {where}: {short(str(s), 60)} needs ~{need:.0f}px, has {avail-4:.0f}px "
              "-> widen the box, break with \\n, or shorten")


def check_lines(s, line_h, avail_h, where):
    """OVERFLOW lint for wrapped text blocks: number of lines x line height vs available height."""
    n = str(s).count("\n") + 1
    need = n * line_h
    if need > avail_h + 1:
        issue(f"OVERFLOW  {where}: {n} wrapped line(s) need ~{need:.0f}px of height, has {avail_h:.0f}px "
              "-> shorten the text or give it more room")


def check_words(s, size, weight, avail, where):
    """A wrapped block still overflows if a single word is wider than the box."""
    for word in str(s).replace("\n", " ").split(" "):
        if word and approx_w(word, size, weight) > avail:
            check(word, size, weight, avail + 4, where)
            return


def svg_wrap(W, H, defs, bg, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
            f'font-family="{esc(FONT)}">{defs}<rect width="100%" height="100%" fill="{bg}"/>'
            + body + "</svg>")
