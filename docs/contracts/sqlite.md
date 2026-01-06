# SQLite contract

## Schema
- SQLite builds follow `docs/sqlite-index-schema.md` and include dense vectors + metadata.
- Required tables include `chunks`, `token_vocab`, `token_postings`, `minhash_signatures`, `dense_vectors`, and `dense_meta` (plus FTS tables when configured).

## Incremental updates
- Incremental builds reuse manifests and remove deleted file rows.
- Dense vectors and ANN rows must stay in sync with chunk counts.

## ANN extension
- Vector extension usage is optional and configuration-driven.
- When the extension is missing, search falls back to non-extension ANN and reports availability accordingly.

## References
- `docs/sqlite-index-schema.md`
- `docs/sqlite-incremental-updates.md`
- `docs/sqlite-ann-extension.md`
