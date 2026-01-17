# Indexing contract

## Stages and modes
- Stage1 (sparse): discovery + chunking + token postings for each mode.
- Stage2 (enrich): file metadata, repo maps, relations, and filter indexes.
- Stage3 (embeddings): dense vectors + HNSW + LanceDB artifacts, index state updates.
- Stage4 (sqlite): sqlite index build plus optional ANN tables.
- Modes: `code`, `prose`, `extracted-prose`, `records`. Mode `all` builds the enabled set.

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

## Invariants
- Each mode writes to its own index directory under the cache root.
- Artifact counts and dimensions must be internally consistent.
- Readers gate on `index_state.json` for staged outputs.
- Artifact writes are atomic; previous versions are retained as `.bak` and readers fall back to `.bak` when primaries are missing/corrupt, then clean up on successful reads.

## Sharded meta schema
- `chunk_meta.meta.json` contains `{ format: "jsonl", shardSize, totalChunks, parts: [<posix paths>] }`.
- `token_postings.meta.json` contains `{ format: "sharded", shardSize, vocabCount, parts: [<posix paths>], avgDocLen, totalDocs }` plus `docLengths`.
- Loader precedence: newest between sharded meta+parts and jsonl wins; jsonl > json (and prefer `.json.zst`/`.json.gz` sidecars when present).

## References
- `docs/artifact-contract.md`
- `docs/metadata-schema-v2.md`
- `docs/sqlite-index-schema.md`
