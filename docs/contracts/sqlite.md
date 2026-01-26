# SQLite contract

## Schema
- SQLite builds follow `docs/sqlite-index-schema.md` and include dense vectors + metadata.
- Required tables include `chunks`, `token_vocab`, `token_postings`, `minhash_signatures`, `dense_vectors`, and `dense_meta` (plus FTS tables when configured).
- Schema versioning uses `PRAGMA user_version` and must match `SCHEMA_VERSION`.
- On schema mismatch, SQLite readers fail closed and prompt a rebuild.
- `chunks.metaV2_json` stores the canonical `metaV2` object for parity with JSONL. Retrieval must parse it and fail closed if missing/invalid.
- Compatibility keys include the SQLite schema version; schema bumps are treated as hard breaks requiring rebuilds.

## Incremental updates
- Incremental builds reuse manifests and remove deleted file rows.
- Dense vectors and ANN rows must stay in sync with chunk counts.
- If a schema bump occurs, rebuild SQLite indexes; incremental updates do not attempt migrations.

## ANN extension
- Vector extension usage is optional and configuration-driven.
- When the extension is missing, search falls back to non-extension ANN and reports availability accordingly.

## References
- `docs/sqlite-index-schema.md`
- `docs/sqlite-incremental-updates.md`
- `docs/sqlite-ann-extension.md`
