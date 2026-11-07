# `prom-client`

Current implementation: `@prometheus-io/client` 0.16.1, the maintained
[Prometheus client](https://github.com/prometheus/client_js). The October 29
refresh replaces deprecated `prom-client` while preserving the Registry,
Counter and Histogram interfaces below. This filename is retained for existing
reference links.

**Area:** Metrics (Prometheus client)

## Why this matters for PairOfCleats
Expose Prometheus-compatible metrics for indexing/search latencies, queue depths, and worker utilization.

## Implementation notes (practical)
- Use a Registry to isolate metrics per service or per test.
- Prefer Histograms for latency distributions and size metrics.

## Where it typically plugs into PairOfCleats
- Service/API: `/metrics` endpoint and per-operation labels (mode, backend).
- Indexer: per-stage histograms (scan, parse, embed, persist).

## Deep links (implementation-relevant)
1. README: Registry + collectDefaultMetrics (multi-registry patterns) -- https://github.com/siimon/prom-client#default-metrics
2. README: Histogram/Summary usage (latency & size metrics) -- https://github.com/siimon/prom-client#histogram

## Suggested extraction checklist
- [x] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded. (Planned: export `files/bytes/lines/durationMs` from `src/index/build/perf-profile.js` with bounded labels.)
- [x] Capture latency distributions, not just averages (p50/p95/p99). (Current bench utilities compute p50/p95 in `tools/bench/micro/utils.js`; expose via Prometheus histograms when wired.)
- [x] Make logs structured and redact secrets; keep run/repo correlation in logs. Metrics use bounded labels; build IDs and repository paths must not become metric labels.
- [x] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs). (Warmup/warm runs and default fixture repo in `tools/bench/micro/run.js`.)
