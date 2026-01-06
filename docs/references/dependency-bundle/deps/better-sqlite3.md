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
- [x] Define artifact formats and version them (see `docs/artifact-contract.md`; schema version lives in `src/storage/sqlite/schema.js` and `user_version` is set in `tools/build-sqlite-index.js`).
- [x] Ensure determinism: stable ordering, stable encodings, stable hashing inputs. (Chunk/doc IDs flow from deterministic `chunk_meta` ordering; shard lists are sorted in `tools/build-sqlite-index.js` `listShardFiles()`; paths normalized in `src/storage/sqlite/utils.js`.)
- [x] Measure: write/read throughput and artifact size; record p95/p99 for bulk load. (Track in `tests/sqlite-build-indexes.js`, `tests/sqlite-compact.js`, and bench runs.)
- [x] Plan for corruption detection (hashes) and safe partial rebuilds. (`src/index/validate.js` checks required tables; incremental rebuilds in `src/storage/sqlite/incremental.js`; rebuild/compact via `tools/compact-sqlite-index.js`.)
