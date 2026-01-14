# Indexing contract

## Stages and modes
- Stage1 (sparse): discovery + chunking + token postings for each mode.
- Stage2 (enrich): file metadata, repo maps, relations, and filter indexes.
- Stage3 (embeddings): dense vectors + HNSW + LanceDB artifacts, index state updates.
- Stage4 (sqlite): sqlite index build plus optional ANN tables.
- Modes: `code`, `prose`, `extracted-prose`, `records`. Mode `all` builds the enabled set.

## Artifact minimum set
- `chunk_meta.json` (or jsonl/sharded variants).
- `token_postings.json` (+ optional `phrase_ngrams.json` / `chargram_postings.json`).
- `minhash_signatures.json`.
- `file_meta.json` (required when chunk metadata omits file fields).
- Embeddings artifacts (`dense_vectors_*`, `dense_vectors_hnsw.*`, `dense_vectors*.lancedb`) when enabled.
- `index_state.json` tracks stage completion and gating.

## Invariants
- Each mode writes to its own index directory under the cache root.
- Artifact counts and dimensions must be internally consistent.
- Readers gate on `index_state.json` for staged outputs.
- Artifact writes are atomic; previous versions are retained as `.bak` and readers fall back to `.bak` when primaries are missing/corrupt, then clean up on successful reads.

## References
- `docs/artifact-contract.md`
- `docs/metadata-schema-v2.md`
- `docs/sqlite-index-schema.md`
