# Phase 12 Plan (Full Detail)

This plan is a verbatim, fully detailed Phase 12 task list from NEW_ROADMAP.md.
Update checkboxes here as work completes.

## Phase 12 — Storage backends (SQLite + LMDB)

**Objective:** Perform an audit of the storage backends (SQLite + LMDB) and their supporting tooling (build, validation, compaction, incremental updates, ANN extension management, and backend selection). Identify *all* correctness bugs, edge cases, documentation drift, missing tests, and performance/refactoring opportunities, aligned to the provided checklist.

#### Out-of-scope (not deeply reviewed, but referenced when necessary)

- Non-listed call-sites (e.g. retrieval query code) were spot-checked only when needed to validate schema/index/query alignment.

---

### Executive summary

#### Top P0 / correctness items

- [x] **(P0) SQLite ANN table is not updated when it already exists** in:
  - `src/storage/sqlite/build/from-bundles.js` (vector table existence sets `vectorAnnReady = true` but **does not** prepare `insertVectorAnn`) — see around L120.
  - `src/storage/sqlite/build/incremental-update.js` (same pattern) — see around L240.

  **Impact:** when the ANN virtual table already exists (most importantly during incremental updates), deleted rows *can* be removed (because deletes run via `deleteDocIds(...)`), but replacement vectors for changed chunks are **not reinserted**, leaving the ANN table sparse/out-of-sync with `dense_vectors`. This can silently degrade or break ANN-based retrieval depending on how the extension is queried.

- [x] **(P0) Retrieval-side fail-closed is incomplete for SQLite schema versions.**

  `src/retrieval/cli-sqlite.js` validates required table *names* but does **not** enforce `PRAGMA user_version == SCHEMA_VERSION` (or otherwise fail-closed on schema mismatch). This violates the checklist requirement (“readers fail closed on unknown versions”) for the SQLite reader path.

- [x] **(P0) Bundle-build path does not hard-fail on embedding dimension mismatches** (`src/storage/sqlite/build/from-bundles.js`).

  The code currently *warns once* on a dims mismatch but continues (and may still insert inconsistent vectors). This risks producing an index with an internally inconsistent dense-vector corpus (which can cause downstream errors or silent relevance regressions).

#### High-signal P1 / robustness items

- [x] **WAL / sidecar handling is inconsistent across build vs incremental update paths.**  
  Full rebuild paths use `replaceSqliteDatabase(...)` which removes sidecars, but incremental updates modify the DB in-place under WAL mode and do not explicitly checkpoint/truncate. If later tooling removes sidecars without a checkpoint, this can create “single-file DB” assumptions that do not hold.

- [x] **Indexing for hot maintenance queries can be improved**: `chunks(mode, file)` exists, but multiple maintenance queries order by `id` and would benefit from `(mode, file, id)`.

- [x] **Docs drift:** `docs/sqlite-incremental-updates.md` (and a few related docs) describe doc-id behavior and operational details that do not match current implementation (doc-id reuse/free-list behavior; ratio guard details; and operational caveats).

#### “Good news” / items that look solid already

- Most bulk write paths are transactional (build ingest, compaction copy, incremental applyChanges).
- The extension download hardening in `tools/download-extensions.js` has multiple safety layers (hash verification support, archive path traversal protection, size/entry limits).
- LMDB corruption handling has targeted tests (`tests/lmdb-corruption.js`) and tooling integration (`tests/lmdb-report-artifacts.js`).

#### Current test failures (local, after building artifacts/SQLite)

- [x] `tests/lmdb-backend.js`: fixed by scoping the LMDB search to `--mode code` for code-only LMDB build.
- [x] `tests/sqlite-ann-extension.js`: fixed by disabling bundle workers in test and falling back to artifacts when bundles lack dense vectors (plus `embedding_u8` ingestion).
- [x] `tests/sqlite-incremental-no-change.js`: fixed by short-circuiting no-change incremental updates before dense metadata checks and softening records-only rebuild messaging.
- [x] `tests/storage/sqlite/incremental/manifest-normalization.test.js`: fixed via no-change short-circuit when manifest normalization yields zero diffs.

