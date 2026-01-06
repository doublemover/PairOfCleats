# `@ast-grep/napi`

**Area:** Pattern-based AST search (high-performance)

## Why this matters for PairOfCleats
Use ast-grep for fast, rule-driven pattern matching over source code ASTs via N-API (Rust), minimizing JS<->native overhead.

## Implementation notes (practical)
- Prefer batch APIs like `findAll` to avoid per-node FFI churn.
- Model rules as config so they are reviewable/versioned (patterns, constraints, utils).

## Where it typically plugs into PairOfCleats
- Risk analysis: define an auditable set of rules that produce tags and spans.
- Refactoring support: replacement rules for 'quick-fix' suggestions.

## Deep links (implementation-relevant)
1. JavaScript API (parse, findAll, replace; AST access via N-API) ? https://ast-grep.github.io/guide/api-usage/js-api.html
2. Performance tip (avoid per-node JS?Rust FFI calls; prefer findAll) ? https://ast-grep.github.io/guide/api-usage/performance-tip.html
3. Rule configuration essentials (patterns, constraints, utilities) ? https://ast-grep.github.io/guide/rule-config.html

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (Use ast-grep node.range() (line/column) from tree-sitter; derive byte offsets from the source text when needed.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Use rule-based findAll selectors for top-level defs/imports; avoid full AST transforms.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store match spans and rule IDs in chunk metadata; keep cross-file relations in derived indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid per-node FFI; parse once per file and batch findAll; cap file size.)
