# `hdr-histogram-js`

**Area:** High-resolution latency histograms

## Why this matters for PairOfCleats
Accurate percentile latency measurements for benchmarks and live metrics with low overhead.

## Implementation notes (practical)
- Record values in consistent units (e.g., microseconds) and publish derived percentiles.
- Use encoded histograms for portability or dashboard visualization.

## Where it typically plugs into PairOfCleats
- Benchmarks: capture p50/p95/p99 for indexing and search operations; store artifacts alongside build outputs.

## Deep links (implementation-relevant)
1. README: recordValue + percentile metrics (latency histograms)  https://github.com/HdrHistogram/HdrHistogramJS#record-values-and-retrieve-metrics
2. Widget examples (visualize histograms encoded across languages)  https://github.com/HdrHistogram/HdrHistogramWidget#readme

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: use Histogram recordValue()/percentile() to track latency distributions.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: lowest/highest values, significant figures, auto-resize.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/perf/bench/run.test.js metrics output. Planned benchmark: tools/bench/language-repos.js.)
