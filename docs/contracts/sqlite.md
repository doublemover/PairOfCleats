# SQLite contract

## Schema
- SQLite builds follow `docs/sqlite/index-schema.md` and include dense vectors + metadata.
- Required tables include `chunks`, `chunks_fts`, `token_vocab`, `token_postings`, `doc_lengths`, `token_stats`, `phrase_vocab`, `phrase_postings`, `chargram_vocab`, `chargram_postings`, `minhash_signatures`, `dense_vectors`, `dense_meta`, and `file_manifest`.
- Schema versioning uses `PRAGMA user_version` and must match `SCHEMA_VERSION`.
- On schema mismatch, SQLite readers fail closed and prompt a rebuild.
- Schema 16 requires `minhash_meta.hash_identity` for every mode with signatures; `sampling` is nullable for full-width rows. Readers and incremental updates reject unidentified or superseded hashes, including unchanged warm updates. A full rebuild recreates the signatures and identity together.
- Schema 17 adds `file_manifest.bundle_hash`: a versioned SHA256 identity of the complete ordered immutable bundle inventory, format and dependency signatures. Source hash/stat equality alone cannot reuse finalized risk, docmeta or inferred types. Missing identities require refresh; unchanged identities remain no-ops. SQLite schema 16 and earlier require rebuild through the existing schema/version gate; no in-place migration or author-cache rewrite is performed.
- `chunks.metaV2_json` stores the canonical `metaV2` object for parity with JSONL. Retrieval must parse it and fail closed if missing/invalid.
- Compatibility keys include the SQLite schema version; schema bumps are treated as hard breaks requiring rebuilds.

## Incremental updates
- Incremental builds reuse manifests and remove deleted file rows.
- Dense vectors and ANN rows must stay in sync with chunk counts.
- If a schema bump occurs, rebuild SQLite indexes; incremental updates do not attempt migrations.

## Selected roots and empty sources

Default all-mode builds resolve each published mode independently. If code and
prose point at different retained builds, each mode reads its own source root,
writes its own SQLite target and records progress/checkpoints in that root. An
explicit `--index-root` selects one root for every requested mode. A missing
mode authority fails planning before any database is changed; a later mode may
not replace an earlier mode's configured shared output database.

Per-mode `--code-dir`, `--prose-dir`, `--extracted-prose-dir` and `--records-dir`
(or corresponding API options) select their inputs before current roots are
required for other modes. A detached input requires explicit `--out`. Its
manifest, declared mode and generation must agree before target creation.
`--as-of`/`--snapshot` cannot be combined with explicit `--index-root` or per-mode
input directories; conflicting source authorities fail planning with that reason.

Source, output and generation-state ownership are separate. A detached input,
historical selection or output outside the selected generation's configured
SQLite target cannot update the input's readiness, heartbeat, phase, checkpoints
or zero-state proof. An empty detached source creates an actual empty database.
Unknown input counts use the artifact decoder's independent row count; declared
counts, including zero, must still match the imported database before publication.

An empty source can waive the database requirement only through a verified
zero-state marker. The marker binds mode, output path, index directory, build
identity, artifact surface version and checksums of the selected empty source
artifacts. Mere marker existence, a malformed marker or stale source bytes never
prove emptiness. Updating mutable index-state progress does not invalidate an
otherwise unchanged source proof.

## Replacement and recovery

SQLite replacement preserves the committed database and committed WAL until the
new database has been validated and promoted. Recovery settles retained backups
before admitting a new replacement attempt. Failures reading a fingerprint other
than genuine absence remain failures; permission/IO errors cannot establish that
there is no prior authority. Incremental dense replacement stages its ANN table
and validates/backfills it before replacing the prior table in the transaction.

## ANN extension
- Vector extension usage is optional and configuration-driven.
- When the extension is missing, search falls back to non-extension ANN and reports availability accordingly.

## References
- `docs/sqlite/index-schema.md`
- `docs/sqlite/incremental-updates.md`
- `docs/sqlite/ann-extension.md`


Schema 14 retains the complete ordered phrase token stream in chunks.phrase_tokens, independently of sampled/stemmed scoring tokens. Older schema stores require rebuilding. Missing literal evidence cannot satisfy quoted requirements or exclusions.

Optional FTS variants are selected at build time through `buildSqliteIndex({ftsVariants: ['trigram', 'porter']})` (or the corresponding lower-level builders). They are absent by default. Existing `search.sqliteFtsStemming` configuration builds the Porter table for prose modes; code mode retains unstemmed identifier retrieval. Porter excludes file/name/signature/kind from its index. Changing the selected variants requires a full SQLite rebuild. Full builds, incremental insert/delete and compaction maintain the selected tables. Searches target the actual selected table and report missing optional tables rather than claiming that unicode61 is Porter/trigram. Native term and exact literal-phrase eligibility precede top-N; a bounded post-hydration eligibility check remains. Allowlist sizes above the SQLite parameter threshold use a bound JSON array in `json_each`, preserving hard eligibility in SQL before ranking limits.
