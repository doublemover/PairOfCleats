# `fast-xml-parser`

**Area:** XML parsing

## Why this matters for PairOfCleats
Parse XML configs with options to preserve order, attributes, and namespaces—useful when mapping config semantics to chunks.

## Implementation notes (practical)
- Pick options intentionally: attributes/namespaces/preserveOrder affect chunking and data model.
- Document option choices in artifacts for reproducibility.

## Where it typically plugs into PairOfCleats
- Config chunking: split by top-level elements or logical sections; store XPath-like context.

## Deep links (implementation-relevant)
1. Parsing options (attributes, namespaces, preserveOrder) — https://naturalintelligence.github.io/fast-xml-parser/
2. Detailed option reference (XMLParser options) — https://github.com/NaturalIntelligence/fast-xml-parser/blob/master/docs/v4/2.XMLparseOptions.md

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).