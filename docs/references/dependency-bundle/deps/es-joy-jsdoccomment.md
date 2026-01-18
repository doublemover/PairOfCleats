# `@es-joy/jsdoccomment`

**Area:** JSDoc comment parsing and conversion

## Why this matters for PairOfCleats
Parse and tokenize JSDoc blocks, preserving tag structure, and optionally convert them into ESTree nodes.

## Implementation notes (practical)
- Use tokenization options to preserve structure (tags, descriptions) for robust extraction.
- Convert to ESTree when you want to traverse JSDoc semantics with familiar tooling.

## Where it typically plugs into PairOfCleats
- Metadata: extract `@param`, `@returns`, `@throws`, `@deprecated`, and custom tags as structured fields.

## Deep links (implementation-relevant)
1. README: parseComment + tokenization options (preserve tag structure)  https://github.com/es-joy/jsdoccomment#readme
2. README: commentParserToESTree (convert JSDoc to ESTree nodes)  https://github.com/es-joy/jsdoccomment#commentparsertosestree

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (Use comment start offsets plus tag line/column data from the parser; derive byte offsets from comment text.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Parse only JSDoc blocks discovered by a comment scanner.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store tags and signatures in chunk metadata; keep cross-file type links in derived indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid parsing non-JSDoc comments; reuse parser options; cap comment length.)