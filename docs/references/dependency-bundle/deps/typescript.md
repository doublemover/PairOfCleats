# `typescript`

**Area:** Parsing / Type analysis (TS/JS)

## Why this matters for PairOfCleats
Use TypeScript's compiler and language service APIs when you need project-aware parsing, symbol resolution, and type inference for TypeScript/JavaScript files.

## Implementation notes (practical)
- Prefer `LanguageService` for incremental, project-aware analysis (tsconfig, module resolution, watch programs).
- Use `Program` + `TypeChecker` patterns for batch indexing and extracting declarations/signatures/types.
- Use `tsserver` protocol types when you need to emulate editor-like queries or consume standardized request/response shapes.

## Where it typically plugs into PairOfCleats
- Chunking: map AST nodes back to stable `{start,end}` offsets/line-col for durable chunk IDs.
- Metadata: derive signatures, modifiers, export/import graphs, and inferred types (optionally cross-file).
- Incremental: reuse `DocumentRegistry` / cached SourceFiles to avoid full reparse.

## Deep links (implementation-relevant)
1. Using the Compiler API (Program, SourceFile, TypeChecker patterns) — https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
2. Using the Language Service API (incremental, project-aware analysis) — https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API
3. tsserver protocol types (request/response shapes; useful for incremental queries) — https://github.com/microsoft/TypeScript/blob/main/lib/protocol.d.ts

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).