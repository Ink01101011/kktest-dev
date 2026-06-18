#!/usr/bin/env bash
#
# focus-notify — desktop notification for Claude Code, but only when your
# terminal is NOT the frontmost app.
#
# Usage (called by hooks): notify.sh <event>
#   event = "stop"          -> task finished                     (kind: finished)
#   event = "notification"  -> Claude needs permission / input.  The Notification hook's
#                              .message decides the kind: "permission" -> approve,
#                              otherwise -> question.
#
# Notification kinds: finished, approve, question — each with its own message + sound.
#
# Config via env vars (override in your shell rc or plugin settings):
#   FOCUS_NOTIFY_TERMS  : space-separated app names treated as "your terminal" (mac/Linux)
#                         default: "Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm"
#   FOCUS_NOTIFY_TERMS_WIN : space-separated process names treated as "your terminal" (Windows)
#                         default: "WindowsTerminal mintty Code cmd powershell pwsh conhost wezterm-gui alacritty"
#   FOCUS_NOTIFY_FORCE  : set to "1" to always notify, ignoring focus
#   FOCUS_NOTIFY_USE_OSASCRIPT : set to "1" to force the osascript backend on macOS even
#                         when terminal-notifier is installed. Use this if terminal-notifier's
#                         banners are suppressed (e.g. its alert style is "None" in
#                         System Settings > Notifications). Trade-off: no click-to-focus.
#   FOCUS_NOTIFY_SOUND_FINISHED / _APPROVE / _QUESTION : per-kind sounds (macOS)
#       (legacy FOCUS_NOTIFY_SOUND_STOP -> finished, FOCUS_NOTIFY_SOUND_NOTIF ->
#        approve+question are still honored as fallbacks)
#   FOCUS_NOTIFY_BUNDLE_ID : macOS bundle id of your terminal, used for click-to-focus
#                            (default: $__CFBundleIdentifier, else mapped from $TERM_PROGRAM)
#   FOCUS_NOTIFY_NO_HINT : set to "1" to silence the one-time "install terminal-notifier"
#                          hint shown on macOS when terminal-notifier is missing
#
# Click-to-focus: clicking the notification brings your terminal to the front.
#   macOS  -> requires terminal-notifier (osascript can't make clickable notifications).
#   Linux  -> best-effort via notify-send --action + xdotool.
#   Windows-> not supported (toast activation needs a registered COM activator).
#
# Platforms: macOS (osascript/terminal-notifier), Linux (notify-send),
#            Windows via Git Bash (PowerShell toast, balloon-tip fallback).

set -euo pipefail

EVENT="${1:-stop}"

# --- read hook stdin (transcript_path etc.); tolerate missing jq -------------
INPUT="$(cat 2>/dev/null || true)"

# project / workspace name for the title
DIR_NAME="$(basename "$(pwd)")"

# --- classify the event into a notification KIND -----------------------------
# finished | approve | question
HOOK_MSG=""
if [ "$EVENT" = "notification" ]; then
  # The Notification hook fires for permission prompts AND idle "waiting for input".
  # Inspect .message to tell them apart; default to "question" when unknown.
  if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
    HOOK_MSG="$(printf '%s' "$INPUT" | jq -r '.message // empty' 2>/dev/null || true)"
  fi
  case "$(printf '%s' "$HOOK_MSG" | tr '[:upper:]' '[:lower:]')" in
    *permission*) KIND="approve" ;;
    *)            KIND="question" ;;
  esac
else
  KIND="finished"
fi

# --- decide message + sound per kind -----------------------------------------
TITLE="Claude Code · ${DIR_NAME}"
case "$KIND" in
  approve)
    MESSAGE="${HOOK_MSG:-Needs your approval}"
    MAC_SOUND="${FOCUS_NOTIFY_SOUND_APPROVE:-${FOCUS_NOTIFY_SOUND_NOTIF:-Funk}}"
    ;;
  question)
    MESSAGE="${HOOK_MSG:-Waiting for your input}"
    MAC_SOUND="${FOCUS_NOTIFY_SOUND_QUESTION:-${FOCUS_NOTIFY_SOUND_NOTIF:-Submarine}}"
    ;;
  *)  # finished
    MESSAGE="Task finished"
    MAC_SOUND="${FOCUS_NOTIFY_SOUND_FINISHED:-${FOCUS_NOTIFY_SOUND_STOP:-Glass}}"
    # Try to enrich "Task finished" with the last assistant line from transcript.
    if command -v jq >/dev/null 2>&1 && [ -n "$INPUT" ]; then
      TP="$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
      if [ -n "$TP" ] && [ -f "$TP" ]; then
        LAST="$(tail -n 20 "$TP" \
          | jq -r 'select(.message.role=="assistant") | .message.content[]? | select(.type=="text") | .text' 2>/dev/null \
          | tail -n 1 | tr '\n' ' ' | cut -c1-80 || true)"
        [ -n "${LAST:-}" ] && MESSAGE="$LAST"
      fi
    fi
    ;;
