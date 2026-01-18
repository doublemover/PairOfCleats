# SQLite Incremental Updates

## Goal
Update SQLite indexes in-place by touching only the files that changed since the last run.

## Inputs
- Per-file incremental cache from `build_index.js --incremental`.
- Existing SQLite DBs at the current build root, e.g. `<cache>/repos/<repoId>/builds/<buildId>/index-sqlite/index-code.db` and `index-prose.db` (resolved via `builds/current.json`, unless overridden).

## Incremental manifest contract
- Manifest path: `<cache>/repos/<repoId>/incremental/<mode>/manifest.json`.
- Expected shape:
  - `files`: map of file path -> metadata.
  - File entry fields:
    - `bundle` (required): bundle filename under `<cache>/repos/<repoId>/incremental/<mode>/files/`.
    - `hash` (preferred): content hash for strict change detection.
    - `mtimeMs` and `size`: fallbacks when hash is unavailable.
- Paths are normalized to `/` before comparison.

## Schema Additions
- `file_manifest` table tracks per-file hashes and sizes used for change detection.
- `idx_chunks_file` speeds `file -> doc_id` lookups during deletes.
- File paths are normalized to forward slashes in SQLite to match the manifest keys.

## Update Flow
1. Load incremental manifest for the mode (`<cache>/repos/<repoId>/incremental/<mode>/manifest.json`).
2. Compare manifest entries to `file_manifest` rows.
   - If the manifest supplies a hash and the DB row lacks one (but mtime/size match), update the hash in-place without reindexing.
3. For deleted files: remove doc_ids across all tables (`chunks`, `chunks_fts`, postings, vectors, signatures, plus vector tables when enabled).
4. For changed files:
   - Delete existing doc_ids.
   - Insert new chunk rows using bundle data.
   - Insert postings and vectors for the new doc_ids (and vector extension rows when enabled).
5. Update `file_manifest` rows for changed files and remove deleted entries.
6. Recompute `token_stats` from `doc_lengths`.

## Doc ID Strategy
- Incremental updates reuse existing `doc_id` values for files that changed.
- Freed `doc_id` values from deleted files are reused before appending after the current max.
- A full rebuild or compaction still produces the densest possible ID range.

## WAL Policy
- Incremental updates run `wal_checkpoint(TRUNCATE)` after applying changes to avoid long-lived WAL growth.
- Full rebuilds also run `wal_checkpoint(TRUNCATE)` after validation to keep the output DB self-contained.
- The DB remains in WAL mode; conversion back to a single-file DB (`journal_mode=DELETE`) is deferred to a later maintenance/compaction phase.

## Usage
- Build incremental cache: `pairofcleats index build --incremental`.
- Update SQLite in place: `pairofcleats sqlite build --incremental`.
- Override target build root: `pairofcleats sqlite build --incremental --index-root <path>`.
- `pairofcleats bootstrap --incremental --with-sqlite` runs both.
- `--validate <off|smoke|full>` controls post-build SQLite validation (default: `smoke`).

## Fallback Behavior
If the incremental manifest or required SQLite tables are missing, the tool falls back to a full rebuild.
If a manifest exists, full rebuilds automatically stream from incremental bundles instead of loading `chunk_meta.json`.
If bundle streaming fails (missing bundle, invalid payload, dims mismatch), the rebuild logs a warning and falls back to file-backed artifacts. If file-backed artifacts are missing or invalid, the rebuild fails.
Full rebuilds also trigger when:
- The manifest is empty or has conflicting paths (same file with different separators).
- `file_manifest` is empty while chunks exist (legacy DBs without per-file metadata).
- Change ratio exceeds 35% of tracked files (changed + deleted), computed as `(changed + deleted) / total manifest files`.
- Vocab growth exceeds maintenance limits for token/phrase/chargram tables.
- Dense vector metadata (model or dims) mismatches the incoming bundles.
- Bundle files are missing or invalid.

## Schema Mismatch Behavior
- Incremental updates refuse to modify SQLite DBs with a schema version mismatch and request a rebuild.
- SQLite readers fail closed on schema mismatch. If SQLite is forced, a clear error is raised; otherwise, the runtime falls back to file-backed indexes.

## Limitations
- Vocabulary tables keep old tokens/grams; they are not pruned on deletes.
- Doc ID gaps grow with frequent updates; rebuild to compact if needed.
- Large vocab growth or churn triggers a full rebuild to keep tables bounded.
