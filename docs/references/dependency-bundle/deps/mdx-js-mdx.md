# `@mdx-js/mdx`

**Area:** MDX parsing/compilation

## Why this matters for PairOfCleats
Parse/compile MDX docs with plugin hooks; useful when repos contain documentation with JSX embeds.

## Implementation notes (practical)
- Leverage remark/rehype plugin hooks for extracting headings and embedded components.
- Keep positional info when chunking; test on real-world MDX with JSX.

## Where it typically plugs into PairOfCleats
- Docs: treat MDX as markdown+JSX; produce section chunks and capture component references.

## Deep links (implementation-relevant)
1. MDX core compiler docs (compile/evaluate; plugin hooks)  https://mdxjs.com/packages/mdx/
2. Extending MDX (remark/rehype plugins; creating transforms)  https://mdxjs.com/docs/extending-mdx/
3. remark-mdx syntax plugin docs (MDX syntax inside unified)  https://mdxjs.com/packages/remark-mdx/

## Suggested extraction checklist
- [x] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column). (MDAST nodes include position start/end; use those for ranges.)
- [x] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required). (Walk headings, exports, and code fences only; avoid full compilation.)
- [x] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations). (Store block ranges and language IDs in chunk metadata; keep extracted references in indexes.)
- [x] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering). (Avoid full MDX compile; use parse-only mode; cap file size.)