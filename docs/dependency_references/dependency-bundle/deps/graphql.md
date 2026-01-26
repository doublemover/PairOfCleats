# `graphql`

**Area:** GraphQL document parsing/visiting

## Why this matters for PairOfCleats
Parse GraphQL schema and query documents; use visitor patterns to extract types, fields, operations, and references with location mapping.

## Implementation notes (practical)
- Use `getLocation` and AST node locs to map back to source ranges for chunking.
- Use `visit()` for extraction/transforms without manual tree walking.

## Where it typically plugs into PairOfCleats
- Chunk by definition (type, query, mutation); extract field references for relation graphs.

## Deep links (implementation-relevant)
1. GraphQL.js language API (parse, visit, getLocation; AST ops)  https://www.graphql-js.org/api-v16/language/
2. Example: using visit() to transform documents (visitor patterns)  https://www.apollographql.com/docs/react/data/document-transforms

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (GraphQL AST nodes expose loc start/end offsets; map to line/column using parser utilities.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Walk definitions, fields, and fragments only; skip schema transforms.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store definition names, kinds, and ranges in chunk metadata; keep reference graphs in derived indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid parsing per query during indexing; cache parser options; cap document size.)