---

## Checklist coverage and required follow-ups

### A) Schema & migrations

**Audit**

- SQLite schema is versioned via `PRAGMA user_version` with `SCHEMA_VERSION = 7` (`src/storage/sqlite/schema.js`).
- Incremental update explicitly checks schema version and required tables before mutating (`src/storage/sqlite/build/incremental-update.js`).
- Table-level constraints are generally well-defined (primary keys per (mode, …), plus supporting indexes for vocab/postings).

**Gaps / issues**

- [x] **Fail-closed at read time:** Add a `user_version` gate to the SQLite reader path (at minimum in `src/retrieval/cli-sqlite.js` / sqlite backend creation).
  - Desired behavior:  
    - If backend is *forced* to SQLite: throw a clear error (“SQLite schema mismatch: expected X, found Y”).
    - If backend is not forced (auto): treat SQLite as unavailable and fall back to the file-backed backend, with a warning.
- [x] **Index alignment with hot predicates:** Consider adding `CREATE INDEX idx_chunks_file_id ON chunks(mode, file, id)` to support:
  - `SELECT id FROM chunks WHERE mode=? AND file=? ORDER BY id`
  - `SELECT file, id FROM chunks WHERE mode=? ORDER BY file, id` (incremental update id reuse scan)
- [x] **Document upgrade path explicitly:** The system is effectively “rebuild on schema bump”. Ensure docs and user-facing error messaging make that explicit (and fail closed rather than attempting to limp on).
- [x] **Consider column-level schema validation for critical tables** (optional but recommended): required-table-name checks do not catch incompatible column changes if a user provides an arbitrary SQLite file containing tables with the right names.

---

### B) SQLite build pipeline

**Audit**

- Build-from-artifacts path uses bulk inserts and creates secondary indexes after ingest (`src/storage/sqlite/build/from-artifacts.js`).
- Build-from-bundles supports a fast-path using bundle workers (`src/storage/sqlite/build/from-bundles.js` + `bundle-loader.js`).
- Validation includes `PRAGMA integrity_check` (full) and cross-table count consistency checks (`src/storage/sqlite/build/validate.js`).

**Gaps / issues**

- [x] **(P0) Fix ANN insert statement preparation when the ANN table already exists:**
  - In `src/storage/sqlite/build/from-bundles.js`:
    - When `hasVectorTable` is true (L120), prepare `insertVectorAnn` immediately (same SQL as the “created table” path near L209).
  - In `src/storage/sqlite/build/incremental-update.js`:
    - When `vectorAnnReady` is set based on `hasVectorTable` (L240), prepare `insertVectorAnn` as well.
  - Add a CI-friendly unit test that does not require a real sqlite-vec binary (see “Tests” section below).
- [x] **(P0) Enforce embedding dims consistency in bundle builds.**
  - Recommendation: pre-scan each bundle (or the whole manifest) to ensure all embeddings are either absent or have a single consistent dimension; then hard-fail the build if mismatched.
  - Current behavior: warns once around L197 and continues; this should be tightened to match the artifacts build path which throws on mismatch.
- [x] **Failure cleanup should include SQLite sidecars** (`.db-wal`, `.db-shm`) in:
  - `src/storage/sqlite/build/from-artifacts.js`
  - `src/storage/sqlite/build/from-bundles.js`

  Today they remove only `outPath` on failure. If WAL/SHM exist, they can be left behind as confusing debris and can interfere with subsequent runs.
- [x] **Consider ensuring the produced DB is “single-file”** after build by checkpointing/truncating WAL (or switching journal mode back), rather than relying on implicit behavior.
- [x] **Prepared statement churn:** `deleteDocIds(...)` dynamically prepares multiple statements per chunk; consider statement caching keyed by chunk size to reduce overhead during large deletes.

