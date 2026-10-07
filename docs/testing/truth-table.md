# Truth table

This document maps user-visible behavior to implementation seams, primary knobs, and the current test suites that carry the contract today.

## Build modes and stages

- Claim: `build_index.js --mode code|prose|records|extracted-prose|all` builds mode-specific indexes under the repo cache, and `all` expands to every supported mode.
  - Implementation: `build_index.js`, `src/index/build/args.js`, `src/integrations/core/index.js`, `src/index/build/indexer.js`, `tools/shared/dict-utils.js`
  - Config: CLI `--mode`, `--repo`, `--index-root`; environment `PAIROFCLEATS_CACHE_ROOT`
  - Tests: `tests/indexing/fixtures/build-and-artifacts.test.js`, `tests/indexing/extracted-prose/core.test.js`, `tests/tooling/triage/records-index-and-search.test.js`, `tests/cli/build-index/all.test.js`
  - Limitations: `records` depends on available triage record inputs

- Claim: stage flags gate enrichment (`stage1` sparse, `stage2` relations, `stage3` embeddings, `stage4` sqlite).
  - Implementation: `src/integrations/core/index.js`, `src/index/build/indexer.js`, `src/index/build/runtime.js`, `tools/build/embeddings.js`, `tools/build/sqlite/runner.js`
  - Config: CLI `--stage`, `--stage1`, `--stage2`, `--stage3`, `--stage4`; `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`; environment `PAIROFCLEATS_STAGE`
  - Tests: `tests/indexing/runtime/two-stage-state.test.js`, `tests/indexing/embeddings/validate.test.js`, `tests/storage/sqlite/build-indexes.test.js`
  - Limitations: stage3 requires embeddings; stage4 requires sqlite dependencies

- Claim: `index_state.json` gates readers on pending stage outputs.
  - Implementation: `src/index/build/artifacts.js`, `tools/build/embeddings.js`, `tools/build/sqlite/runner.js`, `src/retrieval/cli/index-loader.js`
  - Config: `indexing.twoStage.*`, `indexing.embeddings.*`, `sqlite.use`, `lmdb.use`
  - Tests: `tests/indexing/runtime/two-stage-state.test.js`, `tests/indexing/embeddings/validate.test.js`, `tests/storage/sqlite/incremental/file-manifest-updates.test.js`, `tests/storage/lmdb/contract-matrix.test.js`
  - Limitations: manual artifact edits can still invalidate state outside the normal build path

## Optional dependency policy

- Claim: tests that require optional dependencies skip cleanly when the dependency is unavailable.
  - Implementation: `tests/helpers/optional-deps.js`, `tests/helpers/skip.js`
  - Config: n/a
  - Tests: `tests/retrieval/ann/hnsw-runtime-contract-matrix.test.js`, `tests/retrieval/ann/lancedb-runtime-contract-matrix.test.js`, `tests/storage/sqlite/ann/sqlite-extension.test.js`, `tests/indexing/embeddings/sqlite-dense.test.js`
  - Limitations: CI environments without optional deps report skips instead of failures

## Backend selection

- Claim: `search --backend auto` prefers sqlite when available and falls back cleanly when dependencies or thresholds do not permit it.
  - Implementation: `src/storage/backend-policy.js`, `src/retrieval/cli.js`, `src/retrieval/cli-sqlite.js`
  - Config: CLI `--backend`; `search.sqliteAutoChunkThreshold`, `search.sqliteAutoArtifactBytes`, `sqlite.use`
  - Tests: `tests/storage/sqlite/search-backend-contract-matrix.test.js`, `tests/storage/backend/policy.test.js`, `tests/retrieval/backend/backend-contract-matrix.test.js`
  - Limitations: sqlite still requires `better-sqlite3` and optional ANN extension support

- Claim: `--backend lmdb` uses LMDB stores when present.
  - Implementation: `src/storage/backend-policy.js`, `src/retrieval/cli-lmdb.js`, `tools/build/lmdb-index.js`
  - Config: CLI `--backend`; `lmdb.use`, `lmdb.*`
  - Tests: `tests/storage/lmdb/contract-matrix.test.js`, `tests/storage/backend/policy.test.js`
  - Limitations: LMDB requires the `lmdb` dependency and prebuilt stores

## Discovery, chunking, and tokenization

- Claim: file discovery honors ignore rules, minified/binary detection, and per-file caps.
  - Implementation: `src/index/build/discover.js`, `src/index/build/ignore.js`, `src/shared/files.js`
  - Config: `indexing.maxFileBytes`, `indexing.fileCaps.*`, `indexing.fileScan.*`
  - Tests: `tests/indexing/discovery/contract-matrix.test.js`, `tests/indexing/file-caps/contract-matrix.test.js`, `tests/indexing/file-processor/skip-minified-binary.test.js`
  - Limitations: file classification still depends on heuristic binary and minified detection

