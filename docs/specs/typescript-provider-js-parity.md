# Spec: TypeScript provider parity + VFS (current)

Status: Implemented

This document describes the current TypeScript tooling provider behavior in
`src/index/tooling/typescript-provider.js`.

## 1) Goals

- Analyze TS/TSX and JS/JSX through the same provider.
- Use virtual documents (VFS) for segment-aware sources.
- Emit outputs keyed by `chunkUid` with optional heuristic `symbolRef`.
- Avoid ambiguous joins by preferring range-based matches.

## 2) Provider config (current shape)

```ts
export type TypeScriptProviderConfig = {
  tsconfigPath?: string | null;
  allowJs?: boolean;   // default true
  checkJs?: boolean;   // default true
  includeJsx?: boolean; // default true
  maxFiles?: number | null;
  resolveOrder?: Array<'repo' | 'cache' | 'tooling' | 'global'>;
};
```

Resolution order defaults to `['repo', 'cache', 'global']`.

## 3) Inputs

The provider receives:
- `documents: ToolingVirtualDocument[]`
- `targets: ToolingTarget[]`

The provider does not read source files directly, except for tsconfig and
TypeScript/lib resolution via the compiler host.

## 4) Program construction

- TypeScript is resolved from repo, cache, or global according to `resolveOrder`.
- Compiler host is created via `createVirtualCompilerHost` and serves VFS docs first.
- If `tsconfigPath` is provided and valid, it is used; otherwise defaults are:
  - `allowJs: true`, `checkJs: true`, `jsx: Preserve`, `target: ES2020`,
    `module: ESNext`, `moduleResolution: Node10`, `skipLibCheck: true`, `noEmit: true`.

## 5) Target matching

For each `ToolingTarget`:
- Match is based on overlap with `virtualRange` and optional kind/name hints.
- Candidates are scored by overlap ratio, kind match, and exact name match.
- If the top score is tied, result is `ambiguous`.
- In non-strict mode, a name-only fallback is allowed when range matching fails.

Status values:
- `ok`, `missing`, `ambiguous` (used for diagnostics and confidence).

## 6) Output shape

Each `byChunkUid[chunkUid]` entry includes:
- `chunk: ChunkRef`
- `payload: { returnType?, paramTypes?, signature? }`
- `provenance: { provider, version, collectedAt }`
- Optional `symbolRef` (heuristic)

### Heuristic SymbolRef
Current implementation emits a heuristic `symbolRef` using:
- `buildSymbolKey`, `buildSignatureKey`, `buildScopedSymbolId`, `buildSymbolId`
- `scheme: 'heur'`

This is intentionally non-canonical and may differ from future identity contracts.

## 7) Caching

Provider config is hashed via `hashProviderConfig` and used by the tooling
orchestrator cache.

## 8) Tests

- `tests/tooling/lsp/typescript/typescript-js-parity-basic.test.js`
- `tests/tooling/lsp/typescript/typescript-vfs-segment-vue.test.js`
- `tests/tooling/lsp/typescript/typescript-node-matching-range.test.js`
- `tests/tooling/lsp/typescript/typescript-ambiguous-fallback-does-not-guess.test.js`
- `tests/tooling/lsp/typescript/typescript-destructured-param-names.test.js`
