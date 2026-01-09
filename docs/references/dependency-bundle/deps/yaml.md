# `yaml`

**Area:** Config/document parsing (YAML) with positional fidelity

## Why this matters for PairOfCleats
Parse YAML configs and frontmatter while retaining comments and location utilities so chunk boundaries remain stable.

## Implementation notes (practical)
- Prefer parsing into `Document` objects when you need CST/AST and comment preservation.
- Use line/position utilities to map nodes back to source ranges for chunk offsets.
- Be explicit about schema/version behavior if you index YAML semantics (booleans, timestamps, etc.).

## Where it typically plugs into PairOfCleats
- Chunking: split by top-level keys or document sections while storing exact ranges.
- Metadata: retain comments as 'explanation' fields for config keys.

## Deep links (implementation-relevant)
1. YAML package docs (parse Document; CST/AST; preserving comments & source tokens) — https://eemeli.org/yaml/
2. Parsing documents + line/position utilities (for stable chunk boundaries) — https://eemeli.org/yaml/#parsing-documents
3. Source: YAML repo CST/AST/Document APIs (deep dive) — https://github.com/eemeli/yaml#readme

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).