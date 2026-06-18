#!/usr/bin/env python3
"""Auto-compaction hook for memory-keeper.

Runs on PostToolUse(Write|Edit) and SessionEnd. Whenever a memory file is written, it regenerates
that store's MEMORY.md from frontmatter (a `compact`) — so the index can never drift or bloat, with
zero per-project configuration. Compaction only (safe, idempotent); archiving stays manual/reviewed.

Reads the hook payload from stdin. Always exits 0 — a maintenance hook must never block the agent.
Zero-config: it discovers the store from the written file's path, or from MEMCTL_DIR / ./memory /
the standard ~/.claude/projects/<cwd>/memory location.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

MEMCTL = os.environ.get("MEMCTL_PATH") or str(Path(__file__).resolve().parents[2] / "scripts" / "memctl.py")
BUDGET = os.environ.get("MEMCTL_BUDGET", "")


def _is_store(d: Path) -> bool:
    """A directory is a managed store if it already has an index or is conventionally named `memory`,
    and it contains at least one topic file. Conservative on purpose — never create an index in a
    random folder just because someone edited a .md there."""
    if not d.is_dir():
        return False
    if not ((d / "MEMORY.md").exists() or d.name == "memory"):
        return False
    return any(p.name != "MEMORY.md" for p in d.glob("*.md"))


def _store_from_file(f: str) -> Path | None:
    p = Path(f)
    if p.suffix != ".md":
        return None
    parent = p.parent
    if parent.name == "archive":          # editing an archived file → the store is its parent
        parent = parent.parent
    return parent if _is_store(parent) else None


def _discovered_stores(cwd: str) -> list[Path]:
    cands: list[Path] = []
    if os.environ.get("MEMCTL_DIR"):
        cands.append(Path(os.environ["MEMCTL_DIR"]).expanduser())
    base = Path(cwd) if cwd else Path.cwd()
    cands += [base / "memory", base]
    encoded = str(base).replace("/", "-")
    cands.append(Path.home() / ".claude" / "projects" / encoded / "memory")
    return [d for d in cands if _is_store(d)]


def _compact(d: Path) -> None:
    argv = [sys.executable, MEMCTL, "compact", "--dir", str(d)]
    if BUDGET:
        argv += ["--budget", BUDGET]
    try:
        subprocess.run(argv, capture_output=True, text=True, timeout=15)
    except Exception:
        pass  # never block the agent on a maintenance failure


def main() -> int:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        payload = {}

    cwd = payload.get("cwd") or os.getcwd()
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")

    targets: list[Path] = []
    if file_path:
        s = _store_from_file(file_path)
        if s is not None:
            targets.append(s)
    else:
        targets = _discovered_stores(cwd)

    seen = set()
    for d in targets:
        rp = d.resolve()
        if rp not in seen:
            seen.add(rp)
            _compact(d)
    return 0


if __name__ == "__main__":
    sys.exit(main())
