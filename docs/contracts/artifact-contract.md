# Artifact Contract

> Canonical contract: `docs/contracts/public-artifact-surface.md` (this file is legacy detail and may be trimmed as the canonical spec evolves).

This document defines the on-disk artifact layout, formats, and invariants for PairOfCleats index builds.

Canonical schema field lists live in `src/contracts/schemas/artifacts.js` and are kept in sync with this document.

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

`buildId` format: `YYYYMMDDTHHMMSSZ_<scmHeadShort|noscm>_<configHash8>`.
`scmHeadShort` is derived from the provider head (git commit short SHA, jj changeId when available).

## Core artifacts (per mode)

Each `index-<mode>/` directory contains:

- `chunk_meta.json` (or `chunk_meta.jsonl`, or sharded `chunk_meta.parts/` + `chunk_meta.meta.json`, or `chunk_meta.columnar.json`)
  - Array/JSONL of chunk metadata entries.
  - Each entry includes `id`, `fileId`, `start`, `end`, `startLine`, `endLine`, `kind`, `name`, plus optional metadata.
  - Columnar form (`chunk_meta.columnar.json`) stores a `{ format: "columnar", columns, arrays, length }` payload that inflates to the same row schema.
  - Sharded JSONL meta (`chunk_meta.meta.json`) uses the jsonl-sharded schema:
    - `schemaVersion`, `artifact`, `format: jsonl-sharded`, `generatedAt`, `compression`
    - `totalRecords`, `totalBytes`, `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
    - `parts[]` with `{ path, records, bytes, checksum? }`
- `file_meta.json`
  - Array of `{ id, file, ext, size, hash, hashAlgo, ... }` describing files referenced by `chunk_meta`.
- `token_postings.json` (or sharded `token_postings.shards/` + `token_postings.meta.json`)
  - Token vocabulary and postings lists.
  - Sharded meta (`token_postings.meta.json`) fields: `format`, `shardSize`, `vocabCount`, `parts`, plus `docLengths`.
- `repo_map.json`
  - Flattened symbol list for repo map output.
- `file_relations.json` (optional)
  - Per-file relation metadata (imports/exports/relations).
- `symbols.jsonl` (optional; JSONL or sharded JSONL)
  - Symbol rows (`symbolId`, `symbolKey`, `qualifiedName`, `kindGroup`, etc.).
- `symbol_occurrences.jsonl` (optional; JSONL or sharded JSONL) or `symbol_occurrences.columnar.json`
  - `symbol_occurrences.columnar.json` stores a `{ format: "columnar", columns, arrays, length, tables? }` payload that inflates to the JSONL row schema.
- `symbol_edges.jsonl` (optional; JSONL or sharded JSONL) or `symbol_edges.columnar.json`
  - `symbol_edges.columnar.json` stores a `{ format: "columnar", columns, arrays, length, tables? }` payload that inflates to the JSONL row schema.
- `call_sites.jsonl` (optional; JSONL or sharded JSONL)
  - Evidence-rich callsite records (Phase 6). Emits `callSiteId`, caller chunk identity, location, callee info, and bounded args.
  - Sharded form uses `call_sites.meta.json` + `call_sites.parts/`.
  - Additive: does not replace `file_relations`; legacy relations remain available.
- `vfs_manifest.jsonl` (optional; JSONL or sharded JSONL)
  - Tooling VFS manifest rows (virtualPath, diskPath, docHash, segment metadata).
  - Sharded form uses `vfs_manifest.meta.json` + `vfs_manifest.parts/`.
- `vfs_path_map.jsonl` (optional; JSONL or sharded JSONL)
  - Maps canonical `virtualPath` to hash-routed disk paths when `hashRouting` is enabled.
  - Sharded form uses `vfs_path_map.meta.json` + `vfs_path_map.parts/`.
- `vfs_manifest.vfsidx` (optional)
  - Line index for `vfs_manifest.jsonl` to support offset lookups.
- `vfs_manifest.vfsbloom.json` (optional)
  - Bloom filter sidecar for fast negative checks on virtualPath queries.
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
- Embeddings cache entries are stored out-of-band under the OS cache root and are not part of the build artifact surface. They are safe to delete and are rebuilt on demand.
- `index_state.json`
  - Build feature flags + stage metadata for the mode.
- `.filelists.json`
  - Scan summary (sampled file lists).
- `pieces/manifest.json`
  - Piece inventory with checksums and sizes.

Compressed artifacts may appear as `.json.gz` or `.json.zst` sidecars. The JSON payload itself is unchanged (no embedded `compression` field); compression uses fflate (gzip) or @mongodb-js/zstd (zstd).

### Loader precedence (chunk/meta artifacts)
- If both sharded JSONL (`chunk_meta.meta.json` + `chunk_meta.parts/`) and `chunk_meta.jsonl` exist, the newer mtime wins.
- `chunk_meta.jsonl` supersedes `chunk_meta.columnar.json`, which supersedes `chunk_meta.json` when present.
- For `.json`/`.jsonl` artifacts, loaders read the raw file first; `.json.zst`/`.json.gz` sidecars are only used when the raw file is missing.

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
  "schemaVersion": "0.0.1",
  "artifact": "chunk_meta",
  "format": "jsonl-sharded",
  "generatedAt": "2026-01-01T00:00:00Z",
  "compression": "none",
  "totalRecords": 250000,
  "totalBytes": 987654321,
  "maxPartRecords": 100000,
  "maxPartBytes": 104857600,
  "targetMaxBytes": 104857600,
  "parts": [
    { "path": "chunk_meta.parts/chunk_meta.part-00000.jsonl", "records": 100000, "bytes": 40000000 },
    { "path": "chunk_meta.parts/chunk_meta.part-00001.jsonl", "records": 100000, "bytes": 40000000 }
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
`pairofcleats index validate` performs a lightweight LMDB check (schema version, mode, and required artifact keys).

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
- Manifest `count` values (summed across shards with the same `name`) match loaded record counts in strict validation.
- Artifact `configHash` values must exclude secrets (e.g., API tokens) and include only content-relevant inputs.

## Validation and remediation

Failures are categorized as:

- **Missing artifact**: rebuild the index for the affected mode.
- **Schema violations**: artifacts are corrupt or out of date; rebuild the index.
- **Embedding dims mismatch**: hard failure; rebuild embeddings with a consistent model/dims and regenerate dependent indexes (SQLite/ANN). Clear incremental bundles if the mismatch persists.
- **Cross-reference errors**: artifacts are inconsistent; rebuild the index.    
- **SQLite table issues**: rebuild SQLite indexes.

Use `pairofcleats index build` for file-backed artifacts and `pairofcleats sqlite build` for SQLite indexes.
