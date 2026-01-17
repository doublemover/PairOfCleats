# Artifact Contract

This document defines the on-disk artifact layout, formats, and invariants for PairOfCleats index builds.

Canonical schema field lists live in `src/index/build/artifacts/schema.js` and are kept in sync with this document.

## Build layout

Artifacts live under the per-repo cache and are promoted atomically via a current pointer.

```
<cache>/repos/<repoId>/builds/<buildId>/
  build_state.json
  index-code/
  index-prose/
  index-records/
  index-sqlite/
  index-lmdb/
<cache>/repos/<repoId>/builds/current.json
```

`buildId` format: `YYYYMMDDTHHMMSSZ_<gitShortSha|nogit>_<configHash8>`.

## Core artifacts (per mode)

Each `index-<mode>/` directory contains:

- `chunk_meta.json` (or `chunk_meta.jsonl`, or sharded `chunk_meta.parts/` + `chunk_meta.meta.json`)
  - Array/JSONL of chunk metadata entries.
  - Each entry includes `id`, `fileId`, `start`, `end`, `startLine`, `endLine`, `kind`, `name`, plus optional metadata.
  - Sharded meta (`chunk_meta.meta.json`) fields: `format`, `shardSize`, `totalChunks`, `parts` (relative paths).
- `file_meta.json`
  - Array of `{ id, file, ext, size, hash, hashAlgo, ... }` describing files referenced by `chunk_meta`.
- `token_postings.json` (or sharded `token_postings.shards/` + `token_postings.meta.json`)
  - Token vocabulary and postings lists.
  - Sharded meta (`token_postings.meta.json`) fields: `format`, `shardSize`, `vocabCount`, `parts`, plus `docLengths`.
- `repo_map.json`
  - Flattened symbol list for repo map output.
- `file_relations.json` (optional)
  - Per-file relation metadata (imports/exports/relations).
- `filter_index.json` (optional)
  - Serialized filter index for fast metadata filters.
- `field_postings.json` + `field_tokens.json` (optional; only when fielded postings enabled)
  - Fielded vocab + postings and per-chunk field token arrays.
- `phrase_ngrams.json` and `chargram_postings.json` (optional, per config)
  - Phrase/chargram vocab + postings arrays.
- `minhash_signatures.json` (optional)
  - Per-chunk MinHash signatures.
- `dense_vectors_uint8.json` + `dense_vectors_doc_uint8.json` + `dense_vectors_code_uint8.json` (optional)
  - Quantized embeddings with `model`, `dims`, and `scale`.
- `dense_vectors.lancedb/` + `dense_vectors.lancedb.meta.json` (optional)
- `dense_vectors_doc.lancedb/` + `dense_vectors_doc.lancedb.meta.json` (optional)
- `dense_vectors_code.lancedb/` + `dense_vectors_code.lancedb.meta.json` (optional)
  - LanceDB vector indexes with `dims`, `count`, `metric`, and table/column metadata.
- `index_state.json`
  - Build feature flags + stage metadata for the mode.
- `.filelists.json`
  - Scan summary (sampled file lists).
- `pieces/manifest.json`
  - Piece inventory with checksums and sizes.

Compressed artifacts may appear as `.json.gz` or `.json.zst` sidecars. The JSON payload itself is unchanged (no embedded `compression` field); compression uses fflate (gzip) or @mongodb-js/zstd (zstd).

### Loader precedence (chunk/meta artifacts)
- `chunk_meta.meta.json` + `chunk_meta.parts/` (sharded JSONL) are preferred unless a newer `chunk_meta.jsonl` exists (e.g., after switching formats).
- `chunk_meta.jsonl` supersedes `chunk_meta.json`.
- For `.json` or `.jsonl` artifacts, prefer `.json.zst`/`.json.gz` sidecars over the raw JSON when present.

## Incremental bundles

Incremental caches store per-file bundles under `<cache>/repos/<repoId>/incremental/<mode>/files/`.
Bundles are written as:

- `*.json` (legacy JSON bundles), or
- `*.mpk` (MsgPack envelopes: `{ format: "pairofcleats.bundle", version: 1, checksum: { algo, value }, payload }`).

MsgPack bundles use stable key ordering before encoding, and the checksum covers the normalized payload for deterministic verification.

## Meta file examples

Chunk metadata shards:
```json
{
  "format": "jsonl",
  "shardSize": 100000,
  "totalChunks": 250000,
  "parts": [
    "chunk_meta.parts/chunk_meta.part-00000.jsonl",
    "chunk_meta.parts/chunk_meta.part-00001.jsonl"
  ]
}
```