- Claim: language chunkers emit stable chunk metadata, and segmented formats route through the appropriate pipeline.
  - Implementation: `src/index/segments.js`, `src/index/build/file-processor.js`, `src/lang/*`, `src/lang/tree-sitter.js`
  - Config: `indexing.treeSitter.*`, parser-specific config
  - Tests: `tests/indexing/segments/segment-pipeline.test.js`, `tests/indexing/chunking/formats/format-fidelity.test.js`, `tests/indexing/tree-sitter/chunks.test.js`
  - Limitations: parser-backed chunking still depends on the available parser/runtime for a language

- Claim: structured/config-like formats chunk into deterministic sections.
  - Implementation: `src/index/chunking.js`
  - Config: `indexing.yamlChunking`, `indexing.yamlTopLevelMaxBytes`
  - Tests: `tests/indexing/chunking/yaml.test.js`, `tests/indexing/chunking/sql-lua.test.js`, `tests/indexing/chunking/ini-toml.test.js`
  - Limitations: section boundaries are format-specific and may intentionally differ from semantic language chunks

- Claim: token postings are generated from chunk tokens and dictionary settings with bounded artifact growth.
  - Implementation: `src/index/build/postings.js`, `src/shared/postings-config.js`, `src/index/build/artifacts.js`
  - Config: `indexing.chunkTokenMode`, `indexing.postings.*`
  - Tests: `tests/indexing/tokenization/tokenize-dictionary.test.js`, `tests/indexing/tokenization/buffering.test.js`, `tests/indexing/postings/quantize.test.js`, `tests/indexing/postings/queue-contract-matrix.test.js`
  - Limitations: postings size controls trade memory and disk cost against recall and debugging fidelity

## Artifact invariants and determinism

- Claim: artifacts include chunk metadata, token postings, repo map, optional dense vectors, and metrics with strict validation.
  - Implementation: `src/index/build/artifacts.js`, `src/shared/artifact-io.js`, `src/shared/hash.js`
  - Config: `indexing.artifacts.*`, `indexing.postings.*`
  - Tests: `tests/indexing/artifacts/artifact-formats.test.js`, `tests/indexing/artifacts/artifact-size-guardrails.test.js`, `tests/indexing/validate/index-contract-matrix.test.js`
  - Limitations: optional artifacts such as dense vectors still depend on enabled stages and available dependencies

- Claim: chunk identity and related metadata remain deterministic across shard merge and piece assembly.
  - Implementation: `src/index/metadata-v2.js`, `src/index/build/shards.js`, `src/index/validate.js`
  - Config: `indexing.artifacts.*`
  - Tests: `tests/indexer/metav2/contract-matrix.test.js`, `tests/indexing/chunking/limits.test.js`, `tests/indexing/relations/call-graph-contract-matrix.test.js`, `tests/storage/sqlite/chunk-id.test.js`, `tests/indexing/shards/shard-progress-determinism.test.js`, `tests/indexing/piece-assembly/core.test.js`
  - Limitations: determinism assumes stable file ordering and unchanged upstream chunk inputs

- Claim: incremental reuse rejects stale or incompatible state.
  - Implementation: `src/index/build/incremental.js`
  - Config: CLI `--incremental`
  - Tests: `tests/indexing/incremental/reuse.test.js`, `tests/indexing/incremental/manifest.test.js`
  - Limitations: reuse can still be bypassed intentionally by forcing clean rebuild paths

## Search semantics and ranking

- Claim: search filters support path/ext/lang/type and related metadata constraints.
  - Implementation: `src/retrieval/filters.js`, `src/retrieval/output/filters.js`, `src/retrieval/cli.js`
  - Config: CLI `--type`, `--path`, `--ext`, `--lang`, `--filter`
  - Tests: `tests/retrieval/filters/filter-core-contract-matrix.test.js`, `tests/retrieval/filters/file-and-token/selector-contract-matrix.test.js`, `tests/retrieval/filters/search-filter-contract-matrix.test.js`
  - Limitations: available filter dimensions depend on the indexed metadata present for a build

- Claim: restrictive filters are applied early enough that `--top N` still returns N results when available.
  - Implementation: `src/retrieval/pipeline.js`, `src/retrieval/rankers.js`, `src/retrieval/sqlite-helpers.js`
  - Config: CLI `--top`, filter flags
  - Tests: `tests/cli/search/contract-matrix.test.js`, `tests/retrieval/pipeline/topk-contract-matrix.test.js`
  - Limitations: very selective filters can still produce fewer than `N` hits when the corpus truly lacks matches

