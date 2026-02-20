# Native Acceleration Performance Plan

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define performance measurement strategy for native acceleration work and document required before/after evidence.

## Measurement dimensions

- End-to-end query latency.
- Top-k stage latency.
- ANN stage latency.
- Worker offload overhead.
- Memory footprint during retrieval workloads.

## Test corpus classes

1. Small repositories (<10k files).
2. Medium repositories (10k-200k files).
3. Large repositories (200k+ files).
4. Adversarial tie-heavy ranking inputs.

## Execution rules

1. Compare active baseline and native candidate on identical corpora/config.
2. Use deterministic seeds for any stochastic ANN behavior.
3. Capture p50/p95/p99 and max, plus memory high-water mark.

## Reporting

Each run report must include:

- timestamp (ISO 8601),
- commit identifiers,
- hardware/runtime profile,
- config snapshot,
- raw metrics and computed deltas.

## Acceptance summary

Native acceleration is accepted for a surface when it shows consistent net improvements with no correctness regressions.

## Related docs

- `docs/specs/native-accel.md`
- `docs/perf/retrieval-pipeline.md`
