# `parse5`

**Area:** HTML parsing with locations

## Why this matters for PairOfCleats
Parse HTML (and HTML-like templates) while retaining node ranges for chunking and metadata extraction.

## Implementation notes (practical)
- Enable `sourceCodeLocationInfo` for node ranges.
- Consider SAX mode for streaming/low-memory workflows; capture token locations.

## Where it typically plugs into PairOfCleats
- Docs/templates: chunk by headings/sections, extract link graphs, and preserve offsets.

## Deep links (implementation-relevant)
1. ParserOptions: sourceCodeLocationInfo (node ranges for chunking) — https://parse5.js.org/interfaces/parse5.ParserOptions.html
2. SAX tokens: comment token locations (if streaming/low-memory parse) — https://parse5.js.org/interfaces/parse5-sax-parser.Comment.html
3. Companion: hast-util-from-parse5 (convert parse5 AST to hast) — https://github.com/syntax-tree/hast-util-from-parse5#readme

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).