# Truth table

This document maps user-visible behavior to implementation, configuration switches, tests, and limitations.

## Build modes and stages
- Claim: `build_index.js --mode code|prose|records|extracted-prose|all` builds mode-specific indexes under the repo cache; `all` expands to `code`, `prose`, `extracted-prose`, and `records`.
  - Implementation: `build_index.js` (entrypoint), `src/index/build/args.js` (`parseBuildArgs`), `src/integrations/core/index.js` (`buildIndex`), `src/index/build/indexer.js` (`buildIndexForMode`), `tools/dict-utils.js` (`resolveIndexRoot`, `getIndexDir`).
  - Config: CLI `--mode`, `--repo`, `--index-root`; environment `PAIROFCLEATS_CACHE_ROOT`.
  - Tests: `tests/indexing/fixtures/build-and-artifacts.test.js`, `tests/indexing/extracted-prose/extracted-prose.test.js`, `tests/tooling/triage/records-index-and-search.test.js`, `tests/cli/build-index/build-index-all.test.js`.
  - Limitations: `records` requires triage record inputs.

- Claim: stage flags gate enrichment (`stage1` sparse, `stage2` relations, `stage3` embeddings, `stage4` sqlite).
  - Implementation: `src/integrations/core/index.js` (`buildIndex`), `src/index/build/indexer.js` (`buildIndexForMode`), `src/index/build/runtime.js` (`normalizeStage`, `buildStageOverrides`), `tools/build-embeddings.js` (script entrypoint), `tools/build-sqlite-index.js` (script entrypoint).
  - Config: CLI `--stage`, `--stage1`, `--stage2`, `--stage3`, `--stage4`; `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`; environment `PAIROFCLEATS_STAGE`.
  - Tests: `tests/indexing/runtime/two-stage-state.test.js`, `tests/indexing/embeddings/embeddings-validate.test.js`, `tests/storage/sqlite/sqlite-build-indexes.test.js`.
  - Limitations: stage3 requires embeddings; stage4 requires sqlite dependencies.

- Claim: `index_state.json` gates readers on pending stage outputs (embeddings/sqlite/lmdb).
  - Implementation: `src/index/build/artifacts.js` (`writeIndexArtifacts`), `tools/build-embeddings.js` (index_state updates), `tools/build-sqlite-index.js` (index_state updates), `tools/build-lmdb-index.js` (`updateLmdbState`), `src/retrieval/cli.js` (pending warnings), `src/retrieval/cli/index-loader.js` (`warnPendingState`).
  - Config: `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`, `lmdb.use`.
  - Tests: `tests/indexing/runtime/two-stage-state.test.js`, `tests/indexing/embeddings/embeddings-validate.test.js`, `tests/storage/sqlite/incremental/file-manifest-updates.test.js`, `tests/storage/lmdb/lmdb-backend.test.js`.
  - Limitations: manual edits can override gating.

## Optional dependency test policy
- Claim: tests that require optional dependencies must skip (exit 77) when the dependency is unavailable.
  - Implementation: `tests/helpers/optional-deps.js`, `tests/helpers/skip.js`.
  - Config: n/a (policy enforced by test helpers).
  - Tests: `tests/retrieval/ann/hnsw-ann.test.js`, `tests/retrieval/ann/hnsw-distance-metrics.test.js`, `tests/retrieval/ann/hnsw-candidate-set.test.js`, `tests/retrieval/ann/lancedb-ann.test.js`, `tests/storage/sqlite/ann/sqlite-ann-extension.test.js`, `tests/indexing/embeddings/embeddings-sqlite-dense.test.js`.
  - Limitations: CI environments without optional deps report skips (not failures).

## Backend selection
- Claim: `search --backend auto` prefers sqlite when available and thresholds hit; `--backend sqlite|sqlite-fts` fails cleanly when missing; `--backend memory` uses file-backed indexes.
  - Implementation: `src/storage/backend-policy.js` (`resolveBackendPolicy`), `src/retrieval/cli.js` (`resolveBackendPolicy` usage), `src/retrieval/cli-sqlite.js` (`createSqliteBackend`).
  - Config: CLI `--backend`; `search.sqliteAutoChunkThreshold`, `search.sqliteAutoArtifactBytes`, `sqlite.use`; environment `PAIROFCLEATS_SQLITE_DISABLED` (tests).
  - Tests: `tests/storage/sqlite/sqlite-auto-backend.test.js`, `tests/storage/sqlite/sqlite-missing-dep.test.js`, `tests/storage/backend/backend-policy.test.js`.
  - Limitations: sqlite requires `better-sqlite3` (and optional ANN extension); auto thresholds are disabled when set to `0`, and missing stats trigger a warning + memory fallback.

