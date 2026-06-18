#!/usr/bin/env python3
"""memctl — maintenance CLI for a file-based memory store.

A memory store is a directory of one-fact-per-file Markdown topic files, each with
YAML frontmatter (``name``, ``description``, ``metadata.type``, optional ``metadata.status``),
plus a generated index ``MEMORY.md`` that is loaded into context every session.

Core principle: **the index is a projection of frontmatter, never hand-maintained.**
That guarantees it can't drift from the topic files and its size stays bounded.

Commands
--------
  analyze   Report index size vs budget, per-entry stats, and stale/archive candidates.
  compact   Regenerate MEMORY.md from each topic file's frontmatter (terse, grouped, bounded).
  archive   Move done/stale memories into archive/ and regenerate both indexes.
  lint      Exit non-zero if the index is over budget (use in pre-commit / CI).

Stdlib only. Safe by default: `archive` requires an explicit selector; `--dry-run` previews.

Examples
--------
  python memctl.py analyze --dir ~/path/to/memory
  python memctl.py compact --dir ~/path/to/memory
  python memctl.py archive --dir ~/path/to/memory --auto --dry-run
  python memctl.py archive --dir ~/path/to/memory --auto
  python memctl.py lint    --dir ~/path/to/memory --budget 24000
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_BUDGET = 24_000          # bytes; the index is loaded every session
DEFAULT_MAX_HOOK = 100           # chars of description kept in an index line
TYPE_ORDER = ["user", "project", "reference", "feedback"]
DONE_RE = re.compile(r"\b(done|shipped|completed|complete|closed|archived|deprecated)\b", re.I)
INDEX_NAME = "MEMORY.md"
ARCHIVE_DIR = "archive"
ARCHIVE_INDEX = "MEMORY.archive.md"


# ── frontmatter parsing ───────────────────────────────────────────────────────
@dataclass
class Memory:
    path: Path
    name: str
    description: str
    type: str = "other"
    status: str = "active"
    body: str = ""
    mtime: float = 0.0
    raw_frontmatter: bool = True  # False if file had no/invalid frontmatter

    @property
    def is_archived(self) -> bool:
        return self.status.lower() == "archived"


def _strip(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        v = v[1:-1]
    return v.strip()


def parse_frontmatter(text: str) -> tuple[dict, str, bool]:
    """Return (flat_dict, body, had_frontmatter). One level of nesting under `metadata:` is flattened
    to `metadata.<key>`. Deliberately small — handles the memory frontmatter dialect, not full YAML."""
    if not text.startswith("---"):
        return {}, text, False
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text, False
    fm = text[3:end].strip("\n")
    body = text[end + 4 :].lstrip("\n")
    data: dict[str, str] = {}
    current_parent: str | None = None
    for line in fm.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indented = line[0] in " \t"
        if ":" not in line:
            continue
        key, _, val = line.strip().partition(":")
        key = key.strip()
        val = val.strip()
        if val.startswith("{") and val.endswith("}"):   # inline flow map: metadata: {type: x, status: y}
            current_parent = None
            for pair in val[1:-1].split(","):
                if ":" in pair:
                    k, _, v = pair.partition(":")
                    data[f"{key}.{k.strip()}"] = _strip(v)
            data[key] = ""
            continue
        val = _strip(val)
        if indented and current_parent:
            data[f"{current_parent}.{key}"] = val
        else:
            if val == "":          # a parent block like `metadata:`
                current_parent = key
                data[key] = ""
            else:
                current_parent = None
                data[key] = val
    return data, body, True


def load_memory(path: Path) -> Memory:
    text = path.read_text(encoding="utf-8", errors="replace")
    data, body, had_fm = parse_frontmatter(text)
    name = data.get("name") or path.stem
    desc = data.get("description") or _first_line(body) or "(no description)"
    mtype = data.get("metadata.type") or data.get("type") or "other"
    status = data.get("metadata.status") or data.get("status") or "active"
    return Memory(
        path=path,
        name=name.strip(),
        description=desc.strip(),
        type=mtype.strip().lower(),
        status=status.strip().lower(),
        body=body,
        mtime=path.stat().st_mtime,
        raw_frontmatter=had_fm,
    )


def _first_line(body: str) -> str:
    for ln in body.splitlines():
        if ln.strip():
            return ln.strip().lstrip("# ").strip()
    return ""


def scan(mem_dir: Path, include_archived: bool = False) -> list[Memory]:
    mems: list[Memory] = []
    for p in sorted(mem_dir.glob("*.md")):
        if p.name == INDEX_NAME:
            continue
        mems.append(load_memory(p))
    if include_archived:
        adir = mem_dir / ARCHIVE_DIR
        if adir.is_dir():
            for p in sorted(adir.glob("*.md")):
                if p.name == ARCHIVE_INDEX:
                    continue
                mems.append(load_memory(p))
    return mems


# ── index generation ──────────────────────────────────────────────────────────
def _hook(desc: str, max_hook: int) -> str:
    one = " ".join(desc.split())          # collapse newlines/space
    if len(one) <= max_hook:
        return one
    return one[: max_hook - 1].rstrip() + "…"


def _index_line(m: Memory, mem_dir: Path, max_hook: int) -> str:
    rel = os.path.relpath(m.path, mem_dir)
    return f"- [{m.name}]({rel}) — {_hook(m.description, max_hook)}"


def render_index(mems: list[Memory], mem_dir: Path, max_hook: int, title: str,
                 archive_count: int = 0) -> str:
    active = [m for m in mems if not m.is_archived]
    by_type: dict[str, list[Memory]] = {}
    for m in active:
        by_type.setdefault(m.type, []).append(m)
    ordered = TYPE_ORDER + sorted(t for t in by_type if t not in TYPE_ORDER)
    lines = [f"# {title}", ""]
    for t in ordered:
        group = by_type.get(t)
        if not group:
            continue
        lines.append(f"## {t.capitalize()}")
        lines.append("")
        for m in sorted(group, key=lambda x: x.name):
            lines.append(_index_line(m, mem_dir, max_hook))
        lines.append("")
    if archive_count:
        rel = f"{ARCHIVE_DIR}/{ARCHIVE_INDEX}"
        lines.append("## Archived (cold — read on demand)")
        lines.append("")
        lines.append(f"Completed/older memories ({archive_count}) are indexed in "
                     f"[{rel}]({rel}). Read it when the active memories above don't cover "
                     f"the question; the topic files live in `{ARCHIVE_DIR}/`.")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_index(mem_dir: Path, max_hook: int, budget: int) -> tuple[Path, int, int]:
    """Regenerate MEMORY.md. Auto-shrinks hooks if over budget; returns (path, bytes, n_entries)."""
    mems = scan(mem_dir)
    n = len([m for m in mems if not m.is_archived])
    adir = mem_dir / ARCHIVE_DIR
    archive_count = len([p for p in adir.glob("*.md") if p.name != ARCHIVE_INDEX]) if adir.is_dir() else 0
    hook = max_hook
    while True:
        content = render_index(mems, mem_dir, hook, "Memory index", archive_count)
        size = len(content.encode("utf-8"))
        if size <= budget or hook <= 24:
            break
        hook -= 8
    out = mem_dir / INDEX_NAME
    out.write_text(content, encoding="utf-8")
    return out, size, n


def write_archive_index(mem_dir: Path, max_hook: int) -> None:
    adir = mem_dir / ARCHIVE_DIR
    if not adir.is_dir():
        return
    mems = [load_memory(p) for p in sorted(adir.glob("*.md")) if p.name != ARCHIVE_INDEX]
    for m in mems:
        m.status = "active"  # render all archived entries in the archive index
    content = render_index(mems, adir, max_hook, "Memory archive (cold storage — not loaded each session)")
    (adir / ARCHIVE_INDEX).write_text(content, encoding="utf-8")


# ── commands ──────────────────────────────────────────────────────────────────
def cmd_analyze(args) -> int:
    mem_dir = Path(args.dir).expanduser()
    mems = scan(mem_dir)
    active = [m for m in mems if not m.is_archived]
    idx = mem_dir / INDEX_NAME
    cur = idx.stat().st_size if idx.exists() else 0
    projected = len(render_index(mems, mem_dir, args.max_hook, "Memory index").encode("utf-8"))

    print(f"memory dir      : {mem_dir}")
    print(f"topic files     : {len(mems)} ({len(active)} active)")
    print(f"index now       : {cur:,} bytes  (budget {args.budget:,})  {_bar(cur, args.budget)}")
    print(f"index compacted : {projected:,} bytes  {_bar(projected, args.budget)}  "
          f"→ {(projected - cur):+,} bytes vs now")
    print()

    no_fm = [m for m in mems if not m.raw_frontmatter]
    if no_fm:
        print("⚠ files without valid frontmatter (excluded from a clean index):")
        for m in no_fm:
            print(f"    {m.path.name}")
        print()

    longest = sorted(active, key=lambda m: len(m.description), reverse=True)[:5]
    print("longest descriptions (compaction targets):")
    for m in longest:
        print(f"    {len(m.description):4d}  {m.name}")
    print()

    stale = stale_candidates(mems, args.older_than)
    if stale:
        print(f"archive candidates (done/stale, --older-than {args.older_than}d):")
        for m, why in stale:
            print(f"    {m.name:40s} [{why}]")
    else:
        print("archive candidates: none")
    return 0


def stale_candidates(mems: list[Memory], older_than_days: int) -> list[tuple[Memory, str]]:
    out = []
    now = datetime.now(timezone.utc).timestamp()
    for m in mems:
        if m.is_archived:
            continue
        reasons = []
        if m.type == "project" and DONE_RE.search(m.description + " " + m.body[:400]):
            reasons.append("project marked done")
        age_days = (now - m.mtime) / 86400
        if older_than_days and age_days > older_than_days:
            reasons.append(f"{int(age_days)}d old")
        if reasons:
            out.append((m, ", ".join(reasons)))
    return out


def cmd_compact(args) -> int:
    mem_dir = Path(args.dir).expanduser()
    before = (mem_dir / INDEX_NAME).stat().st_size if (mem_dir / INDEX_NAME).exists() else 0
    out, size, n = write_index(mem_dir, args.max_hook, args.budget)
    write_archive_index(mem_dir, args.max_hook)   # keep cold index in sync too
    status = "OK" if size <= args.budget else "STILL OVER BUDGET"
    print(f"wrote {out}  ({n} entries, {size:,} bytes, was {before:,})  [{status}]")
    if size > args.budget:
        print("  → still over budget: archive done memories (`archive --auto`) or split into")
        print("    sub-indexes by type (hierarchical index, Phase 2).")
        return 1
    return 0


def cmd_archive(args) -> int:
    mem_dir = Path(args.dir).expanduser()
    mems = scan(mem_dir)
    selected: list[tuple[Memory, str]] = []
    if args.name:
        wanted = set(args.name)
        selected += [(m, "explicit") for m in mems if m.name in wanted or m.path.name in wanted]
    if args.status_archived:
        selected += [(m, "status: archived") for m in mems if m.is_archived]
    if args.auto:
        selected += stale_candidates(mems, args.older_than)
    # de-dupe by path
    seen, uniq = set(), []
    for m, why in selected:
        if m.path not in seen:
            seen.add(m.path)
            uniq.append((m, why))
    if not uniq:
        print("nothing selected. Use --auto, --status-archived, or --name <file>.")
        return 0

    adir = mem_dir / ARCHIVE_DIR
    print(f"{'DRY RUN — would archive' if args.dry_run else 'archiving'} {len(uniq)} file(s):")
    for m, why in uniq:
        print(f"    {m.path.name:45s} [{why}]")
    if args.dry_run:
        print("\n(no changes made; re-run without --dry-run to apply)")
        return 0

    adir.mkdir(exist_ok=True)
    for m, _ in uniq:
        m.path.rename(adir / m.path.name)
    out, size, n = write_index(mem_dir, args.max_hook, args.budget)
    write_archive_index(mem_dir, args.max_hook)
    print(f"\nmoved → {adir}")
    print(f"index regenerated: {n} active entries, {size:,} bytes (budget {args.budget:,})")
    return 0


def cmd_lint(args) -> int:
    mem_dir = Path(args.dir).expanduser()
    idx = mem_dir / INDEX_NAME
    if not idx.exists():
        print(f"FAIL: no {INDEX_NAME} in {mem_dir}")
        return 1
    size = idx.stat().st_size
    if size > args.budget:
        print(f"FAIL: {INDEX_NAME} is {size:,} bytes > budget {args.budget:,}. "
              f"Run `memctl compact` / `memctl archive --auto`.")
        return 1
    print(f"OK: {INDEX_NAME} {size:,} bytes ≤ budget {args.budget:,}")
    return 0


def _bar(value: int, budget: int, width: int = 24) -> str:
    frac = min(value / budget, 1.0) if budget else 0
    filled = int(frac * width)
    over = "!" if value > budget else ""
    return "[" + "#" * filled + "·" * (width - filled) + f"]{over}"


# ── cli ───────────────────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--dir", default=os.environ.get("MEMCTL_DIR", "."),
                        help="memory directory (default: $MEMCTL_DIR or .)")
    common.add_argument("--budget", type=int, default=DEFAULT_BUDGET, help="index byte budget")
    common.add_argument("--max-hook", type=int, default=DEFAULT_MAX_HOOK, help="max hook chars per entry")
    common.add_argument("--older-than", type=int, default=45, help="age (days) flagged as stale")

    p = argparse.ArgumentParser(prog="memctl", description=__doc__, parents=[common],
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("analyze", parents=[common], help="report index size & archive candidates").set_defaults(fn=cmd_analyze)
    sub.add_parser("compact", parents=[common], help="regenerate the index from frontmatter").set_defaults(fn=cmd_compact)
    sub.add_parser("lint", parents=[common], help="fail if index over budget").set_defaults(fn=cmd_lint)

    a = sub.add_parser("archive", parents=[common], help="move done/stale memories to archive/")
    a.add_argument("--auto", action="store_true", help="select done/stale candidates")
    a.add_argument("--status-archived", action="store_true", help="select files with status: archived")
    a.add_argument("--name", nargs="*", default=[], help="explicit file/name(s) to archive")
    a.add_argument("--dry-run", action="store_true", help="preview only")
    a.set_defaults(fn=cmd_archive)
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
