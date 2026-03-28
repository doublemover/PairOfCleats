# Lane Evidence

Generated: 2026-03-28T12:32:52.830Z

## How To Use

- Use this report before deleting or merging tests; cite the family, duplicate, and hotspot rows you relied on.
- Prefer consolidating repeated setup families before deleting deep-path edge cases.
- When a standalone test is removed, name the surviving owner suite that now covers the behavior.
- Prefer fresh lane timing artifacts when available; historical fallback rows are a stopgap, not a replacement for current lane measurements.
- Historical timing fallback source: `tools/test_times/TEST_TIMES.md`.

## Lane Summary

- `gate`: 35 tests, 0 with timings, 0 ms known duration, target 15s
  fresh artifacts: `.testLogs/gate-testRunTimes.txt`
- `ci-lite`: 1070 tests, 67 with timings, 17030 ms known duration, target 15s
  fresh artifacts: `.testLogs/ci-lite-testRunTimes.txt`
- `ci`: 141 tests, 21 with timings, 76590 ms known duration, target 60s
  fresh artifacts: `.testLogs/ci-testRunTimes.txt`
- `ci-long`: 100 tests, 26 with timings, 121470 ms known duration, target 180s
  fresh artifacts: `.testLogs/ci-long-testRunTimes.txt`

## Exact Cross-Lane Duplicates

- `tooling/lsp/provider-fidelity-coverage-contract` in ci-lite, ci-long

## Top Families

- `retrieval/filters`: 17 tests, 40020 ms known duration
- `storage/sqlite`: 65 tests, 35910 ms known duration
- `services/api`: 15 tests, 13420 ms known duration
- `tooling/triage`: 6 tests, 10970 ms known duration
- `indexing/chunking`: 11 tests, 10530 ms known duration
- `indexing/file-caps`: 5 tests, 10030 ms known duration
- `tooling/install`: 22 tests, 9670 ms known duration
- `indexing/shards`: 4 tests, 8870 ms known duration
- `indexing/file-processor`: 9 tests, 8370 ms known duration
- `indexing/imports`: 45 tests, 6050 ms known duration
- `indexing/type-inference`: 13 tests, 5700 ms known duration
- `cli/general`: 4 tests, 5410 ms known duration
- `indexing/runtime`: 12 tests, 5150 ms known duration
- `retrieval/ann`: 16 tests, 5140 ms known duration
- `lang/contracts`: 2 tests, 5030 ms known duration

## Setup Hotspots

- `index-build-heavy`: 484 tests, 82860 ms known duration
  Index construction, replay, and build-heavy setup overlap.
- `api-server-boot`: 15 tests, 13420 ms known duration
  HTTP server startup, routing, and streaming harness reuse.
- `cli-cold-start`: 16 tests, 5410 ms known duration
  CLI process startup and argument-routing overlap.
- `lsp-bootstrap`: 117 tests, 0 ms known duration
  Dedicated/configured provider bootstrap and session reuse.