- Claim: `--backend lmdb` uses LMDB stores when present; auto fallback selects LMDB when sqlite is unavailable.
  - Implementation: `src/storage/backend-policy.js` (`resolveBackendPolicy`), `src/retrieval/cli-lmdb.js` (`createLmdbBackend`), `tools/build-lmdb-index.js` (LMDB build entrypoint).
  - Config: CLI `--backend`; `lmdb.use`, `lmdb.*` paths.
  - Tests: `tests/storage/lmdb/lmdb-backend.test.js`, `tests/storage/backend/backend-policy.test.js`.
  - Limitations: LMDB requires `lmdb` dependency and pre-built stores.

## Discovery, chunking, and tokenization
- Claim: file discovery honors ignore rules, minified/binary detection, and per-extension caps.
  - Implementation: `src/index/build/discover.js` (`discoverFiles`, `discoverFilesForModes`), `src/index/build/ignore.js` (`createIgnoreMatcher`), `src/shared/files.js` (`isBinaryFile`, `isMinifiedFile`).
  - Config: `indexing.maxFileBytes`, `indexing.fileCaps.*`, `indexing.fileScan.*`.
  - Tests: `tests/indexing/discovery/discover.test.js`, `tests/indexing/file-caps/file-size-guard.test.js`, `tests/indexing/file-processor/skip-minified-binary.test.js`.
  - Limitations: git-backed discovery only applies when `repoRoot` matches git top-level.

- Claim: language chunkers emit stable chunk `kind` + `name` plus language-specific metadata; mixed formats use segmented pipelines.
  - Implementation: `src/index/segments.js` (`discoverSegments`, `chunkSegments`), `src/index/build/file-processor.js` (`processFile`), `src/lang/*` (language chunkers), `src/lang/tree-sitter.js` (`chunkFileTreeSitter`).
  - Config: `indexing.treeSitter.*`, `indexing.javascriptParser`, `indexing.typescriptParser`.
  - Tests: `tests/indexing/segments/segment-pipeline.test.js`, `tests/indexing/chunking/formats/format-fidelity.test.js`, `tests/indexing/tree-sitter/tree-sitter-chunks.test.js`.
  - Limitations: unsupported languages fall back to coarse chunking.

- Claim: config-like formats (JSON/YAML/TOML/etc) chunk into deterministic sections.
  - Implementation: `src/index/chunking.js` (`chunkJson`, `chunkYaml`, `chunkIniToml`, `smartChunk`).
  - Config: `indexing.yamlChunking`, `indexing.yamlTopLevelMaxBytes`.
  - Tests: `tests/indexing/chunking/chunking-yaml.test.js`, `tests/indexing/chunking/chunking-sql-lua.test.js`.
  - Limitations: large single documents may be grouped into a single section.

- Claim: token postings are generated from chunk tokens and dictionary settings with optional sampling.
  - Implementation: `src/index/build/postings.js` (`buildPostings`), `src/shared/postings-config.js` (`normalizePostingsConfig`), `src/index/build/artifacts.js` (`writeIndexArtifacts`).
  - Config: `indexing.chunkTokenMode`, `indexing.chunkTokenMaxFiles`, `indexing.chunkTokenMaxTokens`, `indexing.chunkTokenSampleSize`, `indexing.postings.*`.
  - Tests: `tests/indexing/tokenization/tokenize-dictionary.test.js`, `tests/indexing/tokenization/tokenization-buffering.test.js`, `tests/indexing/postings/postings-quantize.test.js`.
  - Limitations: sampling mode omits full token lists to control artifact size.

## Artifact invariants and determinism
- Claim: artifacts include chunk metadata, token postings, repo map, optional dense vectors, and metrics with checksums.
  - Implementation: `src/index/build/artifacts.js` (`writeIndexArtifacts`), `src/shared/artifact-io.js` (`readJsonFile`, `loadTokenPostings`), `src/shared/hash.js` (`checksumFile`).
  - Config: `indexing.artifacts.*`, `indexing.artifactCompression.*`, `indexing.postings.*`.
  - Tests: `tests/indexing/artifacts/artifact-formats.test.js`, `tests/indexing/artifacts/artifact-size-guardrails.test.js`, `tests/indexing/validate/index-validate.test.js`.
  - Limitations: optional artifacts are absent when features are disabled.

