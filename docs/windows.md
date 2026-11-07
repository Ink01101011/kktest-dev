# Windows support and verification

kktestdev-pack (`/kk-onboard`, `/kk-update`) and the `kktest-dev` CLI run on native Windows. No real Windows
machine is part of the test loop; Windows is verified on GitHub's `windows-latest` runners (CI matrix, Node 22
and latest). This page says what that covers, what it does not, and the 5-minute check a person with a Windows
machine can run to close the gap (issue #20).

## What CI checks on Windows

| Check | Where |
|---|---|
| Both test suites and the Python tests, as on macOS/Linux | `.github/workflows/ci.yml`, all OSes |
| `inventory.mjs` run on an empty fake HOME/USERPROFILE/APPDATA prints valid JSON | `ci.yml` step "Inventory on a fake HOME", all OSes |
| `inventory.mjs` CLI end to end on a fake HOME, with a fake `claude.cmd` shim on PATH (the real npm install is a `.cmd` shim too): servers registered the way each item's `windows` step registers them (`cmd /c ...`) are detected; a `projects[...]` key written with forward slashes and the other drive-letter case still matches the cwd (G3-3); no secret is printed | `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs` |
| `CLAUDE_CONFIG_DIR` under `%APPDATA%` is read instead of `~/.claude.json` (G3-20); a tool that sits only in the current folder is not counted as installed (G3-14a: `where`/cmd.exe would have found it) | same file |
| Every `kind: "mcp"` item in `pack.json` has a `windows` variant: its POSIX steps with `cmd /c` put in front of the launched command, same server name, no doubled `cmd /c`; project-scope prose steps say how to wrap the command in `.mcp.json` | same file (reads `pack.json` at run time, so new items are checked too) |
| Live: each user-scope MCP item is started exactly as its `windows` step registers it (`cmd /c npx ...`, `cmd /c bantamkit-mcp`, after running its `npm i -g` step) and answers an MCP `initialize`; a bare `npx` cannot be spawned without a shell on Windows (why `cmd /c` is needed) | same file, `KK_MCP_SMOKE=1`; `ci.yml` step "Windows MCP smoke", windows-latest only |
| Directory-link safety with junctions (no admin needed): project scope refuses a linked config folder and writes nothing through it; `checkTarget` never treats a linked folder as a project target or replaces it | `tools/test/windows.test.mjs` |
| Process-tree kill on timeout (`taskkill /T /F`), a junctioned `docs/` folder not followed, a package copy inside the project untrusted with the cwd given in another path form | `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs` |

The Windows-shaped tests run on every OS (a junction is a plain directory symlink elsewhere; `claude.cmd`
becomes a `sh` script), so the logic is exercised on every push, not only on the Windows runner.

## POSIX-only test skips

Each test below is skipped on Windows. `tools/test/windows.test.mjs` fails when a test with an OS-dependent
skip is added without a row here, or a row outlives its test.

| File | Test | Why it cannot run as written on Windows | What covers that path on Windows |
|---|---|---|---|
| `tools/test/safety.test.mjs` | `G1-01/G2-03: a 0600 config stays 0600 after --apply; a new config is created 0600` | Windows has no POSIX mode bits; `chmod` only toggles the read-only attribute. | Not applicable. Files under `%USERPROFILE%` inherit the profile ACL (the user, SYSTEM, Administrators), so other users cannot read them; the write path keeps modes best-effort and does not loosen that ACL (it writes a temp file in the same folder and renames it). |
| `tools/test/safety.test.mjs` | `G1-01: the kept mode is not narrowed by a strict umask` | No umask on Windows. | Not applicable (see above). |
| `tools/test/safety.test.mjs` | `G1-03/G2-03: a user config symlinked into HOME (dotfiles) keeps its link; the real file is updated` | File symlinks need admin rights or Developer Mode, so an ordinary profile rarely has them. | Same code path (`lstat` + `realpath` before every write) when they exist. Directory links: junction tests in `tools/test/windows.test.mjs`. File-symlink cases on Windows: residual (below). |
| `tools/test/safety.test.mjs` | `user config symlinked outside its folder is refused (dry run too), with the snippet to paste` | File symlink (as above). | Same `checkTarget` rule; its directory-link half is pinned with junctions in `tools/test/windows.test.mjs` (a link leaving the root is refused). |
| `tools/test/safety.test.mjs` | `G2-02: project scope refuses a symlinked config or folder; nothing is read into the repo (PoC p1)` | Two of its four cases plant file symlinks. | The folder cases (`.codex`, `.agents/skills`, `.cursor` as junctions) run on Windows: `G2-02 (all OSes; win32 = junction)` in `tools/test/windows.test.mjs`. |
| `tools/test/safety.test.mjs` | `G2-01: the temp file is opened exclusively, so a planted symlink at its name is never followed` | Planting needs a file symlink. | The protection is the exclusive create flag (`wx`, `CREATE_NEW` on Windows), which refuses any existing name, link or not; it is OS-independent. |
| `tools/test/safety.test.mjs` | `G2-01/G1-09: backups are created exclusively with unique names, even with the same timestamp` | Planting needs a file symlink. | Same exclusive create flag as above. |
| `tools/test/safety.test.mjs` | `G2-01: PoC p2 shape: predictable-name links in a project never reach a file outside it` | Planting needs file symlinks. | Exclusive create + `checkTarget` containment (junction cases in `tools/test/windows.test.mjs`). |
| `tools/test/safety.test.mjs` | `G2-07: a FIFO or a symlink inside an existing skill folder never hangs or crashes the dry run` | Windows has no FIFOs in the file system (named pipes live in `\\.\pipe\`, never inside a folder), so the hang cannot happen. | Not applicable for FIFOs. Junctions inside a skill folder are reported as links by `Dirent`, the same branch the symlink half of this test pins. |
| `tools/test/safety.test.mjs` | `checkTarget: containment and link rules` | Uses relative directory symlinks. | Same rules with junctions: `checkTarget (all OSes; win32 = junction)` in `tools/test/windows.test.mjs`. |
| `tools/test/providers-verified.test.mjs` | `publish.yml: the tag check passes for v<version>, fails for other tags and for a real publish off a tag` | It runs the workflow's `bash` step; the publish workflow itself runs on `ubuntu-latest` only. | Not applicable: the step never runs on Windows. |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/inventory.test.mjs` | `G1-1/G2-1: CLI end to end with a fake claude on PATH prints no canary` | Its fake `claude` is a `sh` script with a POSIX `PATH`. | `#20/G3-3` in `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs` runs the CLI with a `claude.cmd` shim and a Windows `PATH`/`PATHEXT`/`ComSpec`, and asserts no secret is printed. The full canary list stays POSIX-only (the redaction code is the same on every OS and is unit-tested everywhere). |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O2-3: a timed-out --help child is killed with its whole process tree` | Signals and process groups are POSIX. | `O2-3 (all OSes; win32 = taskkill /T)` in `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs` (the same scenario; on Windows the kill is `taskkill /T /F`). |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O2-1 BLOCKER: a package planted through a project .mcp.json or projects[cwd] is never executed or read` | The fixture uses POSIX relative paths and `PATH`. | The trust decision is path containment on canonical paths (`realpathSync.native`, case-insensitive on win32): pinned on Windows by `O2-1 (all OSes, host path rules)` in `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs`. The "never executed" half on Windows is residual. |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O2-1: a copy whose real path is inside the current project is untrusted even from a user config` | Hardcodes `platform: 'linux'`. | `O2-1 (all OSes, host path rules)` in `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs`, with the cwd in the other drive-letter case. |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O2-2: a symlinked bin that leaves the package is not executed` | File symlink. | The bin is resolved with `realpath` and must stay inside the package; same code on Windows. Residual: no file-symlink run on Windows. |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O2-8/C5: a docs/ symlink is not followed; unreadable docs mark the item docsIncomplete` | Directory symlink and `chmod 000`. | Link half: `O2-8 (all OSes; win32 = directory junction)` in `plugins/kktestdev-pack/skills/kk-onboard/scripts/windows.test.mjs`. Unreadable half: Windows needs an ACL edit (`icacls /deny`), not done in tests; the read error path is the same `catch`. |
| `plugins/kktestdev-pack/skills/kk-onboard/scripts/options.test.mjs` | `O5 N1: a repo .npmrc cannot steer npm to a planted npx copy, also from a subdirectory of the repo` | Fixture uses POSIX `PATH` and paths. | The guard is the same project-root containment as O2-1 (covered above); npm probes run with `cwd` = HOME on every OS. Residual: no Windows run of the `.npmrc` scenario itself. |

## Residual for the owner: 5-minute check on a real Windows machine

CI cannot run the real Claude Code on Windows, so "registered through `cmd /c` and Claude Code says
Connected" still needs a person. Native Windows (PowerShell or cmd.exe, not WSL), Node 22+, Claude Code
installed:

1. `npm i -g bantamkit-mcp@latest`
2. `claude mcp add --scope user bantamkit -- cmd /c bantamkit-mcp`
3. `claude mcp add --scope user playwright -- cmd /c npx -y @playwright/mcp@latest --headless`
4. `claude mcp list`: both lines end in `✓ Connected`. (Skip steps 1-3 for a server that is already registered.)
5. From any project folder: `node <path to kktestdev-pack>\skills\kk-onboard\scripts\inventory.mjs --pretty`.
   `bantamkit` and `playwright` read `present`; the output is one JSON document with no stack trace.
6. G3-3: open `%USERPROFILE%\.claude.json` and look only at the key names under `projects` (never paste
   values): note whether they use `C:/...` or `C:\...`. Either form is matched; report which one Claude Code
   writes so the test fixture can use it.
7. Optional, WSL (G3-14b): inside WSL run the same `inventory.mjs`; it notes that Windows-side configs were
   not read.
8. Tick the boxes in issue #20 with what you saw. `claude mcp remove --scope user <name>` undoes steps 2-3.
