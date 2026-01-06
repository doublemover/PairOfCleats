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
- [x] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded. (Current: bench results emit `mean/min/max/p50/p95` plus mode/backend in `tools/bench/micro/run.js`.)
- [x] Capture latency distributions, not just averages (p50/p95/p99). (See `tools/bench/micro/utils.js` for p50/p95; extend to p99 when adding tinybench.)
- [x] Make logs structured and redact secrets; add run/repo correlation fields. (Bench output is JSON in `tools/bench/micro/run.js`; structured logging hooks exist in `src/shared/progress.js`.)
- [x] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs). (Warmup/warm runs and default fixture repo in `tools/bench/micro/run.js`.)