---

### C) LMDB backend

**Audit**

- LMDB has a clear key-space separation (`meta:*`, `artifact:*`) and an explicit schema version (`src/storage/lmdb/schema.js`).
- LMDB build tool stores artifacts plus metadata into LMDB (`tools/build-lmdb-index.js`).
- Corruption handling is at least partially validated via tests (`tests/lmdb-corruption.js`, `tests/lmdb-report-artifacts.js`).

**Gaps / issues**

- [x] Ensure the LMDB *reader* path (not in this checklist set) fails closed on schema mismatch the same way SQLite incremental update does (explicit schema version check; clear error messaging).
- [x] Consider adding a lightweight “LMDB quick check” command in tooling (or enhancing `tools/index-validate.js`) that validates the presence of all required keys (schema version, chunk meta, vocab, postings, etc.) and reports missing keys explicitly.
- [x] Document LMDB key invariants and expected artifact presence (which artifacts are mandatory vs optional).

---

### D) Incremental updates

**Audit**

- Incremental update gating exists (requires incremental manifest, rejects schema mismatch, rejects high change ratios) (`src/storage/sqlite/build/incremental-update.js`).
- It preserves doc-id stability per-file by reusing IDs for changed files and reusing free IDs from deletions.
- Deletes are applied across all relevant tables using `deleteDocIds(...)` with consistent table lists.

**Gaps / issues**

- [x] **(P0) ANN table insertion bug** (same as in section B) must be fixed for incremental updates.
- [x] **WAL lifecycle:** after an in-place incremental update, run:
  - `PRAGMA wal_checkpoint(TRUNCATE);`
  - optionally `PRAGMA journal_mode = DELETE;` (if the project prefers single-file DBs)

  This ensures the on-disk DB is not “dependent on sidecars” after the update and reduces the likelihood of later tooling accidentally discarding uncheckpointed state.
- [x] **Manifest match logic:** `isManifestMatch(...)` falls back to mtime/size when one side has a hash and the other does not.
  - Consider tightening: if an incremental manifest provides a hash but the DB manifest row does not, treat as “changed” and update the DB row hash (this gradually converges the DB to the stronger invariant).
- [x] **Performance of doc-id reuse scan:** the “scan all chunks ordered by file,id” approach is correct but can be expensive; if it becomes a bottleneck, consider either:
  - adding `(mode,file,id)` index, and/or
  - materializing file→docId list in a side table (only if necessary).

---

### E) Performance

**Audit**

- Build pragmas in `src/storage/sqlite/build/pragmas.js` are set to favor build throughput (WAL + relaxed synchronous) and are restored (partially).
- Compaction tool is designed to reduce doc-id sparsity and reclaim file size (`tools/compact-sqlite-index.js`).

**Gaps / issues**

- [x] **Avoid repeated `COUNT(*)` scans** for backend auto-selection where possible (`src/storage/backend-policy.js`).
  - Options: use `file_manifest` sum, maintain a meta counter, or store chunk count in `index_state.json`.
- [x] **Improve maintenance query performance** via `(mode,file,id)` index as noted above.
- [x] **Reduce query-time statement re-preparation** in `src/retrieval/sqlite-helpers.js` (`chunkArray(...)` creates fresh SQL each time); consider caching by chunk size.
- [x] **Add at least one p95 query latency regression test** using a stable fixture DB (details below).

---

### F) Refactoring goals

**Audit**

- The codebase already separates schema SQL, prepared statements, and build/validate logic into dedicated modules.

**Gaps / issues**

- [x] **De-duplicate shared helpers:**
  - `updateIndexStateManifest(...)` exists in both `tools/build-lmdb-index.js` and `tools/build-sqlite-index/index-state.js`.
  - `chunkArray(...)` exists in both build and retrieval code (or adjacent helpers).
