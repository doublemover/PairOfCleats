# SQLite Index Schema

This schema is created by `tools/build-sqlite-index.js`.

## Core tables

### chunks
Stores the full per-chunk metadata used by `search.js`.

Columns:
- id (INTEGER PRIMARY KEY)
- chunk_id (TEXT, stable `metaV2.chunkId`)
- mode (TEXT)
- file (TEXT)
- start, end (INTEGER)
- startLine, endLine (INTEGER)
- ext, kind, name, metaV2_json, headline (TEXT)
- preContext, postContext (TEXT JSON)
- weight (REAL)
- tokens, ngrams (TEXT JSON)
- codeRelations, docmeta, stats, complexity, lint, externalDocs (TEXT JSON)
- last_modified, last_author (TEXT)
- churn (REAL)
- churn_added, churn_deleted, churn_commits (INTEGER)
- chunk_authors (TEXT JSON)

### chunks_fts (FTS5)
Full-text search table for BM25 queries.

Columns:
- mode (UNINDEXED)
- file, name, signature, kind, headline, doc, tokens

### file_manifest
Per-file metadata used for incremental SQLite updates.

Columns:
- mode, file
- hash, mtimeMs, size
- chunk_count

## Sparse indexes

### token_vocab
Token dictionary per mode.
- mode, token_id, token

### token_postings
Token postings list per mode.
- mode, token_id, doc_id, tf

### doc_lengths
Per-doc token lengths per mode.
- mode, doc_id, len

### token_stats
Per-mode stats for BM25.
- mode, avg_doc_len, total_docs

## Phrase and char-gram indexes

### phrase_vocab
N-gram vocabulary per mode.
- mode, phrase_id, ngram

### phrase_postings
Doc IDs per phrase ID.
- mode, phrase_id, doc_id

### chargram_vocab
Char-gram vocabulary per mode.
- mode, gram_id, gram

### chargram_postings
Doc IDs per gram ID.
- mode, gram_id, doc_id

## Minhash signatures

### minhash_signatures
Packed minhash signatures per doc.
- mode, doc_id, sig (BLOB of uint32)

## Dense vectors

### dense_vectors
Packed quantized dense vectors per doc.
- mode, doc_id, vector (BLOB of uint8)

### dense_meta
Per-mode dense vector metadata.
- mode, dims, scale, model (TEXT)
- min_val, max_val (REAL), levels (INTEGER)

### dense_vectors_ann (optional)
Optional vector extension table for SQLite-only ANN search (requires a loadable
SQLite vector extension).
- rowid (doc_id)
- embedding (float32 vector)

## Notes
- `mode` is either `code` or `prose`.
- Split DBs use per-mode chunk IDs directly (no offsets).
- `idx_chunks_file`, `idx_chunks_file_id`, and `idx_file_manifest_mode_file` speed file-level updates.
- File paths in SQLite are normalized to use `/`.
- When `chunk_meta.json` stores `fileId` instead of `file`, `build-sqlite-index` uses `file_meta.json` to resolve file paths, extensions, and external docs, and to populate `file_manifest`.
- When incremental bundles are present (manifest exists), SQLite rebuilds stream bundle files from `<cache>/repos/<repoId>/incremental/<mode>/files` instead of loading `chunk_meta.json`.
- Schema versioning uses `PRAGMA user_version` and must match `SCHEMA_VERSION` (currently 10); mismatches require a full rebuild.
