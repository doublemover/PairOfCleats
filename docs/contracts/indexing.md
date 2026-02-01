# Indexing contract

## Stages and modes
- Stage1 (sparse): discovery + chunking + token postings for each mode.
- Stage2 (enrich): file metadata, repo maps, relations, and filter indexes.
- Stage3 (embeddings): dense vectors + HNSW + LanceDB artifacts, index state updates.
- Stage4 (sqlite): sqlite index build plus optional ANN tables.
- Modes: `code`, `prose`, `extracted-prose`, `records`. Mode `all` builds the enabled set.

## Mode semantics
- `code` indexes code bodies + structural metadata; comments are not indexed as searchable text and only reference extracted-prose spans.
- `prose` indexes documentation/prose files (Markdown, text, etc.). Comments inside prose files remain part of prose.
- `extracted-prose` indexes only extracted segments (comments/docstrings/config comments). It must not fall back to indexing the full file body.
- `records` indexes log/record artifacts and excludes those files from other modes.
- `all` == `{code, prose, extracted-prose, records}`.

## Optional document extraction dependencies
- PDF and DOCX extraction require optional packages:
  - `pdfjs-dist` (PDF)
  - `mammoth` (DOCX)
- When these dependencies are missing, extraction for those formats is skipped and a warning is emitted.

## Artifact minimum set
Required (baseline search):
- `chunk_meta.json` (or `chunk_meta.jsonl` / sharded `chunk_meta.parts` + `chunk_meta.meta.json`).
- `token_postings.json` (or sharded `token_postings.shards` + `token_postings.meta.json`).
- `file_meta.json` when chunk metadata uses `fileId` indirection.
- `index_state.json` for stage gating.

Optional (feature/config driven):
- `file_relations.json`, `repo_map.json`, `filter_index.json`.
- `field_postings.json` + `field_tokens.json` (fielded postings).
- `phrase_ngrams.json` / `chargram_postings.json`.
- `minhash_signatures.json`.
- Embeddings artifacts (`dense_vectors_*`, `dense_vectors_hnsw.*`, `dense_vectors*.lancedb`) when embeddings are enabled.

## Format precedence
- `chunk_meta`: prefer `chunk_meta.meta.json` + `chunk_meta.parts/`, then `chunk_meta.jsonl`, then `chunk_meta.json`.
- `token_postings`: prefer `token_postings.meta.json` + `token_postings.shards/`, then `token_postings.json`.
- If `*.json` is missing but `*.json.gz` exists, readers load the gzip sidecar; when `keepRaw` is enabled, both may exist and the raw `*.json` takes precedence.

## Invariants
- Each mode writes to its own index directory under the cache root.
- Artifact counts and dimensions must be internally consistent.
- Readers gate on `index_state.json` for staged outputs.
- Artifact writes are atomic; file-backed writers use temp files + `.bak` fallback, while sharded artifacts are built in staging directories and swapped into place on success.
- Artifact `configHash` values must not incorporate secrets (e.g., API tokens); only content-relevant config/environment inputs are allowed.

## Sharded meta schema
- `chunk_meta.meta.json` contains `{ format: "jsonl", shardSize, totalChunks, parts: [<posix paths>] }`.
- `token_postings.meta.json` contains `{ format: "sharded", shardSize, vocabCount, parts: [<posix paths>], avgDocLen, totalDocs }` plus `docLengths`.
- Loader precedence: newest between sharded meta+parts and jsonl wins; jsonl > json (and prefer `.json.zst`/`.json.gz` sidecars when present).

## References
- `docs/contracts/artifact-contract.md`
- `docs/specs/metadata-schema-v2.md`
- `docs/sqlite/index-schema.md`

