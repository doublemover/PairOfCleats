# `@babel/traverse`

**Area:** AST traversal (JS/TS/ESTree/Babel AST)

## Why this matters for PairOfCleats
Walk ASTs with visitor patterns and scope-aware NodePath utilities for metadata extraction (calls, imports, exports, identifiers).

## Implementation notes (practical)
- Use visitor objects with `enter/exit` for efficient traversal; avoid allocating per-node state unnecessarily.
- Leverage `NodePath` + scope APIs when you need binding resolution (within-file).

## Where it typically plugs into PairOfCleats
- Metadata: build call graphs, import graphs, and identifier usage maps per chunk.
- Normalization: extract canonical signatures and docstrings.

## Deep links (implementation-relevant)
1. Babel traverse docs (visitors, NodePath, scope, state)  https://babeljs.io/docs/babel-traverse
2. Plugin handbook (visitor patterns; avoiding perf pitfalls)  https://babeljs.io/docs/en/plugins#plugin-development

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (Ensure parser emits node start/end and loc; use those spans directly.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Visit imports/exports/classes/functions only; avoid transform passes.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store symbol names, kinds, and ranges in chunk metadata; keep call graphs in derived indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid per-file parser creation; avoid code generation; cap file size.)