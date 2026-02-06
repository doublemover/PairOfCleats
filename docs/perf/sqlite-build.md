# SQLite Build Performance

This document describes the current performance strategy for Stage4 (SQLite build) and how to interpret the build telemetry.

## Scope
- Applies to artifact builds (`build-from-artifacts`) and incremental bundle builds (`build-from-bundles`).
- Applies to incremental updates (`incremental-update`) when reusing an existing SQLite DB.
- May change SQLite schema (`PRAGMA user_version`) as performance work lands; incremental updates refuse to modify schema-mismatched DBs and fall back to full rebuild.

## Transaction Boundary
Full builds (`build-from-artifacts`, `build-from-bundles`) run inside one explicit `BEGIN`/`COMMIT` spanning:
- All ingestion inserts
- `CREATE_INDEXES_SQL` (index creation)

This keeps the build atomic and avoids accidental autocommit islands during ingestion. (Stage4 still builds to a temp DB path and swaps only after validation.)

## Build Pragmas
SQLite build pragmas are applied during Stage4 to improve throughput and bound WAL growth. Pragmas are restored after build completion.
For artifact builds, pragmas/optimize are enabled only when input bytes exceed 128MB unless explicitly overridden.

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

Override:
- CLI: `node build_index.js --sqlite-batch-size <n>` (applies to Stage4)

## Statement Strategy
- Full rebuilds use `INSERT` (fail-fast on duplicates) rather than `INSERT OR REPLACE`.
- Incremental updates may use `INSERT OR REPLACE` where needed.

Hot tables use multi-row prepared inserts by default (`statementStrategy=multi-row`) to reduce per-row `stmt.run()` overhead:
- `token_vocab`, `token_postings`, `doc_lengths`
- `phrase_vocab`, `phrase_postings`
- `chargram_vocab`, `chargram_postings`

Microbench (synthetic 100k chunks, 100k token_postings rows) showed:
- `token_postings` ingest throughput improved ~2.4x
- End-to-end `buildDatabaseFromArtifacts` wall time improved ~10%

## Row Shape (WITHOUT ROWID)
The SQLite schema uses `WITHOUT ROWID` for lookup-heavy tables with composite PRIMARY KEYs to reduce size and keep PK lookups clustered:
- `token_vocab`, `token_postings`, `doc_lengths`, `token_stats`
- `phrase_vocab`, `phrase_postings`
- `chargram_vocab`, `chargram_postings`
- `minhash_signatures`
- `dense_vectors`, `dense_meta`
- `file_manifest`

Because PRIMARY KEY/UNIQUE indexes already cover the common access patterns, Stage4 avoids creating redundant secondary indexes on PRIMARY KEY prefixes for these tables.

## Post-build Optimization
After indexes are created, Stage4 runs:
- `INSERT INTO chunks_fts(chunks_fts) VALUES('optimize')` (FTS segment compaction, best-effort)
- `PRAGMA optimize`
- `ANALYZE` when input size exceeds the adaptive threshold

## FTS Strategy
The Stage4 schema makes `chunks_fts` contentless (`content=''`) so the FTS table does not store a second copy of chunk text.
To keep incremental deletes working, we enable `contentless_delete=1` and rely on deletes by `rowid`.

Runtime note: contentless FTS is ranking-only; column reads from `chunks_fts` return `NULL` and query code must join against `chunks`/`chunk_meta` artifacts when it needs display text.

## Telemetry
Stage4 telemetry is captured in:
- `metrics/stage-audit-<mode>.json`
- `index_state.json` under `sqlite.stats`

Fields recorded for build telemetry:
- `inputBytes`
- `batchSize`
- `statementStrategy`
- `transaction` (explicit begin/commit/rollback counts for full builds)
- `prepare.total` (number of `db.prepare()` calls during build; should not scale with shard count)
- `multiRow` (per-table multi-row statement prepare/run counters when enabled)
- `ftsOptimize` (whether FTS optimize ran + duration and any error string)
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

Each script accepts `--mode` with one of:
- `compare` (default) runs baseline + current and prints a delta
- `baseline` runs the legacy path only (no build pragmas / no optimize)
- `current` runs the optimized path only

Each benchmark should report:
- Input bytes, wall-clock time, and rows/sec per table
- Peak RSS when available
- WAL size before/after build
