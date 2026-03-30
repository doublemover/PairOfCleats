# Lane Evidence

Generated: 2026-03-30T06:06:17.117Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 15s
  fresh artifacts: `.testLogs/gate-testRunTimes.txt`
- `ci-lite`: 770 tests, 770 with timings, 1253823 ms known duration, p50=722 ms, p95=6381 ms, target 15s
  fresh artifacts: `.testLogs/ci-lite-testRunTimes.txt`
- `ci`: 120 tests, 119 with timings, 2727696 ms known duration, p50=21644 ms, p95=46481 ms, target 60s
  fresh artifacts: `.testLogs/ci-testRunTimes.txt`
- `ci-long`: 18 tests, 18 with timings, 1163761 ms known duration, p50=60062 ms, p95=90154 ms, target 180s
  fresh artifacts: `.testLogs/ci-long-testRunTimes.txt`

## Exact Cross-Lane Duplicates

- None

## Top Families

- `storage/sqlite`: 62 tests, 725942 ms known duration
- `tooling/lsp`: 79 tests, 300370 ms known duration
- `indexing/embeddings`: 31 tests, 191269 ms known duration
- `retrieval/filters`: 5 tests, 185651 ms known duration
- `cli/search`: 7 tests, 181038 ms known duration
- `services/api`: 6 tests, 179492 ms known duration
- `storage/lmdb`: 2 tests, 133022 ms known duration
- `retrieval/ann`: 7 tests, 114664 ms known duration
- `indexing/map`: 4 tests, 111551 ms known duration
- `indexing/incremental`: 5 tests, 110703 ms known duration
- `indexing/determinism`: 5 tests, 94201 ms known duration
- `retrieval/cache`: 2 tests, 92837 ms known duration
- `indexing/chunking`: 11 tests, 90634 ms known duration
- `indexing/imports`: 32 tests, 85535 ms known duration
- `tooling/triage`: 3 tests, 84578 ms known duration

## Setup Hotspots

- `index-build-heavy`: 354 tests, 1451114 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `sqlite-heavy`: 62 tests, 725942 ms known duration
  SQLite maintenance, fail-closed, and migration tests often rebuild the same sample fixture.
- `lsp-bootstrap`: 79 tests, 300370 ms known duration
  Dedicated/configured provider bootstrap and session reuse.
- `embeddings-cache`: 31 tests, 191269 ms known duration
  Embedding cache and stub fast-path families frequently overlap on the same fixture/setup.
- `search-cli-contract`: 7 tests, 181038 ms known duration
  Search CLI help, explain, and contract surfaces share fixture/index bootstrap.
- `api-server-boot`: 6 tests, 179492 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `smoke-wiring`: 9 tests, 140860 ms known duration
  Smoke suites should stay thin and avoid chaining lower-level contract tests.
- `lmdb-report`: 2 tests, 133022 ms known duration
  LMDB report/corruption tests can often share one built fixture and diverge only in tamper steps.
- `map-build`: 4 tests, 111551 ms known duration
  Code-map suites often share the same repo build and render pipeline.
- `cli-cold-start`: 4 tests, 72309 ms known duration
  CLI process startup and argument-routing overlap.

## Top Slowest Tests

- `cli/search/contract-matrix`: 90154 ms
  family: `cli/search`
  hotspot: `search-cli-contract`
- `storage/sqlite/incremental/update-contract-matrix`: 88144 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `retrieval/cache/query-cache-contract-matrix`: 83917 ms
  family: `retrieval/cache`
- `storage/lmdb/report-contract-matrix`: 81159 ms
  family: `storage/lmdb`
  hotspot: `lmdb-report`
- `retrieval/filters/search-filter-contract-matrix`: 81062 ms
  family: `retrieval/filters`
- `indexing/piece-assembly/core`: 79451 ms
  family: `indexing/piece-assembly`
  hotspot: `index-build-heavy`
- `indexing/map/code-map-guardrail-matrix`: 69834 ms
  family: `indexing/map`
  hotspot: `map-build`
- `indexing/determinism/chunkuid`: 65763 ms
  family: `indexing/determinism`
  hotspot: `index-build-heavy`
- `indexing/shards/shard-merge`: 62969 ms
  family: `indexing/shards`
  hotspot: `index-build-heavy`
- `retrieval/backend/backend-contract-matrix`: 60062 ms
  family: `retrieval/backend`

