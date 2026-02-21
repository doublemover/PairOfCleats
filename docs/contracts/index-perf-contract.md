# Index Perf Contract

Status: Active v1.0  
Last updated: 2026-02-21T00:00:00Z

## Artifact set

Sequence-0 perf runs must emit all four artifacts under `benchmarks/index/`:

1. `perf-corpus-manifest.json`
2. `perf-baseline-telemetry.json`
3. `perf-after-telemetry.json`
4. `perf-delta-report.json`

## Required schema guarantees

- `schemaVersion` is fixed to `1`.
- `generatedAt` is ISO 8601.
- `indexOptimizationProfile` is one of:
  - `default`
  - `throughput`
  - `memory-saver`
- `stageMetrics` includes all required stages:
  - `scan`
  - `read`
  - `chunk`
  - `parse`
  - `relation`

## Validator surface

- Schema definitions: `src/contracts/schemas/index-perf.js`
- Validators: `src/contracts/validators/index-perf.js`