- Claim: `chunk.id` values are sequential (index-local) while `metaV2.chunkId` remains stable across builds; shard merge preserves metadata.
  - Implementation: `src/index/metadata-v2.js` (`buildChunkId`), `src/index/build/shards.js` (`mergeShards`), `src/index/validate.js` (`validateChunkIds`).
  - Config: `indexing.artifacts.*`.
  - Tests: `tests/indexing/metav2/metadata-v2.test.js`, `tests/indexing/chunking/chunking-limits.test.js`, `tests/indexing/relations/graph-chunk-id.test.js`, `tests/storage/sqlite/sqlite-chunk-id.test.js`, `tests/indexing/shards/shard-merge.test.js`, `tests/indexing/piece-assembly/piece-assembly.test.js`.
  - Limitations: sharded outputs may be large on big repos.

- Claim: incremental reuse rejects deletions and stale manifests.
  - Implementation: `src/index/build/incremental.js` (`shouldReuseIncrementalIndex`, `pruneIncrementalManifest`).
  - Config: CLI `--incremental`.
  - Tests: `tests/indexing/incremental/incremental-reuse.test.js`, `tests/indexing/incremental/incremental-manifest.test.js`.
  - Limitations: reuse relies on size/mtime heuristics.

## Search semantics and ranking
- Claim: search filters support type/kind, signature, decorator, path/ext, and language constraints.
  - Implementation: `src/retrieval/filters.js` (`parseMetaFilters`, `normalizeExtFilter`, `normalizeLangFilter`), `src/retrieval/output/filters.js` (`filterChunks`), `src/retrieval/cli.js` (flag parsing).
  - Config: CLI `--type`, `--signature`, `--decorator`, `--path`, `--ext`, `--lang`.
  - Tests: `tests/retrieval/filters/query-syntax/negative-terms.test.js`, `tests/retrieval/filters/ext-path.test.js`, `tests/retrieval/filters/lang-filter.test.js`, `tests/retrieval/filters/ext-filter.test.js`.
  - Limitations: filters depend on metadata availability per language.

- Claim: restrictive filters are applied early so `--top N` returns N results when available.
  - Implementation: `src/retrieval/pipeline.js` (`createSearchPipeline`, `runSearch`), `src/retrieval/rankers.js` (`rankBM25`, `rankBM25Fields`), `src/retrieval/sqlite-helpers.js` (`rankSqliteFts`).
  - Config: CLI `--top`, filter flags; `search.sqliteAutoChunkThreshold`.
  - Tests: `tests/cli/search/search-topn-filters.test.js`.
  - Limitations: SQLite large allowed sets use best-effort pushdown.

- Claim: risk filters narrow results by tags, sources, sinks, and flow identifiers.
  - Implementation: `src/index/risk.js` (`detectRiskSignals`), `src/index/type-inference-crossfile.js` (`addRiskFlow`), `src/retrieval/output/filters.js` (`filterChunks`).
  - Config: `indexing.riskAnalysis`, `indexing.riskAnalysisCrossFile`, CLI `--risk*` flags.
  - Tests: `tests/retrieval/filters/risk.test.js`, `tests/indexing/type-inference/crossfile/crossfile-output.integration.test.js`.
  - Limitations: risk data is best-effort and may be empty for unsupported languages.

- Claim: explain output includes score breakdowns and backend policy hints.
  - Implementation: `src/retrieval/output/explain.js` (`formatScoreBreakdown`), `src/retrieval/output/format.js` (`formatFullChunk`), `src/retrieval/cli.js` (explain selection).
  - Config: CLI `--explain`, `--why`.
  - Tests: `tests/cli/search/search-explain-symbol.test.js`, `tests/cli/search/search-rrf.test.js`, `tests/retrieval/contracts/result-shape.test.js`, `tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js`.
  - Limitations: explain output is only available for JSON/human modes that emit it.

- Claim: ranking blends BM25 + ANN with optional RRF; ANN backends are exercised by sqlite, HNSW, and LanceDB tests.
  - Implementation: `src/retrieval/pipeline.js` (`mergeRanked`, `blendRanked`), `src/retrieval/rankers.js` (`rankDenseVectors`), `src/shared/hnsw.js` (`loadHnswIndex`).
  - Config: `search.bm25.*`, `search.scoreBlend.*`, `search.rrf.*`, `search.annDefault`; CLI `--ann`.
  - Tests: `tests/retrieval/ranking/fielded-bm25.test.js`, `tests/cli/search/search-rrf.test.js`, `tests/cli/search/search-symbol-boost.test.js`, `tests/storage/sqlite/ann/sqlite-ann-extension.test.js`, `tests/retrieval/ann/hnsw-ann.test.js`.
  - Limitations: ANN requires embeddings (and optional sqlite extension).