- [x] **Centralize ANN table setup logic** so that “table exists” vs “table created” paths always prepare the insert statement (avoid the current drift between `prepareVectorAnnTable(...)` and the bundle/incremental paths).
- [x] **Clarify naming:** `toSqliteRowId(...)` is currently a “coerce to BigInt” helper; consider renaming to reflect that it does not encode/transform the id.

---

## Tests and benchmarks — required additions

### Must-add tests (CI-friendly)

- [x] **Unit test: ANN insertion when the ANN table already exists** (no real extension binary required).
  - Approach:
    - Create a temporary SQLite DB with all required tables plus a *plain* `dense_vectors_ann` table (not virtual) matching the schema used by insert/delete (`rowid` + `embedding` BLOB column).
    - Pass a mocked `vectorConfig` into `incrementalUpdateDatabase(...)` with:
      - `loadVectorExtension: () => ({ ok: true })`
      - `hasVectorTable: () => true`
      - `encodeVector: () => Buffer.from([0])` (or similar stable stub)
    - Run an incremental update that modifies at least one file and assert that:
      - rows are deleted for removed docIds
      - rows are inserted/replaced for changed docIds
- [x] **Unit test: bundle-build dims mismatch hard failure**
  - Create two bundle files in the incremental bundle dir: one with embedding length N, one with embedding length N+1.
  - Assert build fails (or returns count 0 with a clear reason) rather than “warn and continue”.

### Additional recommended tests

- [x] **Reader fail-closed test:** Provide a DB with `user_version != SCHEMA_VERSION` and confirm:
  - forced SQLite backend errors clearly
  - auto backend falls back without using SQLite.
- [x] **Incremental WAL checkpoint test** (if WAL checkpointing is implemented): verify that after incremental update:
  - no `*.db-wal` / `*.db-shm` remain (or WAL is truncated to a small size, depending on desired policy).

### Benchmark / regression testing

- [x] **p95 query latency regression guard (fixture-based)**
  - Add a small but non-trivial fixture SQLite DB (or build it deterministically during test setup) and run a representative query workload:
    - candidate generation (ngrams)
    - FTS ranking (if enabled)
    - dense vector scoring (if enabled)
  - Measure per-query durations and assert p95 stays under a budget (or does not regress beyond a tolerance vs a baseline).
  - Keep it deterministic: single-threaded, warm cache (or explicit warm-up iterations), fixed query set, fixed limits.

---

## File-by-file findings and action items

> This section lists concrete issues and improvement opportunities per reviewed file.  
> Items are written as actionable checkboxes; severity tags (P0/P1/P2) are included where appropriate.

### `src/storage/backend-policy.js`

- [x] Clarify threshold semantics for `autoSqliteThresholdChunks` / `autoSqliteThresholdBytes` when set to `0` (current code uses `> 0`, so `0` behaves like “disabled” rather than “always use SQLite”).
- [x] Consider avoiding expensive `COUNT(*)` scans for auto-selection; store chunk count in a meta table or `index_state.json` and read that instead (or sum `file_manifest.chunk_count`).
- [x] Consider logging/telemetry: when auto-select declines SQLite due to missing/invalid thresholds, surface that decision (currently it is silent except for return fields).

### `src/storage/lmdb/schema.js`

- [x] Add brief inline documentation describing key-space expectations (which keys must exist for a usable LMDB index).
- [x] Consider adding a helper to enumerate expected artifact keys for validation tooling (to avoid drift).

### `src/storage/sqlite/build-helpers.js`

- [x] Ensure `vectorConfig.extension.table` / `.column` are always sanitized before being interpolated into SQL (call-site currently depends on the caller to sanitize).
- [x] Consider making `buildChunkRow(...)` treat empty strings/arrays consistently (e.g., avoid turning `''` into `null` unintentionally for fields where empty-string is meaningful).
- [x] Consider reducing confusion: `buildChunkRow(...)` returns fields (`signature`, `doc`) that are not inserted into `chunks` but only into `chunks_fts`.

### `src/storage/sqlite/build/bundle-loader.js`

