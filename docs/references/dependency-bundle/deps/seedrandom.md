# `seedrandom`

**Area:** Determinism / reproducible sampling

## Why this matters for PairOfCleats
Deterministic PRNG streams for sampling, shuffling, and any randomized heuristics in indexing pipelines.

## Implementation notes (practical)
- Seed per run/repo to make results reproducible and debuggable.
- Avoid global seeding unless you control all call sites.

## Where it typically plugs into PairOfCleats
- Sampling: deterministic selection of 'neighbor context' or exemplars for summaries.

## Deep links (implementation-relevant)
1. README: deterministic PRNG streams + global seeding patterns — https://github.com/davidbau/seedrandom#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.