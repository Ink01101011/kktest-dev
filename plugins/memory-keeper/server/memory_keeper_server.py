#!/usr/bin/env python3
"""memory-keeper MCP server — zero-dependency, stdlib only.

Exposes the memctl engine (analyze / compact / archive / lint) as MCP tools over the
stdio transport (newline-delimited JSON-RPC 2.0). It shells out to ``memctl.py`` so the
CLI, slash commands, and MCP tools all share exactly one implementation.

Config (env):
  MEMCTL_PATH   path to memctl.py            (set by the plugin's .mcp.json)
  MEMCTL_DIR    default memory dir            (optional; tools may pass `dir` instead)

No third-party packages required — runs on any python3.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SERVER_NAME = "memory-keeper"
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL = "2024-11-05"

MEMCTL_PATH = os.environ.get("MEMCTL_PATH") or str(Path(__file__).resolve().parent.parent / "scripts" / "memctl.py")
DEFAULT_DIR = os.environ.get("MEMCTL_DIR") or ""

TOOLS = [
    {
        "name": "memory_analyze",
        "description": "Report the memory index size vs budget, the projected size after compaction, "
                       "files missing frontmatter, and done/stale archive candidates. Read-only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory directory (defaults to MEMCTL_DIR env)."},
                "budget": {"type": "integer", "description": "Index byte budget (default 24000)."},
                "older_than": {"type": "integer", "description": "Age in days flagged as stale (default 45)."},
            },
        },
    },
    {
        "name": "memory_compact",
        "description": "Regenerate MEMORY.md from each topic file's frontmatter: terse, grouped by type, "
                       "bounded to the budget (hooks auto-shrink), with a pointer to the cold archive. "
                       "Also refreshes the archive index. Writes MEMORY.md only; never edits topic bodies.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory directory (defaults to MEMCTL_DIR env)."},
                "budget": {"type": "integer", "description": "Index byte budget (default 24000)."},
                "max_hook": {"type": "integer", "description": "Max hook chars per entry (default 100)."},
            },
        },
    },
    {
        "name": "memory_archive",
        "description": "Move done/stale memories into archive/ (cold storage) and regenerate both indexes. "
                       "Defaults to a DRY RUN — pass dry_run=false to actually move files. Select with "
                       "auto (done/stale heuristic), status_archived (frontmatter status: archived), or name.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory directory (defaults to MEMCTL_DIR env)."},
                "auto": {"type": "boolean", "description": "Select done/stale candidates."},
                "status_archived": {"type": "boolean", "description": "Select files with frontmatter status: archived."},
                "name": {"type": "array", "items": {"type": "string"}, "description": "Explicit file/name(s) to archive."},
                "dry_run": {"type": "boolean", "description": "Preview only. Default true (safe)."},
                "older_than": {"type": "integer", "description": "Age in days flagged as stale (default 45)."},
                "budget": {"type": "integer", "description": "Index byte budget (default 24000)."},
            },
        },
    },
    {
        "name": "memory_lint",
        "description": "Check that MEMORY.md is within the byte budget. Returns OK or a FAIL message. "
                       "Mirrors the pre-commit/CI gate.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory directory (defaults to MEMCTL_DIR env)."},
                "budget": {"type": "integer", "description": "Index byte budget (default 24000)."},
            },
        },
    },
]


# ── memctl invocation ─────────────────────────────────────────────────────────
def _resolve_dir(args: dict) -> str:
    d = args.get("dir") or DEFAULT_DIR
    if not d:
        raise ValueError("no memory directory: pass `dir` or set MEMCTL_DIR in the plugin config")
    return os.path.expanduser(d)


def _common_flags(args: dict) -> list[str]:
    flags: list[str] = []
    if "budget" in args:
        flags += ["--budget", str(int(args["budget"]))]
    if "max_hook" in args:
        flags += ["--max-hook", str(int(args["max_hook"]))]
    if "older_than" in args:
        flags += ["--older-than", str(int(args["older_than"]))]
    return flags


def _run(cmd: str, args: dict) -> tuple[str, bool]:
    argv = [sys.executable, MEMCTL_PATH, cmd, "--dir", _resolve_dir(args)] + _common_flags(args)
    if cmd == "archive":
        if args.get("auto"):
            argv.append("--auto")
        if args.get("status_archived"):
            argv.append("--status-archived")
        if args.get("name"):
            argv += ["--name", *[str(n) for n in args["name"]]]
        # default to a dry run unless explicitly disabled
        if args.get("dry_run", True):
            argv.append("--dry-run")
    proc = subprocess.run(argv, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    out = out.strip() or "(no output)"
    if proc.returncode not in (0, 1):  # 1 is a meaningful lint/over-budget signal, not a crash
        return f"memctl exited {proc.returncode}\n{out}", True
    return out, False


TOOL_FN = {
    "memory_analyze": lambda a: _run("analyze", a),
    "memory_compact": lambda a: _run("compact", a),
    "memory_archive": lambda a: _run("archive", a),
    "memory_lint": lambda a: _run("lint", a),
}


# ── JSON-RPC plumbing ─────────────────────────────────────────────────────────
def _send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _result(req_id, result) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "result": result})


def _error(req_id, code: int, message: str) -> None:
    _send({"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}})


def handle(msg: dict) -> None:
    method = msg.get("method")
    req_id = msg.get("id")
    if method == "initialize":
        proto = (msg.get("params") or {}).get("protocolVersion") or DEFAULT_PROTOCOL
        _result(req_id, {
            "protocolVersion": proto,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
    elif method in ("notifications/initialized", "initialized"):
        return  # notification, no reply
    elif method == "ping":
        _result(req_id, {})
    elif method == "tools/list":
        _result(req_id, {"tools": TOOLS})
    elif method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        args = params.get("arguments") or {}
        fn = TOOL_FN.get(name)
        if fn is None:
            _error(req_id, -32602, f"unknown tool: {name}")
            return
        try:
            text, is_error = fn(args)
        except Exception as exc:  # surface as a tool error, not a protocol crash
            text, is_error = f"error: {exc}", True
        _result(req_id, {"content": [{"type": "text", "text": text}], "isError": is_error})
    elif req_id is not None:
        _error(req_id, -32601, f"method not found: {method}")


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        try:
            handle(msg)
        except Exception as exc:  # never die on a single bad message
            if isinstance(msg, dict) and msg.get("id") is not None:
                _error(msg["id"], -32603, f"internal error: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
