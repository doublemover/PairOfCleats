# Artifact Contract

This document defines the on-disk artifact layout, formats, and invariants for PairOfCleats index builds.

## Build layout

Artifacts live under the per-repo cache and are promoted atomically via a current pointer.

```
<cache>/repos/<repoId>/builds/<buildId>/
  build_state.json
  index-code/
  index-prose/
  index-records/
  index-sqlite/
<cache>/repos/<repoId>/builds/current.json
```

`buildId` format: `YYYYMMDDTHHMMSSZ_<gitShortSha|nogit>_<configHash8>`.

## Core artifacts (per mode)

Each `index-<mode>/` directory contains:

- `chunk_meta.json` (or `chunk_meta.jsonl` or sharded `chunk_meta.parts/` + `chunk_meta.meta.json`)
  - Array or JSONL of chunk metadata entries.
  - Each entry includes `id`, `fileId`, `start`, `end`, `startLine`, `endLine`, `kind`, `name`, plus optional metadata.
- `file_meta.json`
  - Array of `{ id, file, ext, ... }` describing files referenced by `chunk_meta`.
- `token_postings.json` (or sharded `token_postings.shards/` + `token_postings.meta.json`)
  - Token vocabulary and postings lists.
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
- `index_state.json`
  - Build feature flags + stage metadata for the mode.
- `.filelists.json`
  - Scan summary (sampled file lists).
- `pieces/manifest.json`
  - Piece inventory with checksums and sizes.

Compressed artifacts may appear as `.json.gz`. When compression is enabled, the JSON payload contains a `compression` field.

## SQLite artifacts

When SQLite is enabled, `index-sqlite/` contains:

- `index-code.db`
- `index-prose.db`

SQLite builds are written to temporary files and atomically swapped into place on success.

## Invariants

These invariants are validated by `pairofcleats index-validate`:

- `chunk_meta` entries have sequential, zero-based `id` values.
- `file_meta.id` values are unique and referenced by `chunk_meta.fileId`.
- `token_postings.docLengths.length == chunk_meta.length`.
- Posting lists only reference valid chunk IDs.
- `minhash_signatures.signatures.length == chunk_meta.length`.
- `dense_vectors*.vectors.length == chunk_meta.length`.
- Vector dimensionality matches `dims`.
- `filter_index.fileChunksById` references valid chunk IDs.
- `pieces/manifest.json` paths exist and SHA-1 checksums match.

## Validation and remediation

Failures are categorized as:

- **Missing artifact**: rebuild the index for the affected mode.
- **Schema violations**: artifacts are corrupt or out of date; rebuild the index.
- **Cross-reference errors**: artifacts are inconsistent; rebuild the index.
- **SQLite table issues**: rebuild SQLite indexes.

Use `pairofcleats index build` for file-backed artifacts and `pairofcleats sqlite build` for SQLite indexes.
