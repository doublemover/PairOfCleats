# `@typescript-eslint/typescript-estree`

**Area:** Parsing (TS/JS → ESTree) + typed services

## Why this matters for PairOfCleats
Parse TS/JS into an ESTree-compatible AST with optional TypeScript services; enables unified traversals and queries across JS/TS code paths.

## Implementation notes (practical)
- Use `parseAndGenerateServices` when you want `parserServices` (TypeChecker access) for typed metadata.
- Be explicit with parse options (ECMAScript version, sourceType, tokens/comments, loc/range) because they affect chunk boundaries.
- Typed linting requires careful `project` + `tsconfigRootDir` configuration; avoid per-file TS Program creation.

## Where it typically plugs into PairOfCleats
- Unify JS/TS indexing flows with Babel-style visitors and `esquery` selectors.
- Store both syntactic metadata (nodes, ranges) and optional typed metadata (symbols/types) in chunk sidecars.
- Cache TS Programs per project to control performance.

## Deep links (implementation-relevant)
1. Package docs (AST, tokens/comments, services, parse options) — https://typescript-eslint.io/packages/typescript-estree/
2. Typed linting / project configuration guidance (project, tsconfigRootDir, performance pitfalls) — https://typescript-eslint.io/troubleshooting/typed-linting/
3. Source: parser entrypoint (parse / parseAndGenerateServices implementation details) — https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/typescript-estree/src/parser.ts

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).