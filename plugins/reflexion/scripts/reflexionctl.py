#!/usr/bin/env python3
"""reflexionctl — recall/reflect/library/compress over a memory-keeper store.

Implements the Memory Loops (Reflexion, Error Library, Success Pattern, Memory Compression) from
docs/proposals/REFLEXION_SPEC.md as a workflow layered on top of an existing memory-keeper store.
Every lesson is a normal memory-keeper topic file (``metadata.type: feedback``, plus
``metadata.loop: reflexion|error|success``) — reflexionctl adds only retrieve/extract/merge logic; it
never reimplements the store. All index/archive/compact work is delegated to memory-keeper's
``memctl.py``, loaded dynamically (see ``_resolve_memctl_path``).

Commands
--------
  recall     Surface lessons matching a task, ranked by keyword overlap. Read-only.
  reflect    Write a new feedback lesson (what/why/how), de-duped against existing ones.
  library    Browse the error/success library (or all feedback lessons).
  compress   Merge N recurring lessons into one higher-level pattern; archives the originals.

Stdlib only.

Examples
--------
  python reflexionctl.py recall "writing a Stop hook" --dir ~/path/to/memory
  python reflexionctl.py reflect --what "..." --why "..." --how "..." --dir ~/path/to/memory
  python reflexionctl.py library --loop error --dir ~/path/to/memory
  python reflexionctl.py compress --names lesson-a lesson-b --pattern "..." --how "..." --dir ~/path/to/memory
"""
from __future__ import annotations

import argparse
import difflib
import importlib.util
import os
import re
import sys
from pathlib import Path
from types import ModuleType

DEFAULT_TOP_K = int(os.environ.get("REFLEXION_TOP_K", "5"))
DUPLICATE_THRESHOLD = 0.72
LOOP_CHOICES = ["reflexion", "error", "success"]


# ── locate & load memory-keeper's memctl.py (single source of truth for the store) ────────────────
def _resolve_memctl_path() -> Path:
    env = os.environ.get("MEMCTL_PATH")
    if env:
        p = Path(env).expanduser()
        if p.exists():
            return p
        raise FileNotFoundError(f"MEMCTL_PATH is set but not found: {p}")

    here = Path(__file__).resolve()
    # in-repo dev layout: plugins/reflexion/scripts/reflexionctl.py -> plugins/memory-keeper/scripts/memctl.py
    sibling = here.parents[2] / "memory-keeper" / "scripts" / "memctl.py"
    if sibling.exists():
        return sibling

    # installed layout: <marketplace-root>/reflexion[/<version>]/scripts/reflexionctl.py — search siblings
    # since the plugin cache path is versioned and not knowable ahead of time.
    plugin_root = here.parents[1]
    marketplace_root = plugin_root.parent
    for pattern in ("memory-keeper*/scripts/memctl.py", "memory-keeper*/**/scripts/memctl.py"):
        hits = sorted(marketplace_root.glob(pattern))
        if hits:
            return hits[0]

    raise FileNotFoundError(
        "cannot locate memory-keeper's memctl.py — install the memory-keeper plugin alongside "
        "reflexion, or set MEMCTL_PATH explicitly"
    )


