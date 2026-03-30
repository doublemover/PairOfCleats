# Lane Evidence

Generated: 2026-03-30T08:30:57.757Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 15s
  fresh artifacts: `.testLogs/gate-testRunTimes.txt`
- `ci-lite`: 769 tests, 769 with timings, 1267565 ms known duration, p50=697 ms, p95=7747 ms, target 15s
  fresh artifacts: `.testLogs/ci-lite-testRunTimes.txt`
- `ci`: 121 tests, 121 with timings, 2499603 ms known duration, p50=19440 ms, p95=36826 ms, target 60s
  fresh artifacts: `.testLogs/ci-testRunTimes.txt`
- `ci-long`: 18 tests, 18 with timings, 514398 ms known duration, p50=30172 ms, p95=57083 ms, target 180s
  fresh artifacts: `.testLogs/ci-long-testRunTimes.txt`

## Exact Cross-Lane Duplicates

- None

## Top Families

- `storage/sqlite`: 62 tests, 556557 ms known duration
- `tooling/lsp`: 79 tests, 321619 ms known duration
- `cli/search`: 7 tests, 162058 ms known duration
- `indexing/embeddings`: 31 tests, 152057 ms known duration
- `retrieval/filters`: 5 tests, 150709 ms known duration
- `services/api`: 6 tests, 133838 ms known duration
- `indexing/incremental`: 5 tests, 95057 ms known duration
- `indexing/extracted-prose`: 6 tests, 90407 ms known duration
- `indexing/imports`: 32 tests, 88219 ms known duration
- `tooling/reports`: 5 tests, 77644 ms known duration
- `indexing/artifacts`: 37 tests, 70653 ms known duration
- `tooling/doctor`: 14 tests, 69461 ms known duration
- `indexing/chunking`: 11 tests, 69350 ms known duration
- `indexing/watch`: 15 tests, 68546 ms known duration
- `indexing/tree-sitter`: 26 tests, 66984 ms known duration

## Setup Hotspots

- `index-build-heavy`: 354 tests, 1282866 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `sqlite-heavy`: 62 tests, 556557 ms known duration
  SQLite maintenance, fail-closed, and migration tests often rebuild the same sample fixture.
- `lsp-bootstrap`: 79 tests, 321619 ms known duration
  Dedicated/configured provider bootstrap and session reuse.
- `search-cli-contract`: 7 tests, 162058 ms known duration
  Search CLI help, explain, and contract surfaces share fixture/index bootstrap.
- `embeddings-cache`: 31 tests, 152057 ms known duration
  Embedding cache and stub fast-path families frequently overlap on the same fixture/setup.
- `api-server-boot`: 6 tests, 133838 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `smoke-wiring`: 9 tests, 122254 ms known duration
  Smoke suites should stay thin and avoid chaining lower-level contract tests.
- `map-build`: 4 tests, 55731 ms known duration
  Code-map suites often share the same repo build and render pipeline.
- `cli-cold-start`: 4 tests, 43438 ms known duration
  CLI process startup and argument-routing overlap.
- `lmdb-report`: 2 tests, 36576 ms known duration
  LMDB report/corruption tests can often share one built fixture and diverge only in tamper steps.

## Top Slowest Tests

- `retrieval/filters/search-filter-contract-matrix`: 57083 ms
  family: `retrieval/filters`
- `storage/sqlite/search-backend-contract-matrix`: 44645 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `indexing/file-caps/contract-matrix`: 39572 ms
  family: `indexing/file-caps`
  hotspot: `index-build-heavy`
- `cli/search/contract-matrix`: 38962 ms
  family: `cli/search`
  hotspot: `search-cli-contract`
- `storage/sqlite/ann/sqlite-fallback`: 37741 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `map/build-contract-matrix`: 37576 ms
  family: `map/build-contract-matrix`
- `indexing/map/code-map-contract-matrix`: 37511 ms
  family: `indexing/map`
  hotspot: `map-build`
- `indexing/runtime/two-stage-state`: 36965 ms
  family: `indexing/runtime`
  hotspot: `index-build-heavy`
- `cli/search/ann-rrf-contract`: 36903 ms
  family: `cli/search`
  hotspot: `search-cli-contract`
- `indexing/artifacts/artifact-size-guardrails`: 36826 ms
  family: `indexing/artifacts`
  hotspot: `index-build-heavy`