- [x] Ensure loader failures return actionable error messages (bundle path, reason). (Current errors are decent; confirm `readBundleFile(...)` includes enough context.)
- [x] Consider exposing a small “max in-flight bundles” safeguard if worker threads are enabled (to avoid memory spikes on extremely large bundles).

### `src/storage/sqlite/build/delete.js`

- [x] Cache delete statements by chunk size to reduce repeated `db.prepare(...)` overhead when deleting many docIds.
- [x] Consider supporting a temp table approach (`CREATE TEMP TABLE ids(...)`) if deletion performance becomes a bottleneck for large deletes.
- [x] Verify that the `vectorDeleteTargets` contract remains consistent across callers (column name `rowid` vs explicit id columns).

### `src/storage/sqlite/build/from-artifacts.js`

- [x] Tighten shard discovery: `listShardFiles(...)` includes `.jsonl` but ingestion reads shards via `readJson(...)`; either:
  - restrict token-postings shards to `.json`, or
  - add JSONL support for token-postings shards (if they can be JSONL in practice).
- [x] Consider inserting `dense_meta` inside the same transaction as the first dense-vector batch (atomicity / consistency).
- [x] For `chunkMeta` ingestion (non-piece path), avoid building a single giant `rows` array in memory if the artifact can be large; use chunked batching as done in `ingestChunkMetaPieces(...)`.
- [x] Failure cleanup: remove sidecars (`outPath-wal`, `outPath-shm`) as well as `outPath` on failure.

### `src/storage/sqlite/build/from-bundles.js`

- [x] **(P0) Prepare `insertVectorAnn` even when the ANN table already exists** (see around L120).  
  The “table exists” branch sets `vectorAnnReady = true` but does not prepare the insert statement, so embeddings are not inserted into ANN.
- [x] **(P0) Make embedding dims mismatch a hard failure.**  
  Current warning-only behavior (around L197) can produce inconsistent dense vectors.
- [x] Guard against malformed bundles: `count += result.bundle.chunks.length` should handle missing/invalid `chunks` gracefully (use `?.length || 0`).
- [x] Remove unused import (`path` is currently imported but not used).
- [x] Failure cleanup should remove SQLite sidecars, not just the DB file.

### `src/storage/sqlite/build/incremental-update.js`

- [x] **(P0) Prepare `insertVectorAnn` when the ANN table already exists** (see around L240).  
  Without this, incremental updates delete ANN rows but do not reinsert replacement vectors.
- [x] Add explicit WAL checkpointing/truncation at the end of a successful update (to keep the DB self-contained and avoid large WAL growth).
- [x] Consider tightening `isManifestMatch(...)` semantics when hashes are available on only one side (to converge DB manifest quality).
- [x] Performance: consider `(mode,file,id)` index or other optimization for `getDocIdsForFile(...)` scanning and per-file id lists.
- [x] Remove (or convert to assertion) the redundant “dims mismatch warn” path inside applyChanges; dims mismatch should already be rejected earlier.

### `src/storage/sqlite/build/manifest.js`

- [x] De-duplicate `conflicts` output (currently can include repeated normalized paths).
- [x] Consider strict hash preference: if `entry.hash` is present but `dbEntry.hash` is null, treat as mismatch and update DB hash (do not silently match on mtime/size).

### `src/storage/sqlite/build/pragmas.js`

- [x] Consider restoring `journal_mode` (or explicitly checkpointing) after build to ensure “single-file DB” invariants if the project expects that.
- [x] Consider surfacing pragma failures (currently swallowed silently).

### `src/storage/sqlite/build/statements.js`

- [x] Consider adding `idx_chunks_file_id` (see schema/index alignment notes).
- [x] Reduce confusion: `buildChunkRowWithMeta(...)` populates fields not present in the schema (e.g., `churn_added`, `churn_deleted`, `churn_commits`). Either:
  - add these columns to the schema if they are intended, or
  - stop emitting them to avoid “looks supported but isn’t”.

