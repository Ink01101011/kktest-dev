---
name: secret-hygiene
description: "Use this skill whenever secrets (API keys, tokens, passwords, connection strings) are involved — adding one, logging near one, committing config, or reacting to a leak.
  Triggers include: 'API key', 'token', '.env', 'secret', 'credentials', 'connection string', adding a provider integration, writing logging around an HTTP client, committing a config file, or discovering a key in a log / commit / screenshot.
  Also use when scaffolding a new repo — wire .env.example, .gitignore, and CI secret scanning from day one.
  Do NOT use for non-sensitive config (feature flags, public URLs, log levels)."
version: "0.1.0"
updated: "2026-06-19"
---

# Secret Hygiene

## Overview

Secrets leak through three boring channels: **committed config**, **logs**, and **chat/screenshots**.
The damage is real money and real breaches. This skill is the discipline for keeping secrets out of
those channels, and for reacting correctly when one does leak — **rotation first, cleanup second**.

A leaked key is compromised the moment it's exposed. Scrubbing the git history does not un-leak it —
**rotate, then clean.**

## When to Use

- ✅ Adding any provider/API integration (new key enters the project).
- ✅ Writing logging around HTTP clients or request/response handling.
- ✅ Committing or reviewing any config file.
- ✅ Scaffolding a new repo (set up the guardrails day one).
- ✅ The moment you spot a secret in a log, commit, PR, or screenshot.
- ❌ Non-sensitive config (public endpoints, feature flags).

## Process / Steps

### Step 1 — Keep secrets out of the repo

- ☐ Secrets come from environment / a secret manager — never hardcoded.
- ☐ Ship a `.env.example` with **keys but no values** so others know what's needed.
- ☐ `.gitignore` covers `.env`, `.env.*` (but not `.env.example`), and any local creds files.
- ☐ `git grep -nEi '(api[_-]?key|secret|token|password)\s*[=:]' -- . ':!*.example'` before committing config.

### Step 2 — Keep secrets out of logs

- ☐ Never log full request headers (Authorization / X-API-Key) or query strings that carry a key.
- ☐ Redact when you must log: show last 4 chars only (`sk-...a1b2`).
- ☐ Watch error paths — exception dumps and retry logs often leak the URL with the key in it.
- ☐ Be careful with API keys passed as **query params** (some providers do this) — they land in access logs and referrers.

### Step 3 — Set up CI guardrails (day one)

- ☐ Add a secret scanner to CI (`gitleaks`, `trufflehog`, or GitHub/GitLab native scanning).
- ☐ Fail the PR on a detected secret, don't just warn.
- ☐ Enable push protection if the host offers it (block the push before it lands).

### Step 4 — React to a leak (rotation-first)

When a secret is exposed (log, commit, screenshot, anywhere):

1. ☐ **Rotate / revoke the key immediately** at the provider. This is the only step that actually stops the bleeding.
2. ☐ Replace it in the secret store / env; redeploy.
3. ☐ Then scrub: remove from logs; if committed, purge history (`git filter-repo`) and force-push, and assume it's already harvested.
4. ☐ Register a follow-up if rotation must wait for a window (e.g. "rotate paper key before going live") — track it via [[proactive-task-reminders]].
5. ☐ Note the incident so the same channel gets a guard (a log redaction, a scanner rule).

## Rules & Constraints

- ALWAYS: secrets via env / secret manager; `.env.example` has names only.
- ALWAYS: `.gitignore` the real `.env` before the first commit.
- ALWAYS: redact secrets in logs (last 4 chars max).
- ALWAYS: rotate first when a key leaks — history cleanup is secondary.
- ALWAYS: wire a CI secret scanner from day one.
- NEVER: hardcode a key, even "temporarily" or in a test.
- NEVER: log full auth headers or key-bearing URLs.
- NEVER: assume a scrubbed commit means the key is safe — it's already compromised.

## Examples

**Scenario:** Alpaca paper-trading keys appear in a debug log.
**Wrong:** Delete the log line, move on.
**Right:** Rotate the paper keys now (or register "rotate before live broker" if paper-only risk is low — [[proactive-task-reminders]]), add redaction to the HTTP client logger, and add a scanner rule so it can't recur.

**Scenario:** New repo scaffold.
**Right:** Day one — `.env.example` (names only), `.gitignore` covering `.env*`, and a `gitleaks` CI job that fails the PR. Now no one can commit a key by accident.

**Scenario:** Provider requires the key as a query param (`?apikey=...`).
**Right:** Keep it out of logs — strip query strings before logging the URL; prefer header auth if the provider also supports it; verify the access-log layer isn't capturing the full URL.

## Changelog

- 0.1.0 (2026-06-19) — initial version; repo/log/CI guardrails + rotation-first leak response. Source: "Expensive lessons" session (leaked-key register).
