# typescript-native-lsp — Concepts & Usage

The [plugin README](../../plugins/typescript-native-lsp/README.md) covers installation. The formal
contract is in [SPEC.md](./SPEC.md).

## The problem it solves

Claude Code's LSP tool gets TypeScript and JavaScript intelligence from a language server that a
plugin registers. The official `typescript-lsp` plugin registers `typescript-language-server`, a wrapper
that loads `tsserver` from a `typescript` package: the project's `node_modules/typescript` first, then
a `typescript` installed next to the wrapper.

TypeScript 7 is the native compiler. Its npm package ships `tsc` only, no `tsserver`. So the wrapper
finds nothing to load in two common cases:

- the project is on TypeScript 7;
- the project has no `typescript` at all (a plain `.mjs` repo), and the global `typescript` is absent
  or is 7, which is what `npm i -g typescript` installs today.

The server then answers `initialize` with `Could not find a valid TypeScript installation` and exits,
and Claude Code reports `Language server "plugin:typescript-lsp:typescript" couldn't start`.

## What this plugin does instead

TypeScript 7's `tsc` is a language server: `tsc --lsp --stdio`. This plugin registers that command for
the same eight extensions. One global `typescript` serves every project, with or without a
`typescript` devDependency.

## Usage

```
npm i -g typescript@latest
/plugin install typescript-native-lsp@kktest-dev
claude plugin disable typescript-lsp@claude-plugins-official   # if it was installed
```

The team pack (`kktestdev-pack` 0.2.4+) installs it as the core TS/JS item: run `/kk-onboard`.

## Limits

- `tsc` on PATH must be TypeScript 7+. A `tsc` from TypeScript 6 or older has no `--lsp` flag.
- Diagnostics follow the global TypeScript 7, not the version in the project's `package.json`.
- A node upgrade under a version manager drops global packages: install `typescript` again
  (`/kk-update` does this for pack machines).

## Claude Code only

It only registers a Claude Code LSP server, so there is nothing to export to other AI tools (tier
"Claude-only").