Token postings shards:
```json
{
  "avgDocLen": 42.1,
  "totalDocs": 250000,
  "format": "sharded",
  "shardSize": 50000,
  "vocabCount": 123456,
  "parts": [
    "token_postings.shards/token_postings.part-00000.json"
  ]
}
```

Pieces manifest:
```json
{
  "version": 2,
  "generatedAt": "2026-01-01T00:00:00Z",
  "mode": "code",
  "stage": "stage2",
  "pieces": [
    {
      "type": "chunks",
      "name": "chunk_meta",
      "format": "jsonl",
      "path": "chunk_meta.jsonl",
      "bytes": 1234,
      "checksum": "xxh64:deadbeef"
    }
  ]
}
```

## SQLite artifacts

When SQLite is enabled, `index-sqlite/` contains:

- `index-code.db`
- `index-prose.db`

SQLite builds are written to temporary files and atomically swapped into place on success.

## LMDB artifacts

When LMDB is enabled, `index-lmdb/` contains:

- `index-code/` (LMDB store for code mode)
- `index-prose/` (LMDB store for prose mode)

LMDB stores contain msgpack-encoded values. The keyspace is:

Meta keys:
- `meta:schemaVersion` (integer schema version)
- `meta:createdAt` (ISO timestamp)
- `meta:mode` (`code` or `prose`)
- `meta:sourceIndex` (path to source index directory)
- `meta:chunkCount` (integer chunk count)
- `meta:artifacts` (list of artifact keys stored)

Artifact keys:
- `artifact:chunk_meta`
- `artifact:token_postings`
- `artifact:file_meta`
- `artifact:file_relations`
- `artifact:repo_map`
- `artifact:filter_index`
- `artifact:field_postings`
- `artifact:field_tokens`
- `artifact:phrase_ngrams`
- `artifact:chargram_postings`
- `artifact:minhash_signatures`
- `artifact:dense_vectors_uint8`
- `artifact:dense_vectors_doc_uint8`
- `artifact:dense_vectors_code_uint8`
- `artifact:dense_vectors_hnsw_meta`
- `artifact:index_state`

HNSW binary indexes remain in the file-backed index directory (`index-<mode>/dense_vectors_hnsw.bin`).
LanceDB indexes and metadata remain in the file-backed index directory (`index-<mode>/dense_vectors*.lancedb`).

LMDB stores are rebuilt from file-backed artifacts via `pairofcleats lmdb build`.

## LMDB migration rules

- If `meta:schemaVersion` is missing or does not match `src/storage/lmdb/schema.js`,
  the LMDB store is invalid and the system falls back to file-backed indexes (unless
  `--backend lmdb` was forced, which yields an error).
- Rebuild LMDB stores after schema changes by running `pairofcleats lmdb build`.
  The build process updates `index_state.json` with `lmdb.pending` and `lmdb.ready`
  flags to gate readers during rebuilds.

## Invariants

These invariants are validated by `pairofcleats index validate`:

- `chunk_meta` entries have sequential, zero-based `id` values.
- `file_meta.id` values are unique and referenced by `chunk_meta.fileId`.
- `token_postings.docLengths.length == chunk_meta.length`.
- Posting lists only reference valid chunk IDs.
- `minhash_signatures.signatures.length == chunk_meta.length`.
- `dense_vectors*.vectors.length == chunk_meta.length`.
- `dense_vectors*.lancedb.meta.json.count == chunk_meta.length` (when present).
- Vector dimensionality matches `dims`.
- `filter_index.fileChunksById` references valid chunk IDs.
- `pieces/manifest.json` paths exist and `xxh64` checksums match (legacy `sha1` accepted).

## Validation and remediation

Failures are categorized as:

- **Missing artifact**: rebuild the index for the affected mode.
- **Schema violations**: artifacts are corrupt or out of date; rebuild the index.
- **Embedding dims mismatch**: hard failure; rebuild embeddings with a consistent model/dims and regenerate dependent indexes (SQLite/ANN). Clear incremental bundles if the mismatch persists.
- **Cross-reference errors**: artifacts are inconsistent; rebuild the index.    
- **SQLite table issues**: rebuild SQLite indexes.

Use `pairofcleats index build` for file-backed artifacts and `pairofcleats sqlite build` for SQLite indexes.
