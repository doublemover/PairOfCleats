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
1. Docs site (AST output; supported grammar; examples) — https://jsdoc-type-pratt-parser.js.org/
2. Repo README (usage patterns; parsing JSDoc type expressions) — https://github.com/jsdoc-type-pratt-parser/jsdoc-type-pratt-parser#readme

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).