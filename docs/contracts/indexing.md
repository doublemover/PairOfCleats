# Indexing contract

## Stages and modes
- Stage1 (sparse): discovery + chunking + token postings for each mode.
- Stage2 (enrich): file metadata, repo maps, relations, and filter indexes.
- Stage3 (embeddings): dense vectors + HNSW + LanceDB artifacts, index state updates, and an out-of-band embeddings cache (see `docs/specs/embeddings-cache.md`).
- Stage4 (sqlite): sqlite index build plus optional ANN tables.
- Modes: `code`, `prose`, `extracted-prose`, `records`. Mode `all` builds the enabled set.

## Mode semantics
- `code` indexes code bodies + structural metadata; comments are not indexed as searchable text and only reference extracted-prose spans.
- `prose` indexes documentation/prose files (Markdown, text, etc.). Comments inside prose files remain part of prose.
- `extracted-prose` indexes only extracted segments (comments/docstrings/config comments). It must not fall back to indexing the full file body.
- `records` indexes log/record artifacts and excludes those files from other modes.
- `all` == `{code, prose, extracted-prose, records}`.

## Optional document extraction dependencies (planned)
- PDF/DOCX extraction is planned and currently used only by optional tooling/benchmarks.
- When indexing gains document extraction, it will require optional packages:
  - `pdfjs-dist` (PDF)
  - `mammoth` (DOCX)
- Until then, missing dependencies only affect optional tooling/benchmarks; indexing does not extract PDF/DOCX content.

## Artifact minimum set
Required (baseline search):
- `chunk_meta.json` (or `chunk_meta.jsonl` / sharded `chunk_meta.parts` + `chunk_meta.meta.json` / `chunk_meta.columnar.json`).
- `token_postings.json` (or sharded `token_postings.shards` + `token_postings.meta.json`).
- `file_meta.json` when chunk metadata uses `fileId` indirection.
- `index_state.json` for stage gating.

Optional (feature/config driven):
- `file_relations.json`, `repo_map.json`, `filter_index.json`.
- `field_postings.json` + `field_tokens.json` (fielded postings).
- `phrase_ngrams.json` / `chargram_postings.json`.
- `minhash_signatures.json`.
- Embeddings artifacts (`dense_vectors_*`, `dense_vectors_hnsw.*`, `dense_vectors*.lancedb`) when embeddings are enabled.
- Tooling VFS artifacts (when VFS/tooling is enabled):
  - `vfs_manifest.jsonl` (or `vfs_manifest.meta.json` + `vfs_manifest.parts/`).
  - `vfs_path_map.jsonl` (optional, or sharded `vfs_path_map.meta.json` + `vfs_path_map.parts/`).
  - `vfs_manifest.vfsidx` and `vfs_manifest.vfsbloom.json` (optional index/bloom sidecars).

## Format precedence
- If a pieces manifest is present and strict mode is enabled, loaders follow the manifest and treat missing entries as errors.
- `chunk_meta` (non-strict): if both `chunk_meta.meta.json` + `chunk_meta.parts/` and `chunk_meta.jsonl` exist, the newer mtime wins; otherwise use whichever exists, falling back to `chunk_meta.columnar.json` and then `chunk_meta.json`.
- `token_postings` (non-strict): prefer `token_postings.meta.json` + `token_postings.shards/`, then `token_postings.json`.
- Raw-first compression: if `.json`/`.jsonl` exists, it is read even if `.json.gz`/`.json.zst` or `.jsonl.gz`/`.jsonl.zst` sidecars exist; sidecars are used only when raw is missing.

## Build state + provenance

Each build writes a `build_state.json` at the build root. This file records build metadata,
repo provenance, and progress snapshots. The schema is defined in:

- `src/contracts/schemas/build-state.js`
- `src/contracts/validators/build-state.js`

Key requirements:
- `schemaVersion` and `signatureVersion` are always present.
- `repo.provider` records the SCM provider (`git|jj|none`).
- `repo.head` contains provider-specific head fields (e.g., git commit or jj changeId).
- When `provider=none`, provenance fields are `null` and no SCM fields are inferred.
- With `provider=none`, file discovery falls back to filesystem crawl and SCM-based metadata (annotate/churn) is disabled with an explicit log reason.
- Build ids use a deterministic `noscm` marker when no SCM head is available.

## Invariants
- Each mode writes to its own index directory under the cache root.
- Artifact counts and dimensions must be internally consistent.
- Readers gate on `index_state.json` for staged outputs.
- Artifact writes are atomic; file-backed writers use temp files + `.bak` fallback, while sharded artifacts are built in staging directories and swapped into place on success.
- Artifact `configHash` values must not incorporate secrets (e.g., API tokens); only content-relevant config/environment inputs are allowed.

## Sharded meta schema
- JSONL-sharded artifacts (e.g., `chunk_meta`, `graph_relations`, `symbols`, `symbol_edges`) use `*.meta.json` with the jsonl-sharded schema (often nested under `fields`):
  - `schemaVersion`, `artifact`, `format: "jsonl-sharded"`, `generatedAt`, `compression`, `totalRecords`, `totalBytes`, `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`, `parts[]`
  - `parts[]` entries include `{ path, records, bytes }` plus optional `checksum`/`extensions`.
- `token_postings.meta.json` uses a sharded JSON schema with fields + arrays:
  - `fields`: `{ format: "sharded", shardSize, vocabCount, parts, avgDocLen, totalDocs, compression }`
  - `arrays`: `{ docLengths }`

## Columnar artifacts
- `chunk_meta.columnar.json` is a columnar variant of `chunk_meta` and is valid when `indexing.artifacts.chunkMetaFormat=columnar`.
- `symbol_occurrences.columnar.json` and `symbol_edges.columnar.json` are valid when `indexing.artifacts.symbolArtifactsFormat=columnar`.
- When columnar variants are present, readers should prefer them over JSON/JSONL.

## References
- `docs/contracts/artifact-contract.md`
- `docs/specs/metadata-schema-v2.md`
- `docs/specs/scm-provider-contract.md`
- `docs/sqlite/index-schema.md`

