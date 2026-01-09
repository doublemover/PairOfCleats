# `nunjucks`

**Area:** Template parsing (Nunjucks)

## Why this matters for PairOfCleats
Support advanced template analysis via custom tags/parser exposure and precompilation to avoid runtime parse costs.

## Implementation notes (practical)
- Use precompilation to obtain AST-like artifacts deterministically.
- Custom tags enable parsing domain-specific constructs used in a repo.

## Where it typically plugs into PairOfCleats
- Chunk templates by blocks/macros; extract includes/imports and variable usage.

## Deep links (implementation-relevant)
1. API: custom tags (parser API exposure; advanced template analysis) — https://mozilla.github.io/nunjucks/api.html#custom-tags
2. Precompiling templates (build-time parsing; avoiding runtime parse costs) — https://mozilla.github.io/nunjucks/api.html#precompiling

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).