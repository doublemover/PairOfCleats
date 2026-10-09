# SQLite contract

## Schema
- SQLite builds follow `docs/sqlite/index-schema.md` and include dense vectors + metadata.
- Required tables include `chunks`, `chunks_fts`, `token_vocab`, `token_postings`, `doc_lengths`, `token_stats`, `phrase_vocab`, `phrase_postings`, `chargram_vocab`, `chargram_postings`, `minhash_signatures`, `dense_vectors`, `dense_meta`, and `file_manifest`.
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
- `docs/sqlite/index-schema.md`
- `docs/sqlite/incremental-updates.md`
- `docs/sqlite/ann-extension.md`


Schema 14 retains the complete ordered phrase token stream in chunks.phrase_tokens, independently of sampled/stemmed scoring tokens. Older schema stores require rebuilding. Missing literal evidence cannot satisfy quoted requirements or exclusions.

Optional FTS variants are selected at build time through `buildSqliteIndex({ftsVariants: ['trigram', 'porter']})` (or the corresponding lower-level builders). They are absent by default. Existing `search.sqliteFtsStemming` configuration builds the Porter table for prose modes; code mode retains unstemmed identifier retrieval. Porter excludes file/name/signature/kind from its index. Changing the selected variants requires a full SQLite rebuild. Full builds, incremental insert/delete and compaction maintain the selected tables. Searches target the actual selected table and report missing optional tables rather than claiming that unicode61 is Porter/trigram. Native term eligibility precedes top-N; literal phrase evidence remains an exact postcondition. Allowlist sizes above the SQLite parameter threshold use a bound JSON array in `json_each`, preserving hard eligibility in SQL before ranking limits.
