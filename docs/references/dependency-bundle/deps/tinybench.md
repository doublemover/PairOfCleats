# `tinybench`

**Area:** Microbench tooling

## Why this matters for PairOfCleats
Run disciplined microbenchmarks (warmup, iterations) to compare parser/index strategies and detect regressions.

## Implementation notes (practical)
- Always include warmup; pin CPU conditions as much as possible.
- Report variance and use enough iterations to reduce noise.

## Where it typically plugs into PairOfCleats
- Benchmark suite: compare AST parsers and chunkers; store results to track performance over time.

## Deep links (implementation-relevant)
1. README: warmup/iterations/timing hooks (microbench discipline) — https://github.com/tinylibs/tinybench#readme

## Suggested extraction checklist
- [ ] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded.
- [ ] Capture latency distributions, not just averages (p50/p95/p99).
- [ ] Make logs structured and redact secrets; add run/repo correlation fields.
- [ ] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs).