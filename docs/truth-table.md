# Truth table

This document maps user-visible behavior to implementation, configuration switches, tests, and limitations.

## Build modes and stages
- Claim: `build_index.js --mode code|prose|records|extracted-prose|all` builds mode-specific indexes under the repo cache; `all` expands to `code`, `prose`, and `extracted-prose`.
  - Implementation: `build_index.js` (entrypoint), `src/index/build/args.js` (`parseBuildArgs`), `src/integrations/core/index.js` (`buildIndex`), `src/index/build/indexer.js` (`buildIndexForMode`), `tools/dict-utils.js` (`resolveIndexRoot`, `getIndexDir`).
  - Config: CLI `--mode`, `--repo`, `--index-root`; environment `PAIROFCLEATS_CACHE_ROOT`.
  - Tests: `tests/fixture-smoke.js`, `tests/extracted-prose.js`, `tests/triage-records.js`, `tests/build-index-all.js`.
  - Limitations: `records` requires triage record inputs; `all` does not include `records`.

- Claim: stage flags gate enrichment (`stage1` sparse, `stage2` relations, `stage3` embeddings, `stage4` sqlite).
  - Implementation: `src/integrations/core/index.js` (`buildIndex`), `src/index/build/indexer.js` (`buildIndexForMode`), `src/index/build/runtime.js` (`normalizeStage`, `buildStageOverrides`), `tools/build-embeddings.js` (script entrypoint), `tools/build-sqlite-index.js` (script entrypoint).
  - Config: CLI `--stage`, `--stage1`, `--stage2`, `--stage3`, `--stage4`; `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`; environment `PAIROFCLEATS_STAGE`.
  - Tests: `tests/two-stage-state.js`, `tests/embeddings-validate.js`, `tests/sqlite-build-indexes.js`.
  - Limitations: stage3 requires embeddings; stage4 requires sqlite dependencies.

- Claim: `index_state.json` gates readers on pending stage outputs (embeddings/sqlite/lmdb).
  - Implementation: `src/index/build/artifacts.js` (`writeIndexArtifacts`), `tools/build-embeddings.js` (index_state updates), `tools/build-sqlite-index.js` (index_state updates), `tools/build-lmdb-index.js` (`updateLmdbState`), `src/retrieval/cli.js` (pending warnings), `src/retrieval/cli/index-loader.js` (`warnPendingState`).
  - Config: `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`, `lmdb.use`.
  - Tests: `tests/two-stage-state.js`, `tests/embeddings-validate.js`, `tests/sqlite-incremental.js`, `tests/lmdb-backend.js`.
  - Limitations: manual edits can override gating.

## Backend selection
- Claim: `search --backend auto` prefers sqlite when available and thresholds hit; `--backend sqlite|sqlite-fts` fails cleanly when missing; `--backend memory` uses file-backed indexes.
  - Implementation: `src/storage/backend-policy.js` (`resolveBackendPolicy`), `src/retrieval/cli.js` (`resolveBackendPolicy` usage), `src/retrieval/cli-sqlite.js` (`createSqliteBackend`).
  - Config: CLI `--backend`; `search.sqliteAutoChunkThreshold`, `search.sqliteAutoArtifactBytes`, `sqlite.use`; environment `PAIROFCLEATS_SQLITE_DISABLED` (tests).
  - Tests: `tests/sqlite-auto-backend.js`, `tests/sqlite-missing-dep.js`, `tests/backend-policy.js`.
  - Limitations: sqlite requires `better-sqlite3` (and optional ANN extension).

- Claim: `--backend lmdb` uses LMDB stores when present; auto fallback selects LMDB when sqlite is unavailable.
  - Implementation: `src/storage/backend-policy.js` (`resolveBackendPolicy`), `src/retrieval/cli-lmdb.js` (`createLmdbBackend`), `tools/build-lmdb-index.js` (LMDB build entrypoint).
  - Config: CLI `--backend`; `lmdb.use`, `lmdb.*` paths.
  - Tests: `tests/lmdb-backend.js`, `tests/backend-policy.js`.
  - Limitations: LMDB requires `lmdb` dependency and pre-built stores.