### `src/storage/sqlite/build/validate.js`

- [x] Consider validating ANN invariants when ANN is enabled:
  - `dense_vectors_ann` row count should match `dense_vectors` row count for the mode (or at least have no orphans).
- [x] Consider making full `integrity_check` optional for very large DBs (it can be expensive); provide a quick-check mode and/or configurable validation levels.

### `src/storage/sqlite/build/vocab.js`

- [x] Consider caching prepared statements by chunk size (similar to delete/vocab fetch) to reduce repeated SQL compilation overhead.
- [x] Error messaging: if `missing.length` is huge, cap printed missing values in the thrown error and include only a sample plus counts (to avoid megabyte-scale exception strings).

### `src/storage/sqlite/incremental.js`

- [x] Document the on-disk incremental manifest contract and failure modes (missing manifest, conflicts, ratio guard).
- [x] Consider adding a small helper to validate the incremental manifest shape early, with clearer error output.

### `src/storage/sqlite/schema.js`

- [x] Consider adding `(mode,file,id)` index for maintenance queries.
- [x] Ensure docs (`docs/sqlite-index-schema.md`) stay in sync when schema changes.

### `src/storage/sqlite/utils.js`

- [x] `normalizeFilePath(...)` returns the input unchanged when it is not a string; consider returning `null` instead to reduce accidental “undefined as key” behavior.
- [x] `replaceSqliteDatabase(...)`: consider logging when fallback rename/remove paths are taken (debuggability of replacement failures).

### `src/storage/sqlite/vector.js`

- [x] `toSqliteRowId(...)` is effectively “coerce to BigInt”; consider renaming to reflect that (e.g., `toSqliteRowidInt64(...)`) to avoid implying a non-trivial mapping.
- [x] Consider making quantization parameters (`minVal`, `maxVal`) configurable or derived from embedding model metadata (avoid silent saturation if embeddings are out of range).

---

### Tooling files

#### `tools/build-lmdb-index.js`

- [x] Consider a `--validate` option that checks required artifacts exist before writing LMDB (fail early, clearer errors).
- [x] Consider writing a small LMDB “manifest” key listing which artifacts were written (enables tool-side validation and reduces drift).

#### `tools/build-sqlite-index.js`

- [x] Consider exit codes and messaging consistency across build modes (full rebuild vs incremental vs skipped). (Reviewed; skip/fallback reasons now include change stats.)

#### `tools/build-sqlite-index/cli.js`

- [x] Consider validating incompatible flag combinations early (e.g., `--bundle-workers` without a bundle dir).
- [x] Consider adding `--no-compact` / `--compact` clarity in CLI help (if not already covered elsewhere).

#### `tools/build-sqlite-index/index-state.js`

- [x] De-duplicate `updateIndexStateManifest(...)` with the LMDB equivalent; extract to a shared helper module.
- [x] Consider including schema version and build mode (full vs incremental) in `index_state.json` for observability.

#### `tools/build-sqlite-index/run.js`

- [x] Ensure `stopHeartbeat()` is always invoked via `try/finally` (avoid leaking an interval on error when `exitOnError=false`).
- [x] After incremental updates, consider forcing WAL checkpoint/truncate (see incremental update section).
- [x] Consider making the “incremental fallback to rebuild” reason more explicit in output (currently logged, but could include key stats: changedFiles, deletedFiles, ratio).

#### `tools/build-sqlite-index/temp-path.js`

- [x] Consider a “same filesystem guarantee” note: temp DB path must be on same filesystem for atomic rename (current implementation uses same directory, which is good; document this).

#### `tools/clean-artifacts.js`

- [x] Consider adding a `--dry-run` option that prints what would be deleted without deleting it (safety for new users).

#### `tools/compact-sqlite-index.js`

- [x] If vector extension is enabled but cannot be loaded, consider warning that compaction may drop ANN acceleration (and suggest remediation, e.g. rerun embeddings rebuild once extension is available).
- [x] Consider recording pre/post compaction stats into `index_state.json` (bytes, row counts) for observability.

