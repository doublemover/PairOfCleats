# `@astrojs/compiler`

**Area:** Framework parsing (Astro)

## Why this matters for PairOfCleats
Parse `.astro` files and capture location mapping; supports mixed frontmatter/script and markup.

## Implementation notes (practical)
- Use the compiler API that produces AST + loc mapping; note WASM constraints for runtime environments.
- Prefer transform only when you need normalized output; parsing is often enough for indexing.

## Where it typically plugs into PairOfCleats
- Chunk frontmatter separately from markup; record imported components and frontmatter exports.

## Deep links (implementation-relevant)
1. Compiler package README (parse, transform; AST + loc mapping) — https://github.com/withastro/compiler/blob/main/packages/compiler/README.md
2. Source: compiler package folder (API surface; wasm constraints) — https://github.com/withastro/compiler/tree/main/packages/compiler

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).