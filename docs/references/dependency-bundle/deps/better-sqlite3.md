# `better-sqlite3`

**Area:** SQLite storage backend

## Why this matters for PairOfCleats
Fast synchronous SQLite access for building/searching persistent indexes (including FTS5 and optional ANN extensions).

## Implementation notes (practical)
- Use prepared statements and explicit transactions for bulk loads.
- Tune pragmas (WAL, synchronous, cache_size, temp_store) based on workload and durability requirements.

## Where it typically plugs into PairOfCleats
- Persist postings, metadata, and chunk text/offsets; enable `--with-sqlite` build pipeline.

## Deep links (implementation-relevant)
1. API docs (transactions, pragmas, prepared statements) — https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
2. Performance guide (WAL, pragmas, patterns) — https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md

## Suggested extraction checklist
- [ ] Define artifact formats and version them (schema/version header + migration plan).
- [ ] Ensure determinism: stable ordering, stable encodings, stable hashing inputs.
- [ ] Measure: write/read throughput and artifact size; record p95/p99 for bulk load.
- [ ] Plan for corruption detection (hashes) and safe partial rebuilds.