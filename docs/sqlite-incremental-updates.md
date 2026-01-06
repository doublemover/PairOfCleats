# SQLite Incremental Updates

## Goal
Update SQLite indexes in-place by touching only the files that changed since the last run.

## Inputs
- Per-file incremental cache from `build_index.js --incremental`.
- Existing SQLite DBs at `<cache>/repos/<repoId>/index-sqlite/index-code.db` and `<cache>/repos/<repoId>/index-sqlite/index-prose.db` (unless overridden).

## Schema Additions
- `file_manifest` table tracks per-file hashes and sizes used for change detection.
- `idx_chunks_file` speeds `file -> doc_id` lookups during deletes.
- File paths are normalized to forward slashes in SQLite to match the manifest keys.

## Update Flow
1. Load incremental manifest for the mode (`<cache>/repos/<repoId>/incremental/<mode>/manifest.json`).
2. Compare manifest entries to `file_manifest` rows.
3. For deleted files: remove doc_ids across all tables (`chunks`, `chunks_fts`, postings, vectors, signatures, plus vector tables when enabled).
4. For changed files:
   - Delete existing doc_ids.
   - Insert new chunk rows using bundle data.
   - Insert postings and vectors for the new doc_ids (and vector extension rows when enabled).
5. Update `file_manifest` rows for changed files and remove deleted entries.
6. Recompute `token_stats` from `doc_lengths`.

## Doc ID Strategy
- Incremental updates assign new `doc_id` values by appending after the current max.
- This leaves gaps when files are deleted; a full rebuild compacts IDs.

## Usage
- Build incremental cache: `pairofcleats index build --incremental`.
- Update SQLite in place: `pairofcleats build-sqlite-index --incremental`.
- `pairofcleats bootstrap --incremental --with-sqlite` runs both.
- `--validate <off|smoke|full>` controls post-build SQLite validation (default: `smoke`).

## Fallback Behavior
If the incremental manifest or required SQLite tables are missing, the tool falls back to a full rebuild.
If a manifest exists, full rebuilds automatically stream from incremental bundles instead of loading `chunk_meta.json`.
Full rebuilds also trigger when:
- The manifest is empty or has conflicting paths (same file with different separators).
- `file_manifest` is empty while chunks exist (legacy DBs without per-file metadata).
- Change ratio exceeds 35% of tracked files (changed + deleted).
- Vocab growth exceeds maintenance limits for token/phrase/chargram tables.
- Dense vector metadata (model or dims) mismatches the incoming bundles.
- Bundle files are missing or invalid.

## Limitations
- Vocabulary tables keep old tokens/grams; they are not pruned on deletes.
- Doc ID gaps grow with frequent updates; rebuild to compact if needed.
- Large vocab growth or churn triggers a full rebuild to keep tables bounded.
