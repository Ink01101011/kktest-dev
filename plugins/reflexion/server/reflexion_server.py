#!/usr/bin/env python3
"""reflexion MCP server — zero-dependency, stdlib only.

Exposes the reflexionctl engine (recall / reflect / library / compress) as MCP tools over the stdio
transport (newline-delimited JSON-RPC 2.0). It shells out to ``reflexionctl.py`` so the CLI, slash
commands, and MCP tools all share exactly one implementation.

Config (env):
  REFLEXIONCTL_PATH   path to reflexionctl.py       (set by the plugin's .mcp.json)
  MEMCTL_DIR           default memory-keeper store   (optional; tools may pass `dir` instead)
  MEMCTL_PATH          path to memory-keeper's memctl.py (optional; reflexionctl auto-detects it)

No third-party packages required — runs on any python3.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

SERVER_NAME = "reflexion"
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL = "2024-11-05"

REFLEXIONCTL_PATH = os.environ.get("REFLEXIONCTL_PATH") or str(
    Path(__file__).resolve().parent.parent / "scripts" / "reflexionctl.py"
)
DEFAULT_DIR = os.environ.get("MEMCTL_DIR") or ""

TOOLS = [
    {
        "name": "reflexion_recall",
        "description": "Surface lessons matching a task, ranked by keyword overlap against the "
                       "error/success library. Read-only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory-keeper store dir (defaults to MEMCTL_DIR env)."},
                "query": {"type": "string", "description": "Free-text description of the task at hand."},
                "top_k": {"type": "integer", "description": "Max lessons to return (default 5)."},
                "loop": {"type": "string", "enum": ["reflexion", "error", "success"],
                        "description": "Filter by which memory loop produced the lesson."},
            },
            "required": ["query"],
        },
    },
    {
        "name": "reflexion_reflect",
        "description": "Write a new feedback lesson (what/why/how) to the memory-keeper store. "
                       "De-dupes against existing lessons unless force=true.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory-keeper store dir (defaults to MEMCTL_DIR env)."},
                "what": {"type": "string", "description": "What happened."},
                "why": {"type": "string", "description": "Why it failed or worked."},
                "how": {"type": "string", "description": "How to apply next time."},
                "name": {"type": "string", "description": "Stable id (default: derived from `what`)."},
                "description": {"type": "string", "description": "One-line index hook."},
                "loop": {"type": "string", "enum": ["reflexion", "error", "success"],
                        "description": "Which memory loop this is (default reflexion)."},
                "related": {"type": "array", "items": {"type": "string"}, "description": "Related lesson names to link."},
                "force": {"type": "boolean", "description": "Write even if a duplicate is detected."},
            },
            "required": ["what", "why", "how"],
        },
    },
    {
        "name": "reflexion_library",
        "description": "Browse the error/success library (or all feedback lessons). Read-only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory-keeper store dir (defaults to MEMCTL_DIR env)."},
                "loop": {"type": "string", "enum": ["reflexion", "error", "success"],
                        "description": "Filter by which memory loop produced the lesson."},
            },
        },
    },
    {
        "name": "reflexion_compress",
        "description": "Merge N recurring lessons into one higher-level pattern lesson and archive the "
                       "originals. Defaults to a DRY RUN — pass dry_run=false to actually apply.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dir": {"type": "string", "description": "Memory-keeper store dir (defaults to MEMCTL_DIR env)."},
                "names": {"type": "array", "items": {"type": "string"}, "description": "Names of lessons to merge (>= 2)."},
                "pattern": {"type": "string", "description": "The higher-level pattern extracted."},
                "how": {"type": "string", "description": "How to apply the pattern."},
                "name": {"type": "string", "description": "Stable id for the merged pattern."},
                "description": {"type": "string", "description": "One-line index hook."},
                "dry_run": {"type": "boolean", "description": "Preview only. Default true (safe)."},
                "force": {"type": "boolean", "description": "Overwrite an existing pattern file."},
            },
            "required": ["names", "pattern", "how"],
        },
    },
]


# ── reflexionctl invocation ───────────────────────────────────────────────────
def _resolve_dir(args: dict) -> str:
    d = args.get("dir") or DEFAULT_DIR
    if not d:
        raise ValueError("no memory-keeper store dir: pass `dir` or set MEMCTL_DIR in the plugin config")
    return os.path.expanduser(d)


def _run(cmd: str, args: dict) -> tuple[str, bool]:
    argv = [sys.executable, REFLEXIONCTL_PATH, cmd, "--dir", _resolve_dir(args)]

    if cmd == "recall":
        argv.append(str(args["query"]))
        if "top_k" in args:
            argv += ["--top-k", str(int(args["top_k"]))]
        if args.get("loop"):
            argv += ["--loop", args["loop"]]
    elif cmd == "reflect":
        argv += ["--what", str(args["what"]), "--why", str(args["why"]), "--how", str(args["how"])]
        if args.get("name"):
            argv += ["--name", args["name"]]
        if args.get("description"):
            argv += ["--description", args["description"]]
        if args.get("loop"):
            argv += ["--loop", args["loop"]]
        if args.get("related"):
            argv += ["--related", *[str(r) for r in args["related"]]]
        if args.get("force"):
            argv.append("--force")
    elif cmd == "library":
        if args.get("loop"):
            argv += ["--loop", args["loop"]]
    elif cmd == "compress":
        argv += ["--names", *[str(n) for n in args["names"]]]
        argv += ["--pattern", str(args["pattern"]), "--how", str(args["how"])]
        if args.get("name"):
            argv += ["--name", args["name"]]
        if args.get("description"):
            argv += ["--description", args["description"]]
        if args.get("force"):
            argv.append("--force")
        # default to a dry run unless explicitly disabled
        if args.get("dry_run", True):
            argv.append("--dry-run")

    proc = subprocess.run(argv, capture_output=True, text=True)
    out = (proc.stdout or "") + (proc.stderr or "")
    out = out.strip() or "(no output)"
    if proc.returncode not in (0, 1):  # 1 is a meaningful dedup/skip signal, not a crash
        return f"reflexionctl exited {proc.returncode}\n{out}", True
    return out, False


TOOL_FN = {
    "reflexion_recall": lambda a: _run("recall", a),
    "reflexion_reflect": lambda a: _run("reflect", a),
    "reflexion_library": lambda a: _run("library", a),
    "reflexion_compress": lambda a: _run("compress", a),
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