def _load_memctl() -> ModuleType:
    path = _resolve_memctl_path()
    spec = importlib.util.spec_from_file_location("memctl", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module  # dataclass() needs the module registered before exec
    spec.loader.exec_module(module)
    return module


# ── shared helpers ─────────────────────────────────────────────────────────────
def _loop_of(memctl: ModuleType, m) -> str | None:
    text = m.path.read_text(encoding="utf-8", errors="replace")
    data, _, _ = memctl.parse_frontmatter(text)
    loop = data.get("metadata.loop", "").strip().lower()
    return loop or None


def _feedback_lessons(memctl: ModuleType, mem_dir: Path):
    mems = memctl.scan(mem_dir)
    return [m for m in mems if m.type == "feedback" and not m.is_archived]


def _slugify(text: str, prefix: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    s = s[:50].strip("-")
    return f"{prefix}-{s}" if s else prefix


def _render_frontmatter(name: str, description: str, loop: str, status: str = "active") -> str:
    return (
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "metadata:\n"
        "  type: feedback\n"
        f"  loop: {loop}\n"
        f"  status: {status}\n"
        "---\n\n"
    )


def _render_lesson_body(what: str, why: str, how: str, related: list[str]) -> str:
    lines = [
        f"**What happened:** {what}",
        f"**Why it failed / worked:** {why}",
        f"**How to apply next time:** {how}",
    ]
    if related:
        lines.append("Related: " + ", ".join(f"[[{r}]]" for r in related))
    return "\n".join(lines) + "\n"


def _render_pattern_body(pattern: str, how: str, sources: list) -> str:
    lines = [f"**Pattern:** {pattern}", f"**How to apply:** {how}", "", "Collapsed from:"]
    for m in sources:
        lines.append(f"- [[{m.name}]] — {m.description}")
    return "\n".join(lines) + "\n"


def _sync_indexes(memctl: ModuleType, mem_dir: Path) -> None:
    memctl.write_index(mem_dir, memctl.DEFAULT_MAX_HOOK, memctl.DEFAULT_BUDGET)
    memctl.write_archive_index(mem_dir, memctl.DEFAULT_MAX_HOOK)


# ── recall ──────────────────────────────────────────────────────────────────────
def _relevance(m, query_words: set[str]) -> float:
    if not query_words:
        return 0.0
    haystack = f"{m.name} {m.description} {m.body}".lower()
    hits = sum(1 for w in query_words if w in haystack)
    return hits / len(query_words)


def cmd_recall(args) -> int:
    memctl = _load_memctl()
    mem_dir = Path(args.dir).expanduser()
    candidates = _feedback_lessons(memctl, mem_dir)
    if args.loop:
        candidates = [m for m in candidates if _loop_of(memctl, m) == args.loop]

    query_words = set(re.findall(r"[a-z0-9_]+", args.query.lower()))
    scored = sorted(candidates, key=lambda m: _relevance(m, query_words), reverse=True)
    top = scored[: args.top_k]

    if not top:
        print("no matching lessons found.")
        return 0
    for m in top:
        loop = _loop_of(memctl, m) or "-"
        print(f"[{loop}] {m.name} — {m.description}")
    return 0


# ── reflect ─────────────────────────────────────────────────────────────────────
_WHAT_RE = re.compile(r"\*\*What happened:\*\*\s*(.+)")


def _extract_what(body: str) -> str:
    m = _WHAT_RE.search(body)
    return m.group(1).strip() if m else body


def _find_duplicate(candidates, what: str, name: str):
    what = what.lower()
    for m in candidates:
        if m.name == name:
            return m
        against_what = difflib.SequenceMatcher(None, what, _extract_what(m.body).lower()).ratio()
        against_desc = difflib.SequenceMatcher(None, what, m.description.lower()).ratio()
        if max(against_what, against_desc) >= DUPLICATE_THRESHOLD:
            return m
    return None


def cmd_reflect(args) -> int:
    memctl = _load_memctl()
    mem_dir = Path(args.dir).expanduser()
    name = args.name or _slugify(args.what, "lesson")
    candidates = _feedback_lessons(memctl, mem_dir)

    dup = _find_duplicate(candidates, args.what, name)
    if dup and not args.force:
        print(f"SKIP: a similar lesson already exists: {dup.name} ({dup.path.name}). "
              f"Use --force to write anyway, or --name to disambiguate.")
        return 1

    description = args.description or args.what[:100]
    frontmatter = _render_frontmatter(name, description, args.loop)
    body = _render_lesson_body(args.what, args.why, args.how, args.related)
    (mem_dir / f"{name}.md").write_text(frontmatter + body, encoding="utf-8")

    _sync_indexes(memctl, mem_dir)
    print(f"wrote {mem_dir / f'{name}.md'}")
    return 0


# ── library ─────────────────────────────────────────────────────────────────────
def cmd_library(args) -> int:
    memctl = _load_memctl()
    mem_dir = Path(args.dir).expanduser()
    lessons = _feedback_lessons(memctl, mem_dir)
    if args.loop:
        lessons = [m for m in lessons if _loop_of(memctl, m) == args.loop]

    if not lessons:
        print("no lessons found.")
        return 0
    for m in sorted(lessons, key=lambda m: m.name):
        loop = _loop_of(memctl, m) or "-"
        print(f"{m.name:40s} [{loop:9s}]  {m.description}")
    return 0


# ── compress ────────────────────────────────────────────────────────────────────
def cmd_compress(args) -> int:
    memctl = _load_memctl()
    mem_dir = Path(args.dir).expanduser()
    by_name = {m.name: m for m in memctl.scan(mem_dir)}

    missing = [n for n in args.names if n not in by_name]
    if missing:
        print(f"error: unknown lesson name(s): {', '.join(missing)}", file=sys.stderr)
        return 2
    sources = [by_name[n] for n in args.names]
    if len(sources) < 2:
        print("error: compress needs at least 2 source lessons", file=sys.stderr)
        return 2

    name = args.name or _slugify(args.pattern, "pattern")
    out_path = mem_dir / f"{name}.md"
    if out_path.exists() and not args.force:
        print(f"error: {out_path} already exists; use --force or a different --name", file=sys.stderr)
        return 2

    print(f"{'DRY RUN — would merge' if args.dry_run else 'merging'} {len(sources)} lesson(s) "
          f"into {out_path.name}:")
    for m in sources:
        print(f"    {m.path.name}")
    if args.dry_run:
        print("\n(no changes made; re-run without --dry-run to apply)")
        return 0

    description = args.description or args.pattern[:100]
    frontmatter = _render_frontmatter(name, description, "reflexion")
    body = _render_pattern_body(args.pattern, args.how, sources)
    out_path.write_text(frontmatter + body, encoding="utf-8")

    adir = mem_dir / memctl.ARCHIVE_DIR
    adir.mkdir(exist_ok=True)
    for m in sources:
        m.path.rename(adir / m.path.name)

    _sync_indexes(memctl, mem_dir)
    print(f"\nwrote {out_path}, archived {len(sources)} source(s) → {adir}")
    return 0


# ── cli ───────────────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dir", default=os.environ.get("MEMCTL_DIR", "."),
                        help="memory-keeper store directory (default: $MEMCTL_DIR or .)")

    p = argparse.ArgumentParser(prog="reflexionctl", description=__doc__, parents=[common],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("recall", parents=[common], help="surface lessons matching a task (read-only)")
    r.add_argument("query", help="free-text description of the task at hand")
    r.add_argument("--top-k", type=int, default=DEFAULT_TOP_K, help="max lessons to return")
    r.add_argument("--loop", choices=LOOP_CHOICES, help="filter by which memory loop produced it")
    r.set_defaults(fn=cmd_recall)

    f = sub.add_parser("reflect", parents=[common], help="write a new feedback lesson")
    f.add_argument("--name", help="stable id for the lesson (default: derived from --what)")
    f.add_argument("--description", help="one-line index hook (default: first 100 chars of --what)")
    f.add_argument("--what", required=True, help="what happened")
    f.add_argument("--why", required=True, help="why it failed or worked")
    f.add_argument("--how", required=True, help="how to apply next time")
    f.add_argument("--loop", choices=LOOP_CHOICES, default="reflexion", help="which memory loop this is")
    f.add_argument("--related", nargs="*", default=[], help="names of related lessons to link")
    f.add_argument("--force", action="store_true", help="write even if a duplicate is detected")
    f.set_defaults(fn=cmd_reflect)

    lib = sub.add_parser("library", parents=[common], help="browse the error/success library")
    lib.add_argument("--loop", choices=LOOP_CHOICES, help="filter by which memory loop produced it")
    lib.set_defaults(fn=cmd_library)

    c = sub.add_parser("compress", parents=[common], help="merge recurring lessons into one pattern")
    c.add_argument("--names", nargs="+", required=True, help="names of lessons to merge (>= 2)")
    c.add_argument("--name", help="stable id for the merged pattern (default: derived from --pattern)")
    c.add_argument("--description", help="one-line index hook (default: first 100 chars of --pattern)")
    c.add_argument("--pattern", required=True, help="the higher-level pattern extracted")
    c.add_argument("--how", required=True, help="how to apply the pattern")
    c.add_argument("--dry-run", action="store_true", help="preview only")
    c.add_argument("--force", action="store_true", help="overwrite an existing pattern file")
    c.set_defaults(fn=cmd_compress)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mem_dir = Path(args.dir).expanduser()
    if not mem_dir.is_dir():
        print(f"error: --dir {mem_dir} is not a directory", file=sys.stderr)
        return 2
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
