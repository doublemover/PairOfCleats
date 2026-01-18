# `jsdoc-type-pratt-parser`

**Area:** JSDoc type parsing

## Why this matters for PairOfCleats
Parse JSDoc type expressions into an AST for richer signature/type metadata when TypeScript types are not available.

## Implementation notes (practical)
- Normalize parsed type AST to a canonical string form for indexing/filtering.
- Handle unions, generics, nullable/optional patterns consistently across projects.

## Where it typically plugs into PairOfCleats
- Metadata: attach parsed param/return types to chunks and allow `--param-type` style filters.

## Deep links (implementation-relevant)
1. Docs site (AST output; supported grammar; examples)  https://jsdoc-type-pratt-parser.js.org/
2. Repo README (usage patterns; parsing JSDoc type expressions)  https://github.com/jsdoc-type-pratt-parser/jsdoc-type-pratt-parser#readme

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (Track ranges using parser token positions; map to comment offsets when needed.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Parse only type expressions referenced by tags; avoid full comment ASTs.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store inferred type strings in chunk metadata; keep cross-file type edges in derived indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid re-parsing identical type strings; cache results per comment.)