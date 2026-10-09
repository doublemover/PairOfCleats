# Lane Evidence

Generated: 2026-10-09T06:10:03.283Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 15s
- `ci-lite`: 901 tests, 49 with timings, 27090 ms known duration, p50=190 ms, p95=2140 ms, target 15s
- `ci`: 121 tests, 22 with timings, 101770 ms known duration, p50=5020 ms, p95=5030 ms, target 60s
- `ci-long`: 18 tests, 3 with timings, 15060 ms known duration, p50=5020 ms, p95=5030 ms, target 180s
- `usr-full-conformance`: 11 tests, 0 with timings, 0 ms known duration, p50=n/a ms, p95=n/a ms, target 60s

## Exact Cross-Lane Duplicates

- None

## Top Families

- `storage/sqlite`: 68 tests, 25860 ms known duration
- `indexing/chunking`: 11 tests, 10530 ms known duration
- `tooling/triage`: 3 tests, 10060 ms known duration
- `indexing/shards`: 4 tests, 8870 ms known duration
- `indexing/file-processor`: 10 tests, 8370 ms known duration
- `tooling/install`: 14 tests, 8330 ms known duration
- `indexing/type-inference`: 14 tests, 5700 ms known duration
- `indexing/imports`: 33 tests, 5550 ms known duration
- `cli/general`: 6 tests, 5410 ms known duration
- `indexing/runtime`: 4 tests, 5040 ms known duration
- `lang/contracts`: 15 tests, 5030 ms known duration
- `indexing/language-fixture`: 1 tests, 5030 ms known duration
- `retrieval/ann`: 7 tests, 5020 ms known duration
- `retrieval/filters`: 5 tests, 5020 ms known duration
- `shared/encoding`: 3 tests, 5020 ms known duration

## Setup Hotspots

- `index-build-heavy`: 382 tests, 70250 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `sqlite-heavy`: 68 tests, 25860 ms known duration
  SQLite maintenance, fail-closed, and migration tests often rebuild the same sample fixture.
- `cli-cold-start`: 7 tests, 5410 ms known duration
  CLI process startup and argument-routing overlap.
- `api-server-boot`: 6 tests, 3400 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `embeddings-cache`: 33 tests, 60 ms known duration
  Embedding cache and stub fast-path families frequently overlap on the same fixture/setup.
- `lsp-bootstrap`: 91 tests, 0 ms known duration
  Dedicated/configured provider bootstrap and session reuse.
- `smoke-wiring`: 9 tests, 0 ms known duration
  Smoke suites should stay thin and avoid chaining lower-level contract tests.
- `search-cli-contract`: 8 tests, 0 ms known duration
  Search CLI help, explain, and contract surfaces share fixture/index bootstrap.
- `map-build`: 4 tests, 0 ms known duration
  Code-map suites often share the same repo build and render pipeline.
- `lmdb-report`: 2 tests, 0 ms known duration
  LMDB report/corruption tests can often share one built fixture and diverge only in tamper steps.

## Top Slowest Tests

- `indexing/runtime/two-stage-state`: 5040 ms
  family: `indexing/runtime`
  hotspot: `index-build-heavy`
- `indexing/chunking/comment-join`: 5030 ms
  family: `indexing/chunking`
  hotspot: `index-build-heavy`
- `indexing/language-fixture/postings-integrity`: 5030 ms
  family: `indexing/language-fixture`
  hotspot: `index-build-heavy`
- `lang/contracts/misc-buildfiles`: 5030 ms
  family: `lang/contracts`
- `storage/sqlite/incremental/file-manifest-updates`: 5030 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `storage/sqlite/migrations/schema-mismatch-rebuild`: 5030 ms
  family: `storage/sqlite`
  hotspot: `sqlite-heavy`
- `tooling/triage/context-pack`: 5030 ms
  family: `tooling/triage`
  hotspot: `index-build-heavy`
- `tooling/triage/records-index-and-search`: 5030 ms
  family: `tooling/triage`
  hotspot: `index-build-heavy`
- `cli/general/repo-root`: 5020 ms
  family: `cli/general`
  hotspot: `cli-cold-start`
- `indexing/chunking/formats/format-fidelity`: 5020 ms
  family: `indexing/chunking`
  hotspot: `index-build-heavy`

