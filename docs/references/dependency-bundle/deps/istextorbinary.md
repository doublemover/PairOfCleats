# `istextorbinary`

**Area:** Text vs binary heuristics

## Why this matters for PairOfCleats
Determine whether a file should be decoded/parsed as text when magic-number detection is insufficient.

## Implementation notes (practical)
- Use buffer-based detection for sampled reads to avoid full-file loads.
- Combine with encoding detection to reduce misclassification.

## Where it typically plugs into PairOfCleats
- Ingestion: decide decode path and chunker eligibility.

## Deep links (implementation-relevant)
1. README: isText/isBinary + buffer vs file-path variants — https://github.com/bevry/istextorbinary#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.