esac

OS="$(uname -s)"

case "$OS" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  *)                    IS_WINDOWS=0 ;;
esac

# macOS bundle id of the terminal Claude runs in — used so clicking the notification
# brings that terminal back to the front. $__CFBundleIdentifier is the reliable source;
# fall back to a $TERM_PROGRAM mapping if it's not set.
BUNDLE_ID="${FOCUS_NOTIFY_BUNDLE_ID:-${__CFBundleIdentifier:-}}"
if [ -z "$BUNDLE_ID" ]; then
  case "${TERM_PROGRAM:-}" in
    Apple_Terminal) BUNDLE_ID="com.apple.Terminal" ;;
    iTerm.app)      BUNDLE_ID="com.googlecode.iterm2" ;;
    vscode)         BUNDLE_ID="com.microsoft.VSCode" ;;
    ghostty)        BUNDLE_ID="com.mitchellh.ghostty" ;;
    WarpTerminal)   BUNDLE_ID="dev.warp.Warp-Stable" ;;
    WezTerm)        BUNDLE_ID="com.github.wez.wezterm" ;;
    Hyper)          BUNDLE_ID="co.zeit.hyper" ;;
  esac
fi

# PowerShell snippet: print the foreground window's process name (or nothing).
read -r -d '' PS_FOREGROUND_PROC <<'PS' || true
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FN_Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
$h = [FN_Fg]::GetForegroundWindow()
$procId = 0
[void][FN_Fg]::GetWindowThreadProcessId($h, [ref]$procId)
try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { }
PS

# --- focus check -------------------------------------------------------------
is_terminal_focused() {
  [ "${FOCUS_NOTIFY_FORCE:-0}" = "1" ] && return 1  # forced -> treat as "not focused"

  local terms="${FOCUS_NOTIFY_TERMS:-Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm}"

  if [ "$IS_WINDOWS" = "1" ]; then
    # Windows reports *process* names (not app names), so use a separate default list.
    local win_terms="${FOCUS_NOTIFY_TERMS_WIN:-WindowsTerminal mintty Code cmd powershell pwsh conhost wezterm-gui alacritty}"
    local front
    front="$(powershell.exe -NoProfile -NonInteractive -Command "$PS_FOREGROUND_PROC" 2>/dev/null | tr -d '\r' | tail -n 1 || true)"
    [ -z "$front" ] && return 1  # couldn't read foreground -> treat as "not focused"
    # case-insensitive substring match
    local front_lc t_lc
    front_lc="$(printf '%s' "$front" | tr '[:upper:]' '[:lower:]')"
    for t in $win_terms; do
      t_lc="$(printf '%s' "$t" | tr '[:upper:]' '[:lower:]')"
      case "$front_lc" in *"$t_lc"*) return 0 ;; esac
    done
    return 1
  fi

  if [ "$OS" = "Darwin" ]; then
    local front
    front="$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true' 2>/dev/null || true)"
    for t in $terms; do
      [ "$front" = "$t" ] && return 0
    done
    return 1
  fi

  # Linux (X11): try xdotool, else assume not focused so notif still fires.
  if command -v xdotool >/dev/null 2>&1; then
    local wname
    wname="$(xdotool getactivewindow getwindowname 2>/dev/null || true)"
    for t in $terms; do
      case "$wname" in *"$t"*) return 0 ;; esac
    done
  fi
  return 1
}

