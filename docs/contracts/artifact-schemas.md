# Artifact Schemas (0.0.1)

This document is the canonical contract for on-disk index artifacts. Schema validation is enforced by `src/index/validate` against the registry in `src/contracts/schemas/artifacts.js`.

## General expectations

- Artifacts are discovered **only** via `pieces/manifest.json` (manifest-first).
- Paths are **relative** and **posix-normalized**; `..` and absolute paths are invalid.
- Unknown top-level fields are errors unless the schema allows `additionalProperties`.
- Extensions are permitted only where an `extensions` object is defined.

## Sharded JSONL meta schema

Artifacts written as `*.jsonl.parts/` must include `*.meta.json` with:
- `schemaVersion` (SemVer), `artifact` (const), `format: jsonl-sharded`, `generatedAt`, `compression`
- `totalRecords`, `totalBytes`, `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
- `parts`: `{ path, records, bytes, checksum? }[]`

Sharded meta is defined for: `chunk_meta_meta`, `file_relations_meta`, `call_sites_meta`, `repo_map_meta`, `graph_relations_meta`.

## Artifact registry

All artifacts below are JSON unless noted. Required fields are listed.

- `chunk_meta` (array): entries require `id`, `start`, `end` (ints). Optional: `fileId`, `startLine`, `endLine`, `kind`, `name`, `ext`, `metaV2`. Additional properties allowed.
- `file_meta` (array): entries require `id`, `file` (string). Optional: `ext`, `encoding`, `encodingFallback`, `encodingConfidence`.
- `repo_map` (array): entries require `file`, `name`. Optional: `kind`, `signature`, `exported`.
- `file_relations` (array): entries require `file`, `relations` (object).
- `call_sites` (array/JSONL): entries require
  `callSiteId`, `callerChunkUid`, `file`, `languageId`, `start`, `end`,
  `startLine`, `startCol`, `endLine`, `endCol`, `calleeRaw`,
  `calleeNormalized`, `args`. Optional: `receiver`, `kwargs`, `confidence`,
  `evidence`, `segmentId`, `callerDocId`, `targetChunkUid`, `targetDocId`,
  `targetCandidates`, `snippetHash`.
- `token_postings` (object): requires `vocab`, `postings`, `docLengths`. Optional: `avgDocLen`, `totalDocs`.
- `token_postings_meta` (object): requires `format`, `shardSize`, `vocabCount`, `parts`. Optional: `avgDocLen`, `totalDocs`, `compression`, `docLengths`, `extensions`.
- `field_postings` (object): requires `fields` map; each field requires `vocab`, `postings`, `docLengths`.
- `field_tokens` (array): entries may include `name`, `signature`, `doc`, `comment`, `body` token arrays.
- `minhash_signatures` (object): requires `signatures` (array of int arrays).
- `dense_vectors`, `dense_vectors_doc`, `dense_vectors_code` (object): requires `dims`, `vectors`. Optional: `model`, `scale`, `minVal`, `maxVal`, `levels`.
- `dense_vectors_hnsw_meta`, `dense_vectors_doc_hnsw_meta`, `dense_vectors_code_hnsw_meta` (object): requires `dims`, `count`, `space`, `m`, `efConstruction`, `efSearch`. Optional: `scale`, `minVal`, `maxVal`, `levels`.
- `dense_vectors_lancedb_meta`, `dense_vectors_doc_lancedb_meta`, `dense_vectors_code_lancedb_meta` (object): requires `dims`, `count`, `metric`, `table`, `embeddingColumn`, `idColumn`. Optional: `scale`, `minVal`, `maxVal`, `levels`.
- `dense_vectors_sqlite_vec_meta` (object): requires `dims`, `count`, `table`. Optional: `embeddingColumn`, `idColumn`, `scale`, `minVal`, `maxVal`, `levels`.
- `phrase_ngrams` (object): requires `vocab`, `postings`.
- `chargram_postings` (object): requires `vocab`, `postings`.
- `filter_index` (object): requires `fileById`, `fileChunksById`. Optional: `fileChargramN`, `byExt`, `byKind`, `byAuthor`, `byChunkAuthor`, `byVisibility`, `fileChargrams`.
- `filelists` (object): requires `generatedAt`, `scanned`, `skipped` (each has `count`, `sample`).
- `pieces_manifest` (object): requires `version`, `artifactSurfaceVersion`, `pieces`. Optional: `compatibilityKey`, `generatedAt`, `updatedAt`, `mode`, `stage`, `repoId`, `buildId`, `extensions`.
- `index_state` (object): requires `generatedAt`, `mode`, `artifactSurfaceVersion`. Optional: `compatibilityKey`, `repoId`, `buildId`, `stage`, `assembled`, `embeddings`, `features`, `shards`, `enrichment`, `filterIndex`, `sqlite`, `lmdb`, `riskRules`, `extensions`.
- `builds_current` (object): requires `buildId`, `buildRoot`, `promotedAt`, `artifactSurfaceVersion`. Optional: `buildRoots`, `buildRootsByMode`, `buildRootsByStage`, `stage`, `modes`, `configHash`, `compatibilityKey`, `tool`, `repo`, `extensions`.
- `graph_relations` (object): requires `version`, `generatedAt`, `callGraph`, `usageGraph`, `importGraph`. Each graph requires `nodeCount`, `edgeCount`, `nodes[]` (node requires `id`, `out`, `in`; optional `file`, `name`, `kind`, `chunkId`).
- `import_resolution_graph` (object): requires `generatedAt`, `nodes`, `edges`, `stats`. Nodes require `id`, `type`. Edges require `from`, `to`, `rawSpecifier`, `resolvedType`. Optional fields include `resolvedPath`, `packageName`, `tsconfigPath`, `tsPathPattern`, `warnings[]`.

## Additions and phase notes

- `filter_index` may include an optional `byLang` map keyed by effective language id (Phase 5).
  - Phase 5 also requires chunk records to expose effective language via `metaV2.lang`.
- `call_sites` (jsonl or sharded jsonl) contains bounded callsite evidence records (Phase 6).
  - Canonical spec: `docs/specs/risk-flows-and-call-sites.md`.
  - `call_sites_meta` follows the sharded JSONL meta schema (artifact name `call_sites`).
- `index_state.embeddings` includes identity and backend availability signals when embeddings are present (Phase 7).

## Notes

- Schema definitions are authoritative in `src/contracts/schemas/artifacts.js`.
- `metaV2` uses the metadata schema defined in `docs/specs/metadata-schema-v2.md` (see analysis schemas).
- SQLite stores canonical `metaV2` per chunk in `chunks.metaV2_json` for parity with JSONL artifacts.

