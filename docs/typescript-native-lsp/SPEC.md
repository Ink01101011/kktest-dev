# typescript-native-lsp — Specification

Formal reference, checked against the code on 2026-11-18. For the idea see [CONCEPTS.md](./CONCEPTS.md).
Paths below are under `plugins/typescript-native-lsp/`.

## 1. Components

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | manifest; `lspServers` points at `./.lsp.json` |
| `.lsp.json` | one LSP server, `typescript` |

No skills, commands, hooks or MCP server. No code of its own.

## 2. The server

| Field | Value |
|---|---|
| name | `typescript` (Claude Code shows it as `plugin:typescript-native-lsp:typescript`) |
| `command` | `tsc` (resolved on PATH) |
| `args` | `--lsp --stdio` |
| transport | stdio |

`extensionToLanguage`:

| Extension | Language id |
|---|---|
| `.ts`, `.mts`, `.cts` | `typescript` |
| `.tsx` | `typescriptreact` |
| `.js`, `.mjs`, `.cjs` | `javascript` |
| `.jsx` | `javascriptreact` |

## 3. Requirements

- `tsc` on PATH from TypeScript 7.0 or newer (`npm i -g typescript@latest`). The npm package needs
  Node 16.20+.
- Nothing from the project: no `node_modules/typescript`, no `tsserver`.

## 4. Failure modes

| Condition | What happens |
|---|---|
| no `tsc` on PATH | the server is not started; `/kk-onboard` lists `tsc` under `missingBins` |
| `tsc` is TypeScript 6 or older | `--lsp` is an unknown option; Claude Code reports that the server couldn't start |
| `typescript-lsp` (official) also enabled | two servers for the same extensions; `/kk-onboard` reports `overlap:lsp-ts` |

## 5. Verified behaviour

Checked on 2026-11-18 with TypeScript 7.0.2 on macOS (arm64): in a repository with no
`node_modules/typescript`, `tsc --lsp --stdio` answers `initialize` (server info `typescript-go`
7.0.2) and returns document symbols for an `.mjs` file. In the same repository
`typescript-language-server` 6.1.0 fails `initialize` with
`Could not find a valid TypeScript installation`.
