# `@handlebars/parser`

**Area:** Template parsing (Handlebars)

## Why this matters for PairOfCleats
Parse Handlebars templates into an AST via a stable parsing entrypoint suitable for analysis and chunking.

## Implementation notes (practical)
- Use `parseWithoutProcessing` when you need a predictable AST without additional compilation steps.
- Extract helpers/partials usage to build relations.

## Where it typically plugs into PairOfCleats
- Chunk by top-level blocks/partials; tag template variables and helpers.

## Deep links (implementation-relevant)
1. Compiler API: parseWithoutProcessing → Handlebars AST (stable parsing entrypoint) — https://github.com/handlebars-lang/handlebars.js/blob/master/docs/compiler-api.md

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).