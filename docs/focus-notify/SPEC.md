# focus-notify — Specification

Status: 1.1.2 · Date: 2026-06-18 · Author: Ink

## 1. Problem

Claude Code emits `Stop` and `Notification` events. The obvious response — a desktop notification on
every event — produces noise during interactive turns where the user is already watching the
terminal, training the user to mute it and thereby losing the notifications that matter. A useful
notifier must suppress itself when the user is demonstrably present.

## 2. Goals & non-goals

**Goals**
- Notify only when the user's terminal is **not** the frontmost application.
- Distinguish three event kinds — **finished**, **approve**, **question** — each with its own message
  and sound, so the user can identify *why* Claude paused without looking.
- Offer click-to-focus where the platform allows it.
- Run with zero install on each platform's defaults; degrade gracefully when optional helpers
  (`terminal-notifier`, `xdotool`, `jq`) are missing.
- Never fail or block the hook.

**Non-goals**
- No persistent daemon, no network calls, no telemetry.
- No WSL support; Windows means native Git Bash.
- No click-to-focus on Windows (requires a registered COM activator a script can't provide).

## 3. Hook contract

`hooks/hooks.json` registers two hooks, both invoking `${CLAUDE_PLUGIN_ROOT}/scripts/notify.sh`:

| Hook | Command | Event arg |
|---|---|---|
| `Stop` | `notify.sh stop` | `stop` |
| `Notification` | `notify.sh notification` | `notification` |

The script reads the hook payload (JSON) from **stdin**. Fields used:
- `.message` — the `Notification` text, used to classify approve vs question.
- `.transcript_path` — path to the session transcript, used to enrich the **finished** message.

`jq` is used to parse stdin when present; if absent, stdin is ignored and generic messages are used.

## 4. Event → kind classification

```
event = stop          → kind = finished
event = notification  → message contains "permission" (case-insensitive) → kind = approve
                        otherwise                                          → kind = question
```

Per-kind defaults:

| Kind | Default message | Default macOS sound | Sound variable |
|---|---|---|---|
| finished | last reply line, else "Task finished" | `Glass` | `FOCUS_NOTIFY_SOUND_FINISHED` |
| approve | the hook message, else "Needs your approval" | `Funk` | `FOCUS_NOTIFY_SOUND_APPROVE` |
| question | the hook message, else "Waiting for your input" | `Submarine` | `FOCUS_NOTIFY_SOUND_QUESTION` |

Title is always `Claude Code · <basename of cwd>`.

## 5. Focus detection

| Platform | Mechanism | Match against | If unavailable |
|---|---|---|---|
| macOS | `osascript` → System Events frontmost process name | `FOCUS_NOTIFY_TERMS` (exact) | n/a |
| Linux (X11) | `xdotool getactivewindow getwindowname` | `FOCUS_NOTIFY_TERMS` (substring) | assume not focused → notify |
| Windows | PowerShell `GetForegroundWindow` → process name | `FOCUS_NOTIFY_TERMS_WIN` (substring, case-insensitive) | assume not focused → notify |

`FOCUS_NOTIFY_FORCE=1` short-circuits detection so every event notifies.

## 6. Notification delivery

| Platform | Primary | Fallback | Click-to-focus |
|---|---|---|---|
| macOS | `terminal-notifier -activate <bundle-id>` | `osascript display notification` | yes (primary only) |
| Linux | `notify-send --action` + `xdotool windowactivate` | `notify-send` plain | best-effort |
| Windows | `Windows.UI.Notifications` toast | `NotifyIcon` balloon tip | no |

macOS bundle id resolution: `FOCUS_NOTIFY_BUNDLE_ID` → `$__CFBundleIdentifier` → `$TERM_PROGRAM`
mapping. On Windows, title/message are passed via `FN_TITLE`/`FN_MSG` env vars to prevent transcript
text from breaking out of the PowerShell `-Command` string.

## 7. Configuration reference

| Variable | Default | Type | Purpose |
|---|---|---|---|
| `FOCUS_NOTIFY_TERMS` | `Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm` | space-separated app names | macOS/Linux terminals treated as "focused = silent" |
| `FOCUS_NOTIFY_TERMS_WIN` | `WindowsTerminal mintty Code cmd powershell pwsh conhost wezterm-gui alacritty` | space-separated process names | Windows terminals treated as "focused = silent" |
| `FOCUS_NOTIFY_FORCE` | `0` | `0`/`1` | Always notify, ignore focus |
| `FOCUS_NOTIFY_USE_OSASCRIPT` | `0` | `0`/`1` | Force osascript backend on macOS (no click-to-focus) |
| `FOCUS_NOTIFY_BUNDLE_ID` | auto | string | macOS bundle id to focus on click |
| `FOCUS_NOTIFY_NO_HINT` | `0` | `0`/`1` | Silence the one-time terminal-notifier hint |
| `FOCUS_NOTIFY_SOUND_FINISHED` | `Glass` | macOS sound name | Sound for finished |
| `FOCUS_NOTIFY_SOUND_APPROVE` | `Funk` | macOS sound name | Sound for approve |
| `FOCUS_NOTIFY_SOUND_QUESTION` | `Submarine` | macOS sound name | Sound for question |

Legacy aliases (fallbacks only): `FOCUS_NOTIFY_SOUND_STOP` → finished;
`FOCUS_NOTIFY_SOUND_NOTIF` → approve + question.

## 8. Exit behavior & failure modes

- Script runs under `set -euo pipefail`; every external command is guarded with `|| true`.
- Always terminates with `exit 0`; a notification failure never breaks the hook or Claude Code.
- Terminal focused → `exit 0` before sending (silent).
- Missing optional helper → degrade: no `jq` → generic text; no `terminal-notifier` → osascript +
  one-time hint; no `xdotool` (Linux) → notify anyway, no click-to-focus.

## 9. Security & privacy

- No network access; entirely local.
- The only file read is the local transcript (`.transcript_path`), and only its last reply line, for
  the finished banner.
- Untrusted text (transcript reply, hook message) is passed to backends via env vars / escaped
  arguments to avoid shell or command-string injection.

## 10. Compatibility

- macOS: `osascript` always present; `terminal-notifier` and `jq` optional.
- Linux: X11 with `notify-send`; `xdotool` and `jq` optional. Wayland focus detection is not
  implemented (falls back to always-notify).
- Windows: native Git Bash only (`MINGW*`/`MSYS*`/`CYGWIN*`); WSL unsupported.
