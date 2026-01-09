# `svelte`

**Area:** Framework parsing (Svelte)

## Why this matters for PairOfCleats
Use the Svelte compiler’s `parse` output to chunk `.svelte` components with correct AST positions.

## Implementation notes (practical)
- Use `parse` to obtain AST nodes and source positions for script/template/style sections.
- Consider compiling only when needed; parsing is typically sufficient for indexing.

## Where it typically plugs into PairOfCleats
- Split chunks by `<script>`, `<style>`, and markup blocks; store component-level metadata (exports/props).

## Deep links (implementation-relevant)
1. Svelte compiler API (parse/compile; AST structure) — https://svelte.dev/docs/svelte-compiler
2. Compiler 'parse' API (AST + positions; used for Svelte chunking) — https://svelte.dev/docs/svelte-compiler#parse

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).