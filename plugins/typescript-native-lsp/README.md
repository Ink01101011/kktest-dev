# typescript-native-lsp

> TypeScript/JavaScript code intelligence for Claude Code from TypeScript 7's own language server.

## Install

```
npm i -g typescript@latest
/plugin marketplace add Ink01101011/kktest-dev
/plugin install typescript-native-lsp@kktest-dev
```

`tsc -v` must print 7 or higher. An older `tsc` has no `--lsp` flag and the server will not start.

## What it does

Registers one language server, `tsc --lsp --stdio`, for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`,
`.mjs` and `.cjs`. Claude Code's LSP tool then has go-to-definition, references, symbols and
diagnostics for those files.

## Why not `typescript-lsp`

The official `typescript-lsp` plugin runs `typescript-language-server`, which loads `tsserver` from the
project's `node_modules/typescript` or from a `typescript` installed next to it. TypeScript 7 (the
native compiler, what npm `latest` now installs) ships no `tsserver`. So that server fails at `initialize` with
`Could not find a valid TypeScript installation` in a project that is on TypeScript 7, and in a project
with no `typescript` at all (a plain `.mjs` repo), and Claude Code reports
`Language server "plugin:typescript-lsp:typescript" couldn't start`.

TypeScript 7's `tsc` is the language server itself. It needs nothing from the project.

## Usage

Nothing to run. Disable `typescript-lsp` if it is installed: two TypeScript servers index the same
files twice, and the one that cannot start keeps reporting the error.

```
claude plugin disable typescript-lsp@claude-plugins-official
```

Notes:

- The global `tsc` serves every project, so diagnostics follow TypeScript 7 rules even in a project
  whose own `typescript` is 5 or 6. The project's `tsc` build is not affected.
- After a node upgrade under a version manager (mise, nvm, fnm, asdf, Volta) the new node has no global
  packages: run `npm i -g typescript@latest` again.
