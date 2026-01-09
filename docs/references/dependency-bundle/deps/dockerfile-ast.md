# `dockerfile-ast`

**Area:** Dockerfile parsing

## Why this matters for PairOfCleats
Parse Dockerfiles into an AST to extract instructions, ARG/ENV usage, and build context references.

## Implementation notes (practical)
- Extract instruction boundaries for chunking and metadata (FROM stages, RUN commands).
- Support examples-driven development using runnable sandboxes when validating edge cases.

## Where it typically plugs into PairOfCleats
- Config indexing: chunk per stage or per instruction group; extract base images and build args.

## Deep links (implementation-relevant)
1. Repo README: parsing & AST access (instructions, args, env, etc.) — https://github.com/rcjsuen/dockerfile-ast#readme
2. CodeSandbox examples (quick-start runnable parsers) — https://codesandbox.io/examples/package/dockerfile-ast

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).