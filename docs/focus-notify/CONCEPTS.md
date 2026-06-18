# focus-notify — Concepts, Usage & Installation

A complete guide: what problem focus-notify solves, how it works, how to install it, how to use it,
and every option explained.

---

## 1. The concept

### The problem with "notify on every event"

Claude Code can fire a hook every time it stops or needs your attention. The naive thing to do is
pop a desktop notification on each one. In practice that is *worse than nothing*: during a quick
back-and-forth where you are already watching the terminal, a banner on every turn is pure noise —
the kind of thing you mute within a day, which then also kills the notification you actually wanted.

### The key idea: a notification is only useful when you are not looking

focus-notify checks the **frontmost application** before it notifies. If your terminal is the app
in front, you are clearly watching — so it stays silent. If the frontmost app is your browser, your
editor, Slack, or anything else, you have walked away — so it pings you. The result: silence during
interactive turns, a ping for the long task you left running.

### Three kinds, so you know *why* Claude paused without looking

Claude pauses for three different reasons, and focus-notify gives each its own message and sound so
you can tell them apart by ear:

| Kind | Meaning | Trigger | Default macOS sound |
|---|---|---|---|
| **finished** | The task is done | `Stop` hook | `Glass` |
| **approve** | Claude needs permission to run something | `Notification` hook, message mentions *permission* | `Funk` |
| **question** | Claude is idle, waiting on your input | `Notification` hook, any other message | `Submarine` |

`approve` vs `question` is derived from the `Notification` hook payload's `message` field: anything
containing the word *permission* (case-insensitive) is classified as **approve**, everything else as
**question**.

### Click to focus

On macOS and Linux, clicking the notification brings the originating terminal back to the front, so
you go from "heard the chime" to "back in the session" in one click. (Windows shows the notification
but cannot make it clickable — see the platform matrix below.)

---

## 2. How it works

### Architecture

Two hooks, one script. The plugin registers a `Stop` hook and a `Notification` hook in
`hooks/hooks.json`; both call `scripts/notify.sh` with an event argument:

```
Stop hook         ──▶  notify.sh stop          ──▶  kind = finished
Notification hook ──▶  notify.sh notification  ──▶  kind = approve | question
```

Hooks are **deterministic** — they run every time the event fires, unlike asking the model to
remember to call a tool. The script is plain `bash`, so there is nothing to install beyond what
your OS already ships (plus optional helpers for nicer behavior).

### Step by step, every time an event fires

1. **Read the hook payload from stdin.** Claude Code passes JSON (transcript path, the notification
   message, etc.). The script tolerates missing `jq` — it just degrades to generic messages.
2. **Classify the event into a kind.** `stop` → **finished**. `notification` → inspect `.message`;
   *permission* → **approve**, otherwise → **question**.
3. **Build the title, message, and sound** for that kind. The title is `Claude Code · <dir>` where
   `<dir>` is the current project folder name. For **finished**, the script also tries to enrich the
   message with the last line of Claude's reply pulled from the transcript (needs `jq`).
4. **Check focus.** Ask the OS for the frontmost app/window and compare it against your terminal
   list. If your terminal is in front, the script **exits silently** (unless you forced notifications
   on — see `FOCUS_NOTIFY_FORCE`).
5. **Send** via the platform's backend (details below).

### Focus detection, per platform

- **macOS** — `osascript` asks System Events for the name of the frontmost process and matches it
  against `FOCUS_NOTIFY_TERMS`.
- **Linux (X11)** — uses `xdotool getactivewindow getwindowname` if available, matched against
  `FOCUS_NOTIFY_TERMS`. Without `xdotool`, focus can't be read, so it assumes "not focused" and the
  notification still fires (fail-loud rather than silent).
- **Windows (Git Bash)** — asks PowerShell for the foreground window's **process** name and matches
  it against `FOCUS_NOTIFY_TERMS_WIN`. Note this is a *process* list (e.g. `WindowsTerminal`,
  `powershell`), not an app display name, which is why it has its own variable.

### Notification delivery, per platform

- **macOS** — prefers `terminal-notifier` (supports `-activate <bundle-id>` for click-to-focus). If
  it is not installed, falls back to `osascript`, which shows the banner but can't carry a click
  action; a one-time hint reminds you to install `terminal-notifier`.
