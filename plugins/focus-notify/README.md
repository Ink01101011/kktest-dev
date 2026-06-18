# focus-notify

Focus-aware desktop notifications for **Claude Code** on macOS, Linux & Windows.

It fires a notification **only when your terminal is not the frontmost app** — so a quick interactive turn while you're staring at the terminal stays silent, but a long task you walked away from pings you. Three kinds, each with its own message and sound:

- **finished** → "Task finished" (default sound: `Glass`) — the Stop hook
- **approve** → "Needs your approval" (default sound: `Funk`) — Claude needs permission
- **question** → "Waiting for your input" (default sound: `Submarine`) — Claude is idle waiting on you

`approve` vs `question` is derived from the `Notification` hook's `message` (anything mentioning *permission* → approve, otherwise → question).

## Why focus-aware?

A notification is only useful when you're **not looking**. "Notify on every event" is worse than nothing — during a quick back-and-forth where you're watching the terminal, a banner on every turn is pure noise you'd mute within a day. So focus-notify checks the frontmost app and stays silent while your terminal is up; it only pings you for the long task you walked away from. The three distinct sounds let you tell *why* Claude paused — done, needs approval, or waiting — without looking at the screen.

## Click to focus

Clicking a notification brings the originating terminal back to the front.

- **macOS**: requires `terminal-notifier` — the built-in `osascript` notification can't carry a click action. The target terminal is taken from `$__CFBundleIdentifier` (or mapped from `$TERM_PROGRAM`). Without `terminal-notifier`, notifications still show but aren't clickable, and a **one-time hint** notification reminds you to install it (silence with `FOCUS_NOTIFY_NO_HINT=1`).
- **Linux**: best-effort via `notify-send --action` + `xdotool` (depends on your notification daemon supporting actions).
- **Windows**: not supported — clickable toast activation needs a registered COM activator, which a script can't provide. The three kinds still show.

## Install

```bash
# add the marketplace (this repo)
/plugin marketplace add Ink01101011/kktest-dev

# install the plugin
/plugin install focus-notify@kktest-dev
```

That's it — hooks register automatically. No `settings.json` editing.

> Full guides: [Concepts, usage & every option explained](../../docs/focus-notify/CONCEPTS.md) ·
> [Specification](../../docs/focus-notify/SPEC.md)

## Requirements

- **macOS**: works out of the box via `osascript`. For nicer icons/subtitles **and click-to-focus**, `brew install terminal-notifier` (optional — the script falls back to `osascript`, which notifies but isn't clickable, if it's missing).
- **Linux (X11)**: needs `notify-send` (usually in `libnotify-bin`). Focus detection uses `xdotool` if present; without it, notifications still fire.
- **Windows (Git Bash)**: works out of the box via built-in PowerShell — no install. Shows a native toast (Windows.UI.Notifications) and falls back to a balloon tip if toasts are unavailable. Focus detection asks PowerShell for the frontmost window's **process** name. Run from a Git Bash shell (`uname -s` reports `MINGW*`/`MSYS*`/`CYGWIN*`); WSL is not covered.

> macOS first run: you'll get a permission prompt — choose **Allow**. If nothing shows, check System Settings → Notifications and enable your terminal app (and `terminal-notifier`).

## Configuration

All optional, via environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `FOCUS_NOTIFY_TERMS` | `Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm` | macOS/Linux **app** names treated as "your terminal" (focus = silent) |
| `FOCUS_NOTIFY_TERMS_WIN` | `WindowsTerminal mintty Code cmd powershell pwsh conhost wezterm-gui alacritty` | Windows **process** names treated as "your terminal" (focus = silent) |
| `FOCUS_NOTIFY_FORCE` | `0` | Set `1` to always notify, ignore focus |
| `FOCUS_NOTIFY_USE_OSASCRIPT` | `0` | Set `1` to force the `osascript` backend on macOS even when `terminal-notifier` is installed — use it if `terminal-notifier` banners are suppressed (alert style is **None** in System Settings). Trade-off: no click-to-focus. |
| `FOCUS_NOTIFY_SOUND_FINISHED` | `Glass` | macOS sound for **finished** |
| `FOCUS_NOTIFY_SOUND_APPROVE` | `Funk` | macOS sound for **approve** |
| `FOCUS_NOTIFY_SOUND_QUESTION` | `Submarine` | macOS sound for **question** |
| `FOCUS_NOTIFY_BUNDLE_ID` | `$__CFBundleIdentifier` | macOS bundle id to focus on click (auto-detected; override if detection is wrong) |
| `FOCUS_NOTIFY_NO_HINT` | `0` | Set `1` to silence the one-time "install terminal-notifier" hint (macOS) |

Legacy aliases still honored: `FOCUS_NOTIFY_SOUND_STOP` → finished, `FOCUS_NOTIFY_SOUND_NOTIF` → approve + question.

Example — you use Ghostty only and want a different done sound:

```bash
export FOCUS_NOTIFY_TERMS="Ghostty"
export FOCUS_NOTIFY_SOUND_FINISHED="Hero"
```

The **finished** notification also tries to show the last line of Claude's reply (needs `jq`); falls back to "Task finished".

## How it works

A `Stop` hook and a `Notification` hook each call `scripts/notify.sh`, which asks the OS for the frontmost app and bails out silently if it's your terminal. Hooks are deterministic — they run every time the event fires, unlike prompting Claude to call a tool.

## Usage scenarios

- **You walked away during a long refactor.** Claude finishes → background `Glass` chime, banner shows the last line of its reply (e.g. *"All 14 tests pass."*). Click it → back in the terminal.
- **Claude hits a command that needs approval.** `Funk` chime + the permission text — you know to come click **Allow** from the sound alone.
- **Claude asks a clarifying question and goes idle.** `Submarine` chime + "Waiting for your input."
- **You're actively watching a quick turn.** Silence — focus-notify saw the terminal was frontmost and bailed out.

## Troubleshooting

- **Nothing shows on macOS** → System Settings → Notifications: enable your terminal app (and `terminal-notifier`), and make sure the alert style isn't **None**. If `terminal-notifier`'s banners are blocked specifically, set `FOCUS_NOTIFY_USE_OSASCRIPT=1`.
- **Notifies even when I'm looking at the terminal** → your terminal's app name isn't in `FOCUS_NOTIFY_TERMS` (macOS/Linux) / `FOCUS_NOTIFY_TERMS_WIN` (Windows). Add it. On macOS it must match what **System Events** reports.
- **Never notifies on Linux** → check `notify-send` exists (`which notify-send`; install `libnotify-bin`). Without `xdotool` it can't detect focus, so it still notifies — if it's silent, the issue is `notify-send`.
- **"finished" banner just says "Task finished"** → install `jq`; the last-reply-line enrichment needs it.
- **Click does nothing on macOS** → install `terminal-notifier`; `osascript` notifications can't carry a click action. Wrong window focused → set `FOCUS_NOTIFY_BUNDLE_ID`.
- **WSL doesn't work** → not covered. The Windows path expects native Git Bash (`uname -s` → `MINGW*`/`MSYS*`/`CYGWIN*`).

## FAQ

- **Does it send my transcript anywhere?** No. Everything runs locally. The "finished" enrichment only reads the local transcript file to grab the last reply line.
- **Will it spam me during a chatty session?** No — while the terminal is frontmost it stays silent. That's the whole design.
- **Do I need to edit `settings.json`?** No. Installing registers both hooks automatically.
- **Can I get notifications even when watching the terminal?** Yes — set `FOCUS_NOTIFY_FORCE=1`.

## License

MIT