## Discovery, chunking, and tokenization
- Claim: file discovery honors ignore rules, minified/binary detection, and per-extension caps.
  - Implementation: `src/index/build/discover.js` (`discoverFiles`, `discoverFilesForModes`), `src/index/build/ignore.js` (`createIgnoreMatcher`), `src/shared/files.js` (`isBinaryFile`, `isMinifiedFile`).
  - Config: `indexing.maxFileBytes`, `indexing.fileCaps.*`, `indexing.fileScan.*`.
  - Tests: `tests/discover.js`, `tests/file-size-guard.js`, `tests/skip-minified-binary.js`.
  - Limitations: git-backed discovery only applies when `repoRoot` matches git top-level.

- Claim: language chunkers emit stable chunk `kind` + `name` plus language-specific metadata; mixed formats use segmented pipelines.
  - Implementation: `src/index/segments.js` (`discoverSegments`, `chunkSegments`), `src/index/build/file-processor.js` (`processFile`), `src/lang/*` (language chunkers), `src/lang/tree-sitter.js` (`chunkFileTreeSitter`).
  - Config: `indexing.treeSitter.*`, `indexing.javascriptParser`, `indexing.typescriptParser`.
  - Tests: `tests/segment-pipeline.js`, `tests/format-fidelity.js`, `tests/tree-sitter-chunks.js`.
  - Limitations: unsupported languages fall back to coarse chunking.

- Claim: config-like formats (JSON/YAML/TOML/etc) chunk into deterministic sections.
  - Implementation: `src/index/chunking.js` (`chunkJson`, `chunkYaml`, `chunkIniToml`, `smartChunk`).
  - Config: `indexing.yamlChunking`, `indexing.yamlTopLevelMaxBytes`.
  - Tests: `tests/chunking-yaml.js`, `tests/chunking-sql-lua.js`.
  - Limitations: large single documents may be grouped into a single section.

- Claim: token postings are generated from chunk tokens and dictionary settings with optional sampling.
  - Implementation: `src/index/build/postings.js` (`buildPostings`), `src/shared/postings-config.js` (`normalizePostingsConfig`), `src/index/build/artifacts.js` (`writeIndexArtifacts`).
  - Config: `indexing.chunkTokenMode`, `indexing.chunkTokenMaxFiles`, `indexing.chunkTokenMaxTokens`, `indexing.chunkTokenSampleSize`, `indexing.postings.*`.
  - Tests: `tests/tokenize-dictionary.js`, `tests/tokenization-buffering.js`, `tests/postings-quantize.js`.
  - Limitations: sampling mode omits full token lists to control artifact size.

## Artifact invariants and determinism
- Claim: artifacts include chunk metadata, token postings, repo map, optional dense vectors, and metrics with checksums.
  - Implementation: `src/index/build/artifacts.js` (`writeIndexArtifacts`), `src/shared/artifact-io.js` (`readJsonFile`, `loadTokenPostings`), `src/shared/hash.js` (`checksumFile`).
  - Config: `indexing.artifacts.*`, `indexing.artifactCompression.*`, `indexing.postings.*`.
  - Tests: `tests/artifact-formats.js`, `tests/artifact-size-guardrails.js`, `tests/index-validate.js`, `tests/compact-pieces.js`.
  - Limitations: optional artifacts are absent when features are disabled.

- Claim: `chunk.id` values are sequential (index-local) while `metaV2.chunkId` remains stable across builds; shard merge preserves metadata.
  - Implementation: `src/index/metadata-v2.js` (`buildChunkId`), `src/index/build/shards.js` (`mergeShards`), `src/index/validate.js` (`validateChunkIds`).
  - Config: `indexing.artifacts.*`.
  - Tests: `tests/metadata-v2.js`, `tests/chunking-limits.js`, `tests/graph-chunk-id.js`, `tests/sqlite-chunk-id.js`, `tests/shard-merge.js`, `tests/piece-assembly.js`.
  - Limitations: sharded outputs may be large on big repos.

