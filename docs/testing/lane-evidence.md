# Lane Evidence

Generated: 2026-03-30T00:03:33.390Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, target 15s
  fresh artifacts: `.testLogs/gate-testRunTimes.txt`
- `ci-lite`: 770 tests, 770 with timings, 1232069 ms known duration, target 15s
  fresh artifacts: `.testLogs/ci-lite-testRunTimes.txt`
- `ci`: 119 tests, 108 with timings, 2185627 ms known duration, target 60s
  fresh artifacts: `.testLogs/ci-testRunTimes.txt`
- `ci-long`: 18 tests, 18 with timings, 1242951 ms known duration, target 180s
  fresh artifacts: `.testLogs/ci-long-testRunTimes.txt`

## Exact Cross-Lane Duplicates

- None

## Top Families

- `storage/sqlite`: 62 tests, 766167 ms known duration
- `tooling/lsp`: 79 tests, 299621 ms known duration
- `cli/search`: 6 tests, 181817 ms known duration
- `services/api`: 6 tests, 174907 ms known duration
- `retrieval/filters`: 5 tests, 169950 ms known duration
- `storage/lmdb`: 2 tests, 131904 ms known duration
- `indexing/embeddings`: 31 tests, 119740 ms known duration
- `indexing/incremental`: 5 tests, 112519 ms known duration
- `indexing/determinism`: 5 tests, 91583 ms known duration
- `indexing/piece-assembly`: 2 tests, 89851 ms known duration
- `indexing/chunking`: 11 tests, 83169 ms known duration
- `indexing/imports`: 32 tests, 82722 ms known duration
- `indexing/extracted-prose`: 6 tests, 80404 ms known duration
- `retrieval/cache`: 2 tests, 79423 ms known duration
- `tooling/reports`: 5 tests, 75691 ms known duration

## Setup Hotspots

- `index-build-heavy`: 354 tests, 1344557 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `sqlite-heavy`: 62 tests, 766167 ms known duration
  SQLite maintenance, fail-closed, and migration tests often rebuild the same sample fixture.
- `lsp-bootstrap`: 79 tests, 299621 ms known duration
  Dedicated/configured provider bootstrap and session reuse.
- `search-cli-contract`: 6 tests, 181817 ms known duration
  Search CLI help, explain, and contract surfaces share fixture/index bootstrap.
- `api-server-boot`: 6 tests, 174907 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `lmdb-report`: 2 tests, 131904 ms known duration
  LMDB report/corruption tests can often share one built fixture and diverge only in tamper steps.
- `embeddings-cache`: 31 tests, 119740 ms known duration
  Embedding cache and stub fast-path families frequently overlap on the same fixture/setup.
- `cli-cold-start`: 4 tests, 72467 ms known duration
  CLI process startup and argument-routing overlap.
- `smoke-wiring`: 9 tests, 66675 ms known duration
  Smoke suites should stay thin and avoid chaining lower-level contract tests.
- `map-build`: 4 tests, 62746 ms known duration
  Code-map suites often share the same repo build and render pipeline.