# --- send -------------------------------------------------------------------
# One-time hint when terminal-notifier is missing (it's needed for click-to-focus).
# Shown as its own notification (hook stderr isn't surfaced to the user). Nags once;
# delete the stamp to see it again, or set FOCUS_NOTIFY_NO_HINT=1 to silence it.
warn_no_terminal_notifier() {
  [ "${FOCUS_NOTIFY_NO_HINT:-0}" = "1" ] && return 0
  printf '%s\n' "focus-notify: terminal-notifier not found — click-to-focus disabled. Install with: brew install terminal-notifier" >&2
  local stamp="${XDG_CACHE_HOME:-$HOME/.cache}/focus-notify/tn-hint-shown"
  [ -f "$stamp" ] && return 0
  mkdir -p "$(dirname "$stamp")" 2>/dev/null || true
  osascript -e 'display notification "Install terminal-notifier for click-to-focus: brew install terminal-notifier" with title "focus-notify"' >/dev/null 2>&1 || true
  : > "$stamp" 2>/dev/null || true
}

send_mac() {
  if [ "${FOCUS_NOTIFY_USE_OSASCRIPT:-0}" != "1" ] && command -v terminal-notifier >/dev/null 2>&1; then
    # -activate makes a click bring the originating terminal to the front.
    local args=(-title "$TITLE" -message "$MESSAGE" -sound "$MAC_SOUND")
    [ -n "$BUNDLE_ID" ] && args+=(-activate "$BUNDLE_ID")
    terminal-notifier "${args[@]}" >/dev/null 2>&1 || true
  else
    # osascript: notifies but cannot attach a clickable activation action.
    local m="${MESSAGE//\"/\\\"}" tt="${TITLE//\"/\\\"}"
    osascript -e "display notification \"$m\" with title \"$tt\" sound name \"$MAC_SOUND\"" >/dev/null 2>&1 || true
    # Nag about the missing tool only when it's genuinely absent — not when the user
    # deliberately forced osascript via FOCUS_NOTIFY_USE_OSASCRIPT=1.
    [ "${FOCUS_NOTIFY_USE_OSASCRIPT:-0}" = "1" ] || warn_no_terminal_notifier
  fi
}

send_linux() {
  command -v notify-send >/dev/null 2>&1 || return 0

  # Best-effort click-to-focus: if notify-send supports --action and xdotool is present,
  # find the terminal window and raise it when the notification is clicked. Runs detached
  # so the hook doesn't block waiting for the click.
  if command -v xdotool >/dev/null 2>&1 && notify-send --help 2>&1 | grep -q -- '--action'; then
    local terms="${FOCUS_NOTIFY_TERMS:-Ghostty iTerm2 Terminal Code Warp kitty Alacritty WezTerm}"
    local wid=""
    for t in $terms; do
      wid="$(xdotool search --name "$t" 2>/dev/null | tail -n 1 || true)"
      [ -n "$wid" ] && break
    done
    ( a="$(notify-send --action=default=Focus --wait "$TITLE" "$MESSAGE" 2>/dev/null || true)"
      [ "$a" = "default" ] && [ -n "$wid" ] && xdotool windowactivate "$wid" >/dev/null 2>&1
    ) >/dev/null 2>&1 &
    return 0
  fi

  notify-send "$TITLE" "$MESSAGE" || true
}

send_windows() {
  # Title/message are passed via env vars (FN_TITLE/FN_MSG) so arbitrary transcript
  # text can't break out of the PowerShell -Command string.
  local ps
  ps='
$ErrorActionPreference = "Stop"
$title = $env:FN_TITLE
$msg   = $env:FN_MSG
try {
  [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
  $aumid = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
  $tmpl  = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
             [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $texts = $tmpl.GetElementsByTagName("text")
  $texts.Item(0).AppendChild($tmpl.CreateTextNode($title)) | Out-Null
  $texts.Item(1).AppendChild($tmpl.CreateTextNode($msg))   | Out-Null
  $toast = [Windows.UI.Notifications.ToastNotification]::new($tmpl)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)
} catch {
  # Fallback: balloon tip via NotifyIcon (always available, no AUMID needed).
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $ni = New-Object System.Windows.Forms.NotifyIcon
    $ni.Icon = [System.Drawing.SystemIcons]::Information
    $ni.Visible = $true
    $ni.ShowBalloonTip(5000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Info)
    Start-Sleep -Milliseconds 6000
    $ni.Dispose()
  } catch { }
}
'
  FN_TITLE="$TITLE" FN_MSG="$MESSAGE" \
    powershell.exe -NoProfile -NonInteractive -Command "$ps" >/dev/null 2>&1 || true
}

if is_terminal_focused; then
  exit 0  # you're looking at the terminal — stay quiet
fi

case "$OS" in
  Darwin)               send_mac ;;
  Linux)                send_linux ;;
  MINGW*|MSYS*|CYGWIN*) send_windows ;;
esac

exit 0