- Claim: risk filters narrow results by tags, sources, sinks, and flow identifiers.
  - Implementation: `src/index/risk.js`, `src/index/type-inference-crossfile.js`, `src/retrieval/output/filters.js`
  - Config: `indexing.riskAnalysis*`, CLI `--risk*`
  - Tests: `tests/retrieval/filters/semantic-filter-contract-matrix.test.js`, `tests/indexing/type-inference/crossfile/output.integration.test.js`
  - Limitations: risk filtering quality depends on enabled analysis and available cross-file inference artifacts

- Claim: explain output includes score breakdowns and routing hints.
  - Implementation: `src/retrieval/output/explain.js`, `src/retrieval/output/format.js`, `src/retrieval/cli/render.js`
  - Config: CLI `--explain`, `--why`
  - Tests: `tests/cli/search/contract-matrix.test.js`, `tests/cli/search/ann-rrf-contract.test.js`, `tests/retrieval/contracts/result-shape.test.js`, `tests/retrieval/query/query-contract-matrix.test.js`
  - Limitations: explanation detail varies by backend and by which ranking components were active for a query

- Claim: query parsing is grammar-first with recoverable fallback.
  - Implementation: `src/retrieval/query.js`, `src/retrieval/cli/query-plan.js`, `src/retrieval/query-intent.js`
  - Config: n/a
  - Tests: `tests/retrieval/query/boolean-unary-not-whitespace.test.js`, `tests/retrieval/query/query-contract-matrix.test.js`, `tests/retrieval/query/boolean-inventory-vs-semantics.test.js`, `tests/retrieval/query/golden-corpus.test.js`
  - Limitations: fallback parsing may still normalize or reinterpret malformed user input

- Claim: ranking blends BM25 and ANN with deterministic tie-breaks.
  - Implementation: `src/retrieval/pipeline.js`, `src/retrieval/rankers.js`, `src/shared/hnsw.js`
  - Config: `search.scoreBlend.*`, `search.rrf.*`, `search.annDefault`; CLI `--ann`
  - Tests: `tests/retrieval/ranking/fielded-bm25.test.js`, `tests/cli/search/ann-rrf-contract.test.js`, `tests/cli/search/symbol-boost.test.js`, `tests/storage/sqlite/ann/sqlite-extension.test.js`, `tests/retrieval/ann/hnsw-runtime-contract-matrix.test.js`, `tests/cli/search/determinism.test.js`
  - Limitations: ANN-backed ranking depends on optional index availability and backend support

- Claim: context expansion uses relations to include related chunks around hits.
  - Implementation: `src/retrieval/context-expansion.js`
  - Config: `search.contextExpansion.*`
  - Tests: `tests/retrieval/context-expansion/context-expansion-contract-matrix.test.js`
  - Limitations: expansion quality is bounded by the relation graph materialized during indexing

## Service, API, and MCP behavior

- Claim: indexer service queue persists jobs and runs repo-scoped builds.
  - Implementation: `tools/service/queue.js`, `tools/service/indexer-service.js`, `tools/service/config.js`
  - Config: service config plus CLI `--config`, `--queue`
  - Tests: `tests/services/queue/service.test.js`, `tests/services/indexer/service.test.js`
  - Limitations: queued build throughput still depends on host process capacity and repo size

- Claim: API server exposes build/search routes and streams responses when requested.
  - Implementation: `tools/api/server.js`, `tools/api/router.js`, `tools/api/validation.js`
  - Config: CLI `--repo`, API config surface
  - Tests: `tests/services/api/core.test.js`, `tests/services/api/search-contract-matrix.test.js`, `tests/services/api/server-stream.test.js`, `tests/services/api/router-contract-matrix.test.js`
  - Limitations: streamed and federated paths depend on the configured backend and repo availability

- Claim: MCP server enforces queue limits and per-tool timeouts.
  - Implementation: `tools/mcp/server.js`, `tools/mcp/transport.js`, `tools/mcp/repo.js`
  - Config: `mcp.queueMax`, `mcp.toolTimeoutMs`, `mcp.toolTimeouts`
  - Tests: `tests/services/mcp/robustness.test.js`, `tests/services/mcp/runner-abort-kills-child.test.js`, `tests/services/mcp/schema.test.js`, `tests/services/mcp/tools-list.test.js`
  - Limitations: timeout behavior is ultimately bounded by child-process cleanup and host OS scheduling

## Determinism and release discipline

- Claim: release verification and lane evidence remain deterministic and auditable.
  - Implementation: `tools/release/check.js`, `tools/testing/generate-lane-evidence.js`, `tools/testing/generate-suite-taxonomy-report.js`
  - Config: CLI `--lane`, `--log-times`; generated ledger paths under `.testLogs/` and `docs/testing/`
  - Tests: `tests/tooling/release-check/filtering.test.js`, `tests/runner/lane-evidence.test.js`, `tests/runner/suite-taxonomy-report.test.js`
  - Limitations: audit output reflects the latest generated ledgers and can drift if timings are not refreshed
