# `micromark`

**Area:** Doc parsing (Markdown) and positional chunking

## Why this matters for PairOfCleats
Parse Markdown into an AST while preserving exact positions so that section-based chunks remain stable across rebuilds.

## Implementation notes (practical)
- Use micromark extensions to support GitHub Flavored Markdown (GFM) and frontmatter without losing offsets.
- Convert to MDAST via `mdast-util-from-markdown` to get a structured tree with positional info.
- Handle YAML/TOML frontmatter with `micromark-extension-frontmatter` to keep metadata attached to the document root.

## Where it typically plugs into PairOfCleats
- Chunking: emit chunks per heading section and preserve `position` for durable IDs.
- Metadata extraction: frontmatter ’ document-level metadata; link/reference maps for cross-doc relations.
- Search: index heading text as boosted fields and capture section ancestry for filters.

## Deep links (implementation-relevant)
1. Extensions API (inject GFM/frontmatter handling; keep positions stable)  https://github.com/micromark/micromark#extensions
2. Companion: mdast-util-from-markdown (build AST with positional info from micromark)  https://github.com/syntax-tree/mdast-util-from-markdown#readme
3. Companion: micromark-extension-frontmatter (YAML/TOML frontmatter blocks)  https://github.com/micromark/micromark-extension-frontmatter#readme

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (Use micromark token/event positions to derive stable offsets.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Enable only required extensions; avoid full HTML rendering.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store block spans and link targets in chunk metadata; keep token postings derived.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid full buffering on huge docs; stream where possible.)