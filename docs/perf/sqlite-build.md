# SQLite Build Performance

This document describes the current performance strategy for Stage4 (SQLite build) and how to interpret the build telemetry.

## Scope
- Applies to artifact builds (`build-from-artifacts`) and incremental bundle builds (`build-from-bundles`).
- Applies to incremental updates (`incremental-update`) when reusing an existing SQLite DB.
- Does not change schema versions or query semantics.

## Build Pragmas
SQLite build pragmas are applied during Stage4 to improve throughput and bound WAL growth. Pragmas are restored after build completion.

Applied during build (adaptive values):
- `journal_mode = WAL`
- `synchronous = OFF`
- `temp_store = MEMORY`
- `cache_size` (negative KB, scales with input size)
- `mmap_size` (bytes, scales with input size)
- `journal_size_limit` (bytes, scales with input size)
- `wal_autocheckpoint` (pages, derived from journal size + page size)
- `locking_mode = EXCLUSIVE`

Restored after build:
- `synchronous = NORMAL`
- `temp_store = DEFAULT`
- `locking_mode = NORMAL`
- Other pragmas are restored when original values are known.

## Batch Sizing
Batch size is derived from input size with min/max clamps. The resolver prioritizes explicit batch size overrides, then uses input bytes and row counts (when known) to reduce batch size for large inputs.

## Post-build Optimization
After indexes are created, Stage4 runs:
- `PRAGMA optimize`
- `ANALYZE` when input size exceeds the adaptive threshold

## Telemetry
Stage4 telemetry is captured in:
- `metrics/stage-audit-<mode>.json`
- `index_state.json` under `sqlite.stats`

Fields recorded for build telemetry:
- `batchSize`
- `validationMs`
- `pragmas` (applied values)
- `tables` (per-table rows, duration, rows/sec)
- `optimize` (whether optimize/analyze ran + duration)
- `incrementalSkipReason` / `incrementalSummary` (when incremental update is skipped)

## Benchmarks
The following scripts are used to compare baseline vs optimized behavior:
- `tools/bench/sqlite/build-from-artifacts.js`
- `tools/bench/sqlite/build-from-bundles.js`
- `tools/bench/sqlite/incremental-update.js`
- `tools/bench/sqlite/jsonl-streaming.js`

Each benchmark should report:
- Input bytes, wall-clock time, and rows/sec per table
- Peak RSS when available
- WAL size before/after build
