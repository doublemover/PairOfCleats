# Index Perf Contract

Status: Active v1.0  
Last updated: 2026-02-21T00:00:00Z

## Artifact set

Sequence-0 perf runs must emit all four artifacts under `tests/fixtures/perf/index/`:

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
- `perf-corpus-manifest.json` is deterministic:
  - `files[]` is sorted by `path` ascending.
  - `totals.files` equals `files.length`.
  - `totals.bytes` equals the sum of `files[].sizeBytes`.
- `perf-delta-report.json` is cross-linked and stage-aligned:
  - `baselineRef` points to `tests/fixtures/perf/index/perf-baseline-telemetry.json`.
  - `afterRef` points to `tests/fixtures/perf/index/perf-after-telemetry.json`.
  - `deltaByStage` uses the same stage keys as telemetry `stageMetrics`.
  - Each `deltaByStage[stage]` equals `after.stageMetrics[stage].wallMs - baseline.stageMetrics[stage].wallMs`.

## Validator surface

- Schema definitions: `src/contracts/schemas/index-perf.js`
- Validators: `src/contracts/validators/index-perf.js`
