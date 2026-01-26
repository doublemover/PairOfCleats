# `pino`

**Area:** Logging (structured, high-performance)

## Why this matters for PairOfCleats
Structured JSON logging with support for worker-thread transports, redaction, and child loggers.

## Implementation notes (practical)
- Use transports for formatting/forwarding without blocking the hot path.
- Redact secrets by path to keep logs safe in CI and shared artifacts.
- Use serializers/bindings for consistent context fields (repoId, runId, workerId).

## Where it typically plugs into PairOfCleats
- Index build: emit structured events for per-stage timings and counts.
- Service mode: correlate logs across API/indexer processes.

## Deep links (implementation-relevant)
1. Transports (worker-thread transports; custom targets; perf model) -- https://github.com/pinojs/pino/blob/main/docs/transports.md
2. Redaction (safely strip secrets from logs; path-based redaction) -- https://getpino.io/#/docs/redaction
3. Serializers & bindings (structured fields; child loggers) -- https://getpino.io/#/docs/api

## Suggested extraction checklist
- [x] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded. (Current: perf profiles track `files/bytes/lines/durationMs` in `src/index/build/perf-profile.js`; bench summaries label by mode/backend in `tools/bench/micro/run.js`.)
- [x] Capture latency distributions, not just averages (p50/p95/p99). (Bench summaries compute p50/p95 in `tools/bench/micro/utils.js`; extend to p99 when needed.)
- [x] Make logs structured and redact secrets; add run/repo correlation fields. (Structured logging via `src/shared/progress.js`; context fields `buildId`, `configHash`, `repoRoot` set in `src/index/build/runtime.js`; redaction planned if sensitive fields are added.)
- [x] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs). (Warmup/warm runs and default fixture repo in `tools/bench/micro/run.js`.)
