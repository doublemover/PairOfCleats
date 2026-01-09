# `esquery`

**Area:** AST querying (selectors over ESTree)

## Why this matters for PairOfCleats
Query ASTs declaratively (e.g., 'all call expressions to X') to support targeted metadata extraction and rule-based tagging.

## Implementation notes (practical)
- Use selectors for fast extraction of specific patterns; combine with `:matches()` / `:has()` for structure-aware queries.
- Pair with pre-indexed node lists (per file) to avoid repeated full walks.

## Where it typically plugs into PairOfCleats
- Risk tags: identify sources/sinks (e.g., `eval`, `child_process.exec`) using selectors.
- Relation extraction: `ImportDeclaration`, `CallExpression`, and framework-specific patterns.

## Deep links (implementation-relevant)
1. Selector syntax reference (queries over ESTree; :matches/:has, etc.) — https://github.com/estools/esquery#selectors
2. Examples of selector usage (practical query patterns) — https://github.com/estools/esquery#examples

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).