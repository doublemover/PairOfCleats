# `ignore`

**Area:** Ignore semantics (.gitignore-compatible)

## Why this matters for PairOfCleats
Apply `.gitignore`-style patterns in Node so indexing respects repo conventions and avoids noise.

## Implementation notes (practical)
- Use `createFilter` for efficient predicate-based filtering.
- Handle negations and pattern edge cases consistent with Git.

## Where it typically plugs into PairOfCleats
- Scan phase: filter file paths before handing to parsers/workers.
- Expose `.pairofcleats.json` overrides to add ignore patterns.

## Deep links (implementation-relevant)
1. README: createFilter + .gitignore semantics in Node — https://github.com/kaelzhang/node-ignore#readme
2. gitignore pattern format reference (edge cases; negations) — https://git-scm.com/docs/gitignore

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.