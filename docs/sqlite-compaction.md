# SQLite Compaction

## Goal
Rebuild a SQLite index in-place to remove doc_id gaps, prune unused vocab entries, and VACUUM the database.

## What It Does
- Reassigns `doc_id` values to be dense and sequential.
- Removes unused entries from token, phrase, and char-gram vocab tables.
- Copies postings/vectors/signatures using the new doc_id mapping.
- Writes a fresh DB file, swaps it in, and vacuums it.

## Usage
- `node tools/compact-sqlite-index.js`
- `node tools/compact-sqlite-index.js --mode code|prose`
- `node tools/compact-sqlite-index.js --dry-run`
- `node tools/compact-sqlite-index.js --keep-backup`

## Notes
- Uses a temp DB file and swaps it in when complete.
- A full rebuild is still the fastest way to compact everything (this avoids re-parsing the repo).
- File paths are normalized to use `/` in the SQLite DB.
- If a vector extension is configured, `dense_vectors_ann` is rebuilt alongside the dense vectors.