- Claim: tie-breaks are deterministic at each stage (sparse, ANN, merge).
  - Implementation: `src/retrieval/rankers.js` (score + `idx` ordering), `src/retrieval/pipeline.js` (`mergeRanked`), `src/retrieval/sqlite-helpers.js` (rowid ordering).
  - Config: None.
  - Tests: `tests/cli/search/search-determinism.test.js`, `tests/storage/sqlite/ann/sqlite-vec-candidate-set.test.js`.
  - Limitations: determinism assumes stable inputs and stub embeddings where applicable.

- Claim: context expansion uses relations to include related chunks around hits.
  - Implementation: `src/retrieval/context-expansion.js` (`expandContext`).
  - Config: `search.contextExpansion.*`.
  - Tests: `tests/retrieval/context/context-expansion.test.js`.
  - Limitations: context expansion requires relations metadata.

## Service/API/MCP behavior
- Claim: indexer service queue persists jobs, supports claim/complete transitions, and runs repo-scoped builds.
  - Implementation: `tools/service/queue.js` (`enqueueJob`, `claimNextJob`, `completeJob`), `tools/indexer-service.js` (queue workers), `tools/service/config.js` (`loadServiceConfig`).
  - Config: service config (`tools/service/config.js`) `queue.maxQueued`, `worker.concurrency`, `embeddings.queue.maxQueued`, `embeddings.worker.*`; CLI `--config`, `--queue`.
  - Tests: `tests/services/queue/service-queue.test.js`, `tests/services/indexer/indexer-service.test.js`.
  - Limitations: queue storage is local filesystem state.

- Claim: embedding and stage queues enforce maxQueued limits with best-effort enqueue.
  - Implementation: `src/integrations/core/index.js` (`enqueueJob` usage), `tools/indexer-service.js` (`handleEnqueue`).
  - Config: `indexing.embeddings.queue.maxQueued`, `indexing.embeddings.queue.dir`, `indexing.twoStage.queue`, `indexing.twoStage.background`.
  - Tests: `tests/indexing/runtime/two-stage-state.test.js`.
  - Limitations: enqueue is skipped when queue is full.

- Claim: API server exposes build/search endpoints and streams responses when requested.
  - Implementation: `tools/api-server.js` (server entry), `tools/api/router.js` (`createApiRouter`), `tools/api/validation.js` (`validateSearchPayload`).
  - Config: CLI `--repo`; environment `PAIROFCLEATS_*` config values.
  - Tests: `tests/services/api/health-and-status.test.js`, `tests/services/api/search-happy-path.test.js`, `tests/services/api/api-server-stream.test.js`.
  - Limitations: streaming requires clients to handle SSE backpressure.

- Claim: MCP server enforces per-tool timeouts and queue limits.
  - Implementation: `tools/mcp-server.js` (queue/timeouts), `tools/mcp/transport.js` (`createMcpTransport`), `tools/mcp/repo.js` (`resolveToolTimeoutMs`).
  - Config: `mcp.queueMax`, `mcp.toolTimeoutMs`, `mcp.toolTimeouts`; environment `PAIROFCLEATS_MCP_QUEUE_MAX`, `PAIROFCLEATS_MCP_TOOL_TIMEOUT_MS`.
  - Tests: `tests/services/mcp/mcp-robustness.test.js`, `tests/services/mcp/mcp-runner-abort-kills-child.test.js`, `tests/services/mcp/mcp-schema.test.js`.
  - Limitations: long-running tools require explicit overrides.

- Claim: MCP server advertises core resources and tool actions using repo-scoped config.
  - Implementation: `tools/mcp-server.js` (tool defs), `src/integrations/mcp/defs.js` (`getToolDefs`).
  - Config: CLI `--repo`; environment `PAIROFCLEATS_*` config values.
  - Tests: `tests/services/mcp/tools-list.test.js`.
  - Limitations: tools are limited to configured repo root.

## Determinism and provenance
- Claim: discovery ordering is deterministic and metrics include tool/runtime provenance.
  - Implementation: `src/index/build/discover.js` (`discoverFiles`), `src/index/build/artifacts.js` (`writeIndexArtifacts`), `src/index/git.js` (`getGitInfo`).
  - Config: `PAIROFCLEATS_*` env for config hash inputs.
  - Tests: `tests/indexing/discovery/discover.test.js`, `tests/cli/general/repo-root.test.js`, `tests/tooling/install/tool-root.test.js`.
  - Limitations: timestamps and external tools can introduce non-deterministic fields.