- Claim: incremental reuse rejects deletions and stale manifests.
  - Implementation: `src/index/build/incremental.js` (`shouldReuseIncrementalIndex`, `pruneIncrementalManifest`).
  - Config: CLI `--incremental`.
  - Tests: `tests/incremental-reuse.js`, `tests/incremental-manifest.js`.
  - Limitations: reuse relies on size/mtime heuristics.

## Search semantics and ranking
- Claim: search filters support type/kind, signature, decorator, path/ext, and language constraints.
  - Implementation: `src/retrieval/filters.js` (`parseMetaFilters`, `normalizeExtFilter`, `normalizeLangFilter`), `src/retrieval/output/filters.js` (`filterChunks`), `src/retrieval/cli.js` (flag parsing).
  - Config: CLI `--type`, `--signature`, `--decorator`, `--path`, `--ext`, `--lang`.
  - Tests: `tests/search-filters.js`, `tests/fixture-smoke.js`, `tests/lang-filter.js`, `tests/ext-filter.js`.
  - Limitations: filters depend on metadata availability per language.

- Claim: restrictive filters are applied early so `--top N` returns N results when available.
  - Implementation: `src/retrieval/pipeline.js` (`createSearchPipeline`, `runSearch`), `src/retrieval/rankers.js` (`rankBM25`, `rankBM25Fields`), `src/retrieval/sqlite-helpers.js` (`rankSqliteFts`).
  - Config: CLI `--top`, filter flags; `search.sqliteAutoChunkThreshold`.
  - Tests: `tests/search-topn-filters.js`.
  - Limitations: SQLite large allowed sets use best-effort pushdown.

- Claim: risk filters narrow results by tags, sources, sinks, and flow identifiers.
  - Implementation: `src/index/risk.js` (`detectRiskSignals`), `src/index/type-inference-crossfile.js` (`addRiskFlow`), `src/retrieval/output/filters.js` (`filterChunks`).
  - Config: `indexing.riskAnalysis`, `indexing.riskAnalysisCrossFile`, CLI `--risk*` flags.
  - Tests: `tests/language-fidelity.js`, `tests/type-inference-crossfile.js`.
  - Limitations: risk data is best-effort and may be empty for unsupported languages.

- Claim: explain output includes score breakdowns and backend policy hints.
  - Implementation: `src/retrieval/output/explain.js` (`formatScoreBreakdown`), `src/retrieval/output/format.js` (`formatFullChunk`), `src/retrieval/cli.js` (explain selection).
  - Config: CLI `--explain`, `--why`.
  - Tests: `tests/search-explain.js`.
  - Limitations: explain output is only available for JSON/human modes that emit it.

- Claim: ranking blends BM25 + ANN with optional RRF; ANN backends are exercised by sqlite, HNSW, and LanceDB tests.
  - Implementation: `src/retrieval/pipeline.js` (`mergeRanked`, `blendRanked`), `src/retrieval/rankers.js` (`rankDenseVectors`), `src/shared/hnsw.js` (`loadHnswIndex`).
  - Config: `search.bm25.*`, `search.scoreBlend.*`, `search.rrf.*`, `search.annDefault`; CLI `--ann`.
  - Tests: `tests/fielded-bm25.js`, `tests/search-rrf.js`, `tests/search-symbol-boost.js`, `tests/sqlite-ann-extension.js`, `tests/hnsw-ann.js`.
  - Limitations: ANN requires embeddings (and optional sqlite extension).

