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
1. Transports (worker-thread transports; custom targets; perf model) — https://github.com/pinojs/pino/blob/main/docs/transports.md
2. Redaction (safely strip secrets from logs; path-based redaction) — https://getpino.io/#/docs/redaction
3. Serializers & bindings (structured fields; child loggers) — https://getpino.io/#/docs/api

## Suggested extraction checklist
- [ ] Define a minimal metrics vocabulary (names, labels) and keep label cardinality bounded.
- [ ] Capture latency distributions, not just averages (p50/p95/p99).
- [ ] Make logs structured and redact secrets; add run/repo correlation fields.
- [ ] Keep benchmarking reproducible (fixed inputs, warmups, pinned configs).