- **Linux** — `notify-send`. If `notify-send` supports `--action` and `xdotool` is present, it adds a
  best-effort click-to-focus that raises the terminal window; otherwise it shows a plain banner.
- **Windows** — a native toast via `Windows.UI.Notifications`, falling back to a `NotifyIcon` balloon
  tip if toasts aren't available. Title/message are passed via environment variables so arbitrary
  transcript text can't break out of the PowerShell command string.

### Exit behavior

The script is wrapped in `set -euo pipefail` but every external call is guarded with `|| true`, and
it always `exit 0` after sending. A notification problem will never fail your hook or interrupt
Claude Code.

---

## 3. Installation

```bash
# add the marketplace (this repo)
/plugin marketplace add Ink01101011/kktest-dev

# install the plugin
/plugin install focus-notify@kktest-dev
```

That's it — both hooks register automatically. No `settings.json` editing.

### Requirements

- **macOS** — works out of the box via `osascript`. For nicer banners **and click-to-focus**, run
  `brew install terminal-notifier` (optional; the script falls back to `osascript` if it's missing).
- **Linux (X11)** — needs `notify-send` (usually in `libnotify-bin`). Focus detection and
  click-to-focus use `xdotool` if present; without it, notifications still fire.
- **Windows (Git Bash)** — works out of the box via built-in PowerShell. Run from a Git Bash shell
  (`uname -s` reports `MINGW*`/`MSYS*`/`CYGWIN*`); **WSL is not covered**.
- **Optional everywhere** — `jq`, used to read the hook payload and to enrich the **finished** banner
  with the last reply line. Without it you still get notifications, just generic text.

> macOS first run: you'll get a permission prompt — choose **Allow**. If nothing shows, check
> System Settings → Notifications and enable your terminal app (and `terminal-notifier`).

---

## 4. Usage

Once installed there is nothing to run — the hooks do the work. Typical moments:

- **You walked away during a long refactor.** Claude finishes → background `Glass` chime, the banner
  shows the last line of its reply (e.g. *"All 14 tests pass."*). Click it → back in the terminal.
- **Claude hits a command that needs approval.** `Funk` chime + the permission text — you know to
  come click **Allow** from the sound alone.
- **Claude asks a clarifying question and goes idle.** `Submarine` chime + "Waiting for your input."
- **You're actively watching a quick turn.** Silence — focus-notify saw the terminal was frontmost
  and bailed out.

To **test it quickly**, switch focus to another app (e.g. your browser) and trigger a stop, or set
`FOCUS_NOTIFY_FORCE=1` temporarily to make it notify regardless of focus.

---

## 5. Options — every variable explained

All configuration is via environment variables, all optional. Set them in your shell rc
(`~/.zshrc`, `~/.bashrc`) or your plugin settings so they apply to every session.

### Focus / terminal identification

**`FOCUS_NOTIFY_TERMS`**
Space-separated **app names** (macOS/Linux) treated as "your terminal." When one of these is the
frontmost app, the script stays silent.
Default: `Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm`.
On macOS the name must match what **System Events** reports for the process; on Linux it is matched
as a substring of the active window name. Add your terminal here if you keep getting notified while
looking at it.

**`FOCUS_NOTIFY_TERMS_WIN`**
Space-separated **process names** (Windows) treated as "your terminal." Windows reports process
names, not display names, so this is separate from `FOCUS_NOTIFY_TERMS`.
Default: `WindowsTerminal mintty Code cmd powershell pwsh conhost wezterm-gui alacritty`. Matching is
case-insensitive substring.

**`FOCUS_NOTIFY_FORCE`**
Set to `1` to **always notify**, ignoring focus entirely. Useful for testing, or if you simply want
a chime on every event. Default `0`.

### Backend selection (macOS)

**`FOCUS_NOTIFY_USE_OSASCRIPT`**
Set to `1` to force the `osascript` backend on macOS even when `terminal-notifier` is installed. Use
this if `terminal-notifier`'s banners are being suppressed (e.g. its alert style is **None** in
System Settings → Notifications). Trade-off: `osascript` notifications can't be clicked to focus.
Default `0`. (When this is `1`, the "install terminal-notifier" hint is also suppressed, since you've
opted out deliberately.)

**`FOCUS_NOTIFY_BUNDLE_ID`**
macOS bundle id of the terminal to bring forward when the notification is clicked. Auto-detected from
`$__CFBundleIdentifier`, falling back to a mapping from `$TERM_PROGRAM` (Apple Terminal, iTerm,
VS Code, Ghostty, Warp, WezTerm, Hyper). Override it only if auto-detection picks the wrong window.

