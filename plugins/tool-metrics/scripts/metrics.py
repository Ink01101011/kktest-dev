#!/usr/bin/env python3
"""tool-metrics aggregator: count Claude Code tool usage.

Sources: session transcripts under ~/.claude/projects (authoritative while
present) + events.jsonl written by the PostToolUse hook (durable copy, used
in Task 4 for sessions whose transcripts were cleaned up). Stdlib only.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Bumped whenever the cached event shape changes, so stale entries written by
# an older version miss the stamp check and get re-parsed instead of served.
CACHE_VERSION = 2

# Orphaned cache entries younger than this are left alone, so a concurrent
# writer is never raced. Orphans only appear via transcript deletion, which is
# not time-critical to clean up.
GC_GRACE_HOURS = 24


def projects_dir():
    return Path(os.environ.get("CLAUDE_PROJECTS_DIR")
                or Path.home() / ".claude" / "projects")


def metrics_dir():
    return Path(os.environ.get("TOOL_METRICS_DIR")
                or Path.home() / ".claude" / "tool-metrics")


def server_of(tool):
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        if len(parts) >= 3:
            return parts[1]
    return "builtin"


def detail_of(tool, tool_input):
    if not isinstance(tool_input, dict):
        return ""
    if tool == "Skill":
        return str(tool_input.get("skill", ""))
    if tool == "Agent":
        return str(tool_input.get("subagent_type", "") or "general-purpose")
    return ""


def project_of(path, root=None):
    """Project name for a transcript = first path component under the root.

    Transcripts nest arbitrarily deep (<project>/<session>/subagents/*.jsonl),
    so the parent directory is not the project for anything but top-level
    session files.
    """
    if root is not None:
        try:
            return path.relative_to(root).parts[0]
        except ValueError:
            pass
    return path.parent.name


def extract_transcript_events(path, root=None):
    """Parse one transcript file -> (session_id, [events], skipped_lines)."""
    events, session, skipped = [], None, 0
    project = project_of(path, root)
    with open(path, errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            session = obj.get("sessionId") or session
            msg = obj.get("message")
            if not isinstance(msg, dict):
                continue
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool = block.get("name") or "?"
                    events.append({
                        "ts": obj.get("timestamp", ""),
                        "session": session or path.stem,
                        "project": project,
                        "tool": tool,
                        "server": server_of(tool),
                        "detail": detail_of(tool, block.get("input")),
                        # Kept so collect() can drop replayed calls; a resumed
                        # session repeats earlier tool_use blocks verbatim.
                        "id": block.get("id") or "",
                    })
    return session or path.stem, events, skipped


def cache_key(path):
    """Cache filename stem for a transcript path.

    GC relies on this being a pure function of the path: liveness of an entry
    is decided by filename alone, with no need to read it back.
    """
    return hashlib.sha1(str(path).encode()).hexdigest()


def cached_transcript_events(path, root=None):
    """extract_transcript_events() with a (mtime, size, version)-keyed cache."""
    cache_dir = metrics_dir() / "cache"
    cache_file = cache_dir / (cache_key(path) + ".json")
    st = path.stat()
    stamp = [st.st_mtime, st.st_size, CACHE_VERSION]
    if cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text())
            # A tampered/foreign cache may hold valid JSON that is not an
            # object; treat anything but a dict as a miss and re-parse.
            if isinstance(cached, dict) and cached.get("stamp") == stamp:
                return cached["session"], cached["events"], cached.get("skipped", 0)
        except (json.JSONDecodeError, KeyError, OSError):
            pass
    session, events, skipped = extract_transcript_events(path, root)
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = cache_file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"stamp": stamp, "session": session,
                               "events": events, "skipped": skipped}))
    tmp.replace(cache_file)
    return session, events, skipped


def live_events(transcript_sessions):
    """Rows from events.jsonl for sessions with no transcript on disk."""
    events, skipped = [], 0
    events_file = metrics_dir() / "events.jsonl"
    if not events_file.exists():
        return events, skipped
    with open(events_file, errors="replace") as fh:
        for line in fh:
            if not line.strip():
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                skipped += 1
                continue
            if ev.get("session") not in transcript_sessions:
                events.append(ev)
    return events, skipped


def gc_cache(live_keys, grace_hours=GC_GRACE_HOURS, dry_run=False):
    """Prune cache entries whose source transcript no longer exists.

    Policy is transcript-existence, not age or count. A cache entry is a pure
    function of one transcript path, so once that path is gone the entry can
    never be read again -- that makes "orphaned" an exact criterion with no
    risk of evicting an entry still in use. Age-based eviction would drop
    entries for old-but-live transcripts that every run still reads, and
    count-based eviction would need LRU data the cache does not keep.

    Growth does not create orphans: a transcript that grows keeps its path and
    so overwrites its own entry. Orphans come only from deleted or renamed
    transcripts. Returns (removed, bytes, kept).
    """
    cache_dir = metrics_dir() / "cache"
    if not cache_dir.is_dir():
        return 0, 0, 0
    cutoff = time.time() - grace_hours * 3600
    removed = freed = kept = 0
    for entry in cache_dir.glob("*.json"):
        try:
            st = entry.stat()
            if entry.stem in live_keys or st.st_mtime > cutoff:
                kept += 1
                continue
            if not dry_run:
                entry.unlink()
            removed += 1
            freed += st.st_size
        except OSError:
            # Vanished under us or unreadable: nothing to reclaim, not fatal.
            kept += 1
    return removed, freed, kept


def collect():
    """Gather events from transcripts + events.jsonl -> (events, skipped).

    Dedupe rule: a session with a transcript on disk is counted from the
    transcript only; events.jsonl covers sessions whose transcripts were
    cleaned up by retention.

    Transcripts are found recursively: besides <project>/<session>.jsonl,
    subagent runs live at <project>/<session>/subagents/*.jsonl and deeper.
    Nested files carry the parent sessionId, so session dedupe still holds.
    """
    all_events, skipped = [], 0
    transcript_sessions, live_keys = set(), set()
    root = projects_dir()
    if root.is_dir():
        for path in sorted(root.rglob("*.jsonl")):
            live_keys.add(cache_key(path))
            try:
                session, events, s = cached_transcript_events(path, root)
            except OSError:
                # Unreadable or deleted between glob and read: skip, but count.
                skipped += 1
                continue
            transcript_sessions.add(session)
            all_events.extend(events)
            skipped += s
        # The live key set is already built, so pruning is close to free.
        # Guarded on root.is_dir() so a missing or misconfigured projects
        # root can never make every entry look orphaned.
        gc_cache(live_keys)
    all_events = dedupe_by_id(all_events)
    extra, s = live_events(transcript_sessions)
    all_events.extend(extra)
    skipped += s
    return all_events, skipped


def dedupe_by_id(events):
    """Drop repeated tool_use ids, keeping the first occurrence.

    Resuming a session forks a new transcript that replays the earlier one's
    tool_use blocks verbatim, so the same call appears in two files; a resume
    within one file repeats them inline. Both inflate counts. Dedupe is global
    rather than per-file because the cross-file case is the larger one.
    Blocks with no id are never deduped -- they are genuinely distinct.
    """
    seen, out = set(), []
    for ev in events:
        key = ev.get("id")
        if key:
            if key in seen:
                continue
            seen.add(key)
        out.append(ev)
    return out


def parse_since(value):
    """'7d' / '12h' / '2w' relative, or 'YYYY-MM-DD' local midnight."""
    m = re.fullmatch(r"(\d+)([dhw])", value)
    if m:
        n, unit = int(m.group(1)), m.group(2)
        delta = {"d": timedelta(days=n), "h": timedelta(hours=n),
                 "w": timedelta(weeks=n)}[unit]
        return datetime.now(timezone.utc) - delta
    return datetime.fromisoformat(value).astimezone()


def event_time(ev):
    ts = str(ev.get("ts", ""))
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None
    # Offset-naive timestamps are assumed UTC so they stay comparable.
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t


def group_key(ev, group):
    """Grouping key for an event, or None to exclude it from this grouping."""
    if group == "server":
        return ev.get("server", "builtin")
    if group == "project":
        return ev.get("project", "?")
    if group == "day":
        t = event_time(ev)
        return t.astimezone().strftime("%Y-%m-%d") if t else "unknown"
    if group == "skill":
        return ev.get("detail") or None if ev.get("tool") == "Skill" else None
    if group == "agent":
        return ev.get("detail") or None if ev.get("tool") == "Agent" else None
    return ev.get("tool", "?")


def render_table(counter, total, sessions, skipped, group):
    lines = [f"Tool usage — {total} calls, {sessions} sessions (group: {group})", ""]
    width = max((len(k) for k in counter), default=4)
    for name, n in counter.most_common():
        lines.append(f"{name:<{width}}  {n:>6}")
    if skipped:
        lines.append("")
        lines.append(f"({skipped} lines skipped)")
    return "\n".join(lines)


def run_gc_command(args):
    """`gc` subcommand: prune orphaned cache entries and report."""
    root = projects_dir()
    if not root.is_dir():
        # Refuse rather than treat every entry as orphaned.
        report = {"removed": 0, "bytes": 0, "kept": 0, "dry_run": args.dry_run,
                  "skipped_no_projects_dir": True}
    else:
        live_keys = {cache_key(p) for p in root.rglob("*.jsonl")}
        removed, freed, kept = gc_cache(live_keys, args.grace_hours,
                                        args.dry_run)
        report = {"removed": removed, "bytes": freed, "kept": kept,
                  "dry_run": args.dry_run, "skipped_no_projects_dir": False}
    if args.json:
        print(json.dumps(report, indent=2))
    elif report["skipped_no_projects_dir"]:
        print(f"projects dir {root} not found — cache left untouched")
    else:
        verb = "would remove" if args.dry_run else "removed"
        print(f"{verb} {report['removed']} orphaned cache entries "
              f"({report['bytes'] / 1e6:.1f} MB), kept {report['kept']}")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="metrics.py",
                                 description="Claude Code tool usage stats")
    sub = ap.add_subparsers(dest="cmd")
    st = sub.add_parser("stats", help="aggregate usage counts")
    st.add_argument("--since", help="7d / 12h / 2w / YYYY-MM-DD")
    st.add_argument("--project", help="substring filter on project name")
    st.add_argument("--group", default="tool",
                    choices=["tool", "server", "project", "day", "skill", "agent"])
    st.add_argument("--json", action="store_true")
    gc = sub.add_parser("gc", help="prune cache entries with no transcript")
    gc.add_argument("--dry-run", action="store_true",
                    help="report what would be removed, delete nothing")
    gc.add_argument("--grace-hours", type=float, default=GC_GRACE_HOURS,
                    help=f"keep orphans younger than this (default {GC_GRACE_HOURS})")
    gc.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    if args.cmd == "gc":
        return run_gc_command(args)
    if args.cmd != "stats":
        ap.print_help()
        return 1

    events, skipped = collect()
    if args.since:
        try:
            cutoff = parse_since(args.since)
        except ValueError:
            ap.error(f"invalid --since value: {args.since!r}")
        events = [e for e in events
                  if (t := event_time(e)) is not None and t >= cutoff]
    if args.project:
        needle = args.project.lower()
        events = [e for e in events if needle in str(e.get("project", "")).lower()]

    counter = Counter()
    sessions = set()
    for ev in events:
        key = group_key(ev, args.group)
        if key is None:
            continue
        sessions.add(ev.get("session"))
        counter[key] += 1

    total = sum(counter.values())
    if args.json:
        print(json.dumps({"group": args.group, "total": total,
                          "sessions": len(sessions), "skipped": skipped,
                          "counts": dict(counter.most_common())}, indent=2))
    else:
        print(render_table(counter, total, len(sessions), skipped, args.group))
    return 0


if __name__ == "__main__":
    sys.exit(main())
