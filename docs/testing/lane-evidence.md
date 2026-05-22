# Lane Evidence

Generated: 2026-05-22T05:26:37.160Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 15s
  fresh artifacts: `.testLogs/gate-testRunTimes.txt`
- `ci-lite`: 769 tests, 769 with timings, 1256542 ms known duration, p50=654 ms, p95=7352 ms, target 15s
  fresh artifacts: `.testLogs/ci-lite-testRunTimes.txt`
- `ci`: 121 tests, 23 with timings, 123954 ms known duration, p50=5020 ms, p95=5040 ms, target 60s
  fresh artifacts: `.testLogs/ci-testRunTimes.txt`
- `ci-long`: 18 tests, 18 with timings, 566195 ms known duration, p50=33522 ms, p95=59026 ms, target 180s
  fresh artifacts: `.testLogs/ci-long-testRunTimes.txt`
- `usr-full-conformance`: 11 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 60s

## Exact Cross-Lane Duplicates

- None

## Top Families

- `tooling/lsp`: 79 tests, 221240 ms known duration
- `storage/sqlite`: 62 tests, 214592 ms known duration
- `indexing/watch`: 15 tests, 73772 ms known duration
- `indexing/imports`: 32 tests, 67677 ms known duration
- `retrieval/filters`: 5 tests, 67157 ms known duration
- `indexing/tree-sitter`: 26 tests, 62694 ms known duration
- `indexing/incremental`: 5 tests, 58264 ms known duration
- `indexing/chunking`: 11 tests, 46629 ms known duration
- `retrieval/cache`: 2 tests, 41022 ms known duration
- `cli/search`: 7 tests, 40626 ms known duration
- `indexing/artifacts`: 37 tests, 38298 ms known duration
- `retrieval/federation`: 7 tests, 37361 ms known duration
- `services/api-search-asof`: 1 tests, 37201 ms known duration
- `indexing/piece-assembly`: 2 tests, 35825 ms known duration
- `retrieval/pipeline`: 14 tests, 35473 ms known duration

## Setup Hotspots

- `index-build-heavy`: 354 tests, 699600 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `lsp-bootstrap`: 79 tests, 221240 ms known duration
  Dedicated/configured provider bootstrap and session reuse.
- `sqlite-heavy`: 62 tests, 214592 ms known duration
  SQLite maintenance, fail-closed, and migration tests often rebuild the same sample fixture.
- `search-cli-contract`: 7 tests, 40626 ms known duration
  Search CLI help, explain, and contract surfaces share fixture/index bootstrap.
- `embeddings-cache`: 31 tests, 20682 ms known duration
  Embedding cache and stub fast-path families frequently overlap on the same fixture/setup.
- `map-build`: 4 tests, 19049 ms known duration
  Code-map suites often share the same repo build and render pipeline.
- `lmdb-report`: 2 tests, 17772 ms known duration
  LMDB report/corruption tests can often share one built fixture and diverge only in tamper steps.
- `cli-cold-start`: 4 tests, 17637 ms known duration
  CLI process startup and argument-routing overlap.
- `api-server-boot`: 6 tests, 15972 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `smoke-wiring`: 9 tests, 2563 ms known duration
  Smoke suites should stay thin and avoid chaining lower-level contract tests.

## Top Slowest Tests

- `retrieval/filters/search-filter-contract-matrix`: 59026 ms
  family: `retrieval/filters`
- `storage/sqlite/search-backend-contract-matrix`: 50157 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `cli/search/contract-matrix`: 40044 ms
  family: `cli/search`
  hotspot: `search-cli-contract`
- `storage/sqlite/maintenance-contract-matrix`: 39600 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `indexing/chunking/comment-join`: 37512 ms
  family: `indexing/chunking`
  hotspot: `index-build-heavy`
- `services/api-search-asof`: 37201 ms
  family: `services/api-search-asof`
- `retrieval/cache/query-cache-contract-matrix`: 36245 ms
  family: `retrieval/cache`
- `indexing/incremental/tokenization-cache`: 35143 ms
  family: `indexing/incremental`
  hotspot: `index-build-heavy`
- `storage/sqlite/index-state-fail-closed`: 33678 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `indexing/piece-assembly/core`: 33522 ms
  family: `indexing/piece-assembly`
  hotspot: `index-build-heavy`