- Claim: tie-breaks are deterministic at each stage (sparse, ANN, merge).
  - Implementation: `src/retrieval/rankers.js` (score + `idx` ordering), `src/retrieval/pipeline.js` (`mergeRanked`), `src/retrieval/sqlite-helpers.js` (rowid ordering).
  - Config: None.
  - Tests: `tests/search-determinism.js`, `tests/sqlite-vec-candidate-set.js`.
  - Limitations: determinism assumes stable inputs and stub embeddings where applicable.

- Claim: context expansion uses relations to include related chunks around hits.
  - Implementation: `src/retrieval/context-expansion.js` (`expandContext`).
  - Config: `search.contextExpansion.*`.
  - Tests: `tests/context-expansion.js`.
  - Limitations: context expansion requires relations metadata.

## Service/API/MCP behavior
- Claim: indexer service queue persists jobs, supports claim/complete transitions, and runs repo-scoped builds.
  - Implementation: `tools/service/queue.js` (`enqueueJob`, `claimNextJob`, `completeJob`), `tools/indexer-service.js` (queue workers), `tools/service/config.js` (`loadServiceConfig`).
  - Config: service config (`tools/service/config.js`) `queue.maxQueued`, `worker.concurrency`, `embeddings.queue.maxQueued`, `embeddings.worker.*`; CLI `--config`, `--queue`.
  - Tests: `tests/service-queue.js`, `tests/indexer-service.js`.
  - Limitations: queue storage is local filesystem state.

- Claim: embedding and stage queues enforce maxQueued limits with best-effort enqueue.
  - Implementation: `src/integrations/core/index.js` (`enqueueJob` usage), `tools/indexer-service.js` (`handleEnqueue`).
  - Config: `indexing.embeddings.queue.maxQueued`, `indexing.embeddings.queue.dir`, `indexing.twoStage.queue`, `indexing.twoStage.background`.
  - Tests: `tests/two-stage-state.js`.
  - Limitations: enqueue is skipped when queue is full.

- Claim: API server exposes build/search endpoints and streams responses when requested.
  - Implementation: `tools/api-server.js` (server entry), `tools/api/router.js` (`createApiRouter`), `tools/api/validation.js` (`validateSearchPayload`).
  - Config: CLI `--repo`; environment `PAIROFCLEATS_*` config values.
  - Tests: `tests/api-server.js`, `tests/api-server-stream.js`.
  - Limitations: streaming requires clients to handle SSE backpressure.

- Claim: MCP server enforces per-tool timeouts and queue limits.
  - Implementation: `tools/mcp-server.js` (queue/timeouts), `tools/mcp/transport.js` (`createMcpTransport`), `tools/mcp/repo.js` (`resolveToolTimeoutMs`).
  - Config: `mcp.queueMax`, `mcp.toolTimeoutMs`, `mcp.toolTimeouts`; environment `PAIROFCLEATS_MCP_QUEUE_MAX`, `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.
  - Tests: `tests/mcp-robustness.js`, `tests/mcp-schema.js`.
  - Limitations: long-running tools require explicit overrides.

- Claim: MCP server advertises core resources and tool actions using repo-scoped config.
  - Implementation: `tools/mcp-server.js` (tool defs), `src/integrations/mcp/defs.js` (`getToolDefs`).
  - Config: CLI `--repo`; environment `PAIROFCLEATS_*` config values.
  - Tests: `tests/mcp-server.js`.
  - Limitations: tools are limited to configured repo root.

## Determinism and provenance
- Claim: discovery ordering is deterministic and metrics include tool/runtime provenance.
  - Implementation: `src/index/build/discover.js` (`discoverFiles`), `src/index/build/artifacts.js` (`writeIndexArtifacts`), `src/index/git.js` (`getGitInfo`).
  - Config: `PAIROFCLEATS_*` env for config hash inputs.
  - Tests: `tests/discover.js`, `tests/repo-root.js`, `tests/tool-root.js`.
  - Limitations: timestamps and external tools can introduce non-deterministic fields.