**`FOCUS_NOTIFY_NO_HINT`**
Set to `1` to silence the one-time notification that reminds you to `brew install terminal-notifier`
for click-to-focus. Default `0`. (The hint nags once; the stamp lives at
`${XDG_CACHE_HOME:-$HOME/.cache}/focus-notify/tn-hint-shown` — delete it to see the hint again.)

### Per-kind sounds (macOS)

**`FOCUS_NOTIFY_SOUND_FINISHED`** — sound for **finished**. Default `Glass`.
**`FOCUS_NOTIFY_SOUND_APPROVE`** — sound for **approve**. Default `Funk`.
**`FOCUS_NOTIFY_SOUND_QUESTION`** — sound for **question**. Default `Submarine`.

Values are macOS system sound names (those in `/System/Library/Sounds`, e.g. `Glass`, `Funk`,
`Submarine`, `Hero`, `Ping`, `Pop`).

**Legacy aliases** (still honored as fallbacks): `FOCUS_NOTIFY_SOUND_STOP` → finished;
`FOCUS_NOTIFY_SOUND_NOTIF` → approve + question. A kind-specific variable always wins over its
legacy alias.

### Example

You use Ghostty only, want a different "done" sound, and run a notification daemon that hides
`terminal-notifier`:

```bash
export FOCUS_NOTIFY_TERMS="Ghostty"
export FOCUS_NOTIFY_SOUND_FINISHED="Hero"
export FOCUS_NOTIFY_USE_OSASCRIPT="1"   # only if terminal-notifier banners are suppressed
```

---

## 6. Platform support matrix

| Capability | macOS | Linux (X11) | Windows (Git Bash) |
|---|---|---|---|
| Notifications | ✅ `osascript` / `terminal-notifier` | ✅ `notify-send` | ✅ toast / balloon fallback |
| Focus detection | ✅ System Events | ✅ with `xdotool` (else always notifies) | ✅ PowerShell foreground process |
| Three kinds + sounds | ✅ | ✅ (sound support depends on daemon) | ✅ (no per-kind sound) |
| Click-to-focus | ✅ with `terminal-notifier` | ⚠️ best-effort (`notify-send --action` + `xdotool`) | ❌ needs a registered COM activator |
| Last-reply enrichment | ✅ with `jq` | ✅ with `jq` | ✅ with `jq` |

---

## 7. Troubleshooting

- **Nothing shows on macOS** → System Settings → Notifications: enable your terminal app (and
  `terminal-notifier`), and make sure the alert style isn't **None**. If `terminal-notifier`'s
  banners are blocked specifically, set `FOCUS_NOTIFY_USE_OSASCRIPT=1`.
- **Notifies even when I'm looking at the terminal** → your terminal's app name isn't in
  `FOCUS_NOTIFY_TERMS` (macOS/Linux) / `FOCUS_NOTIFY_TERMS_WIN` (Windows). Add it. On macOS it must
  match what **System Events** reports.
- **Never notifies on Linux** → check `notify-send` exists (`which notify-send`; install
  `libnotify-bin`). Without `xdotool` it can't detect focus, so it still notifies — if it's silent,
  the problem is `notify-send`.
- **"finished" banner just says "Task finished"** → install `jq`; the last-reply-line enrichment
  needs it.
- **Click does nothing on macOS** → install `terminal-notifier`; `osascript` notifications can't
  carry a click action. Wrong window focused → set `FOCUS_NOTIFY_BUNDLE_ID`.
- **WSL doesn't work** → not covered. The Windows path expects native Git Bash (`uname -s` →
  `MINGW*`/`MSYS*`/`CYGWIN*`).

---

## 8. FAQ

- **Does it send my transcript anywhere?** No. Everything runs locally. The "finished" enrichment
  only reads the local transcript file to grab the last reply line.
- **Will it spam me during a chatty session?** No — while the terminal is frontmost it stays silent.
  That's the whole design.
- **Do I need to edit `settings.json`?** No. Installing registers both hooks automatically.
- **Can I get notifications even when watching the terminal?** Yes — set `FOCUS_NOTIFY_FORCE=1`.

---

See also: [SPEC.md](./SPEC.md) for the formal hook contract, classification rules, and configuration
reference.