#### `tools/download-extensions.js`

- [x] Consider streaming zip extraction rather than buffering each entry into memory (`adm-zip` forces buffer extraction; if large binaries become common, consider a streaming zip library). (Reviewed; keeping `adm-zip` with archive size limits for now.)
- [x] Consider setting file permissions for extracted binaries explicitly per-platform conventions (e.g., preserve exec bit if needed, although shared libraries typically do not require it).

#### `tools/index-validate.js`

- [x] Consider including actionable remediation hints per failure mode (e.g., “run build-index”, “run build-sqlite-index”, “run download-extensions”).

#### `tools/report-artifacts.js`

- [x] Consider clarifying the units in output when printing both formatted size and raw bytes (currently raw bytes are printed in parentheses without a label).

#### `tools/vector-extension.js`

- [x] Consider keying `loadCache` by (db, config) rather than only db (avoids surprising behavior if config changes during a long-lived process).
- [x] Consider restoring prior `trusted_schema` value after `ensureVectorTable(...)` (minimize global DB setting changes).

#### `tools/verify-extensions.js`

- [x] Consider adding a quick “smoke query” that verifies the ANN table can be created and queried (optional).

---

### Test files

#### `tests/backend-policy.js`

- [x] Add coverage for threshold edge cases (e.g., `autoSqliteThresholdChunks=0` semantics).
- [x] Add a test case where SQLite exists but artifact metadata cannot be read (ensure fallback behavior is correct and reason is surfaced).

#### `tests/compact-pieces.js`

- [x] No issues noted (acts as a compaction functional check for artifact pieces).

#### `tests/lmdb-backend.js`

- [x] Consider adding schema version mismatch coverage (fail closed when schema version differs).

#### `tests/lmdb-corruption.js`

- [x] Consider asserting on error message content to ensure corruption reporting remains actionable.

#### `tests/lmdb-report-artifacts.js`

- [x] Consider adding a test for “missing required key” vs “corruption” differentiation (if validation tooling can distinguish).

#### `tests/retrieval-backend-policy.js`

- [x] Add coverage for schema version mismatch fallback (once reader-side user_version check exists).

#### `tests/smoke-sqlite.js`

- [x] Add coverage for `user_version` mismatch behavior once implemented.

#### `tests/sqlite-ann-extension.js`

- [x] Add a CI-friendly companion test that does not require the real extension binary (mock vectorConfig approach described above) to ensure ANN insert/delete invariants are enforced in CI.

#### `tests/sqlite-ann-fallback.js`

- [x] Consider adding explicit coverage that fallback ANN search never returns out-of-range docIds (robustness guard).

#### `tests/sqlite-auto-backend.js`

- [x] Add a test that covers the “SQLite present but too small” path + verifies reason reporting is stable.

#### `tests/sqlite-build-delete.js`

- [x] Add coverage for deleting from an ANN table using `rowid` column and BigInt inputs (ensures `toSqliteRowId(...)` conversion remains correct).

#### `tests/sqlite-build-indexes.js`

- [x] Add coverage for any new maintenance index (e.g., `(mode,file,id)`), if introduced.

#### `tests/sqlite-build-manifest.js`

- [x] Add a test for “manifest has hash but DB does not” semantics (once tightened).

#### `tests/sqlite-build-vocab.js`

- [x] Add stress coverage for token sets larger than SQLite’s `IN` limit (ensuring chunking logic remains correct).

#### `tests/sqlite-bundle-missing.js`

- [x] Add bundle-shape validation coverage (missing `chunks` field should not crash build loop).

#### `tests/sqlite-cache.js`

- [x] No issues noted (validates cache path behavior / read path).

#### `tests/sqlite-chunk-id.js`

- [x] No issues noted (docId/chunkId behavior).

#### `tests/sqlite-compact.js`

