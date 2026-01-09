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
1. MDX core compiler docs (compile/evaluate; plugin hooks) — https://mdxjs.com/packages/mdx/
2. Extending MDX (remark/rehype plugins; creating transforms) — https://mdxjs.com/docs/extending-mdx/
3. remark-mdx syntax plugin docs (MDX syntax inside unified) — https://mdxjs.com/packages/remark-mdx/

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).