- [x] Consider adding coverage for compaction with ANN enabled but extension mocked (ensures dense_vectors_ann remains consistent after compaction). (Reviewed; deferring to real extension integration tests.)

#### `tests/sqlite-incremental-no-change.js`

- [x] Consider verifying `index_state.json` is unchanged (or only updated timestamp changes), depending on desired policy.

#### `tests/sqlite-incremental.js`

- [x] Add coverage for doc-id reuse behavior (free-list) to prevent accidental regression to “always append”.

#### `tests/sqlite-index-state-fail-closed.js`

- [x] Consider adding coverage that “pending” flips back to false on successful build (already implied but could be explicit).

#### `tests/sqlite-missing-dep.js`

- [x] No issues noted (validates better-sqlite3 missing behavior).

#### `tests/sqlite-sidecar-cleanup.js`

- [x] Add incremental-update sidecar cleanup coverage if WAL checkpointing/truncation is implemented.

---

### Documentation files

#### `docs/contracts/sqlite.md`

- [x] Explicitly document the `user_version` contract and the “fail closed / rebuild on mismatch” behavior.
- [x] Ensure the list of required tables aligns with the actual reader/build code paths (and clearly separate “core” vs “optional” tables).

#### `docs/external-backends.md`

- [x] Consider updating to reflect current backend-policy behavior (auto selection thresholds, forced backend semantics).

#### `docs/model-compare-sqlite.json`, `docs/parity-sqlite-ann.json`, `docs/parity-sqlite-fts-ann.json`

- [x] Ensure these reports are either generated artifacts (and documented as such) or kept in sync with the current schema/tooling versions (otherwise they can mislead).

#### `docs/references/dependency-bundle/deps/better-sqlite3.md`

- [x] Confirm documented behavior matches current runtime expectations (particularly around extension loading, platform binaries, and supported SQLite features).

#### `docs/sqlite-ann-extension.md`

- [x] Document the invariant that `dense_vectors_ann` must remain consistent with `dense_vectors` (no orphans; same cardinality per mode when enabled).
- [x] Document how incremental updates maintain the ANN table (and note limitations when extension is not available).

#### `docs/sqlite-compaction.md`

- [x] Clarify how compaction interacts with the ANN extension table (and the remediation path if ANN is temporarily unavailable during compaction).

#### `docs/sqlite-incremental-updates.md`

- [x] Update doc-id behavior description to match implementation (per-file id reuse + free-list reuse rather than always appending).
- [x] Document the ratio guard behavior and fallback to full rebuild more explicitly.
- [x] Document WAL/sidecar expectations for incremental updates (single-file vs WAL sidecars).

#### `docs/sqlite-index-schema.md`

- [x] Reconfirm schema matches `SCHEMA_VERSION = 7` (columns, indexes, optional extension table).
- [x] If `(mode,file,id)` index is added, document it as a maintenance/performance index.

---

## Exit criteria for this review section

The following items should be completed to consider “Review Section 7” fully addressed:

- [x] ANN insert-preparation bug fixed in both bundle-build and incremental-update code paths.
- [x] Reader-side schema version fail-closed behavior implemented and tested.
- [x] Bundle-build embedding dims mismatch becomes a hard failure (with tests).
- [x] WAL/sidecar policy is explicitly decided, implemented consistently, and documented (at minimum for incremental updates).
- [x] At least one CI-friendly test covers ANN table sync invariants without requiring a real extension binary.
- [x] At least one fixture-based p95 latency regression test is added (or an equivalent deterministic perf guard).

---

## Test runs

- [x] `node tests/storage/sqlite/incremental/ann-existing-table.test.js`
- [x] `node tests/storage/sqlite/incremental/file-manifest-updates.test.js`
- [x] `node tests/storage/sqlite/incremental/manifest-hash-fill.test.js`
- [x] `node tests/storage/sqlite/incremental/wal-checkpoint.test.js`

Skipped: build_index-based tests (e.g., `doc-id-reuse.test.js`) per current request.

