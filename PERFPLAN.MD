# PERFPLAN

A focused performance plan to audit and optimize index build stages, improve search CLI startup time, harden VFS performance, reduce tree-sitter WASM churn, optimize retrieval/graph/map pipelines, strengthen shared IO/serialization, and implement a compressed global embeddings cache. This follows the repo roadmap format: objective, goals, non-goals, files, docs/specs, tasks, tests, acceptance.

---

## Status legend
- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete

---

## Phase 0 — Shared Component Audit + Dedupe (Foundations)

### Objective
Perform a cross-codebase audit for duplicate utility implementations, consolidate them into shared modules, and add tests so later phases rely on one canonical implementation.

### Goals
- Identify duplicate helpers (provenance resolution, truncation recording, limit normalization, etc.).
- Promote shared implementations and update all callers.
- Add tests that lock shared behavior and prevent regression.

### Non-goals
- Algorithmic changes to graph/retrieval/indexing behavior.
- New features or schema changes.

### Files to modify (exhaustive for this phase)
- `src/shared/provenance.js` (new)
- `src/shared/truncation.js` (new)
- `src/shared/limits.js` (new)
- `src/graph/impact.js`
- `src/graph/suggest-tests.js`
- `src/graph/architecture.js`
- `src/graph/context-pack.js`
- `src/context-pack/assemble.js`
- `src/integrations/tooling/api-contracts.js`
- `src/retrieval/context-expansion.js`
- `tools/perf/scan-duplicate-utilities.js` (new)
- `docs/perf/shared-component-audit.md` (new)
- `docs/guides/shared-components.md` (new)
- `tests/shared/provenance.test.js` (new)
- `tests/shared/truncation.test.js` (new)
- `tests/shared/limits-normalization.test.js` (new)
- `tests/perf/shared-component-audit.test.js` (new)

### Docs/specs to add or update
- `docs/perf/shared-component-audit.md` (new)
- `docs/guides/shared-components.md` (new)

### Tasks
- [ ] Inventory duplicate helper patterns across graph/context-pack/retrieval tooling.
- [ ] Implement shared helpers for provenance resolution, truncation recording, and limit normalization.
- [ ] Update all call sites to use shared helpers.
- [ ] Add a duplicate-utility scan and document required shared usage.
- [ ] Document shared component expectations and examples.

### Tests
- [ ] `tests/shared/provenance.test.js`
- [ ] `tests/shared/truncation.test.js`
- [ ] `tests/shared/limits-normalization.test.js`
- [ ] `tests/perf/shared-component-audit.test.js`

### Acceptance
- [ ] Duplicate helper implementations removed and replaced by shared modules.
- [ ] Tests enforce shared helper behavior and prevent drift.

---

## Phase 1 — Stage Audit Instrumentation + Report

### Objective
Add consistent timing/memory checkpoints across the 4 indexing stages to identify memory hotspots and slow paths, then produce an audit report with prioritized optimization candidates.

### Goals
- Produce per-stage memory/timing checkpoints (heap, rss, external, arrayBuffers).
- Surface a repeatable audit report per mode and per stage.

### Non-goals
- Implementing stage optimizations.
- Changing artifact schemas or query behavior.

### Files to modify (exhaustive for this phase)
- `src/index/build/indexer/pipeline.js`
- `src/index/build/perf-profile.js`
- `src/index/build/build-state.js`
- `src/index/build/state.js`
- `src/index/build/stage-checkpoints.js` (new)
- `src/index/build/indexer/steps/discover.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/indexer/steps/relations.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/indexer/steps/write.js`
- `tools/build-embeddings/runner.js`
- `tools/build-sqlite-index/runner.js`
- `docs/perf/indexing-stage-audit.md` (new)
- `tests/indexing/runtime/stage-memory-checkpoints.test.js` (new)
- `tests/indexing/runtime/stage-timing-checkpoints.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (new)

### Tasks
- [ ] Add per-stage checkpoints (time + heapUsed + rss + external + arrayBuffers).
- [ ] Record checkpoints in build state or perf profile (schema versioned).
- [ ] Emit a concise audit summary per mode and per stage.
- [ ] Capture high-watermarks for postings maps, chunk arrays, relations, and embeddings buffers.
- [ ] Document the audit output format and interpretation guide.

### Tests
- [ ] `tests/indexing/runtime/stage-memory-checkpoints.test.js`
- [ ] `tests/indexing/runtime/stage-timing-checkpoints.test.js`

### Acceptance
- [ ] Each stage records timing and memory checkpoints.
- [ ] Audit report is produced and documented.

---

## Phase 2 — Shared IO + Serialization Performance

### Objective
Optimize shared JSON streaming, artifact IO, and compression paths used across indexing and retrieval.

### Goals
- Reduce memory overhead during large JSON loads/writes.
- Improve throughput for artifact reads and writes.

### Non-goals
- Changing artifact schemas or file formats.
- Removing safety limits (MAX_JSON_BYTES).

### Files to modify (exhaustive for this phase)
- `src/shared/json-stream.js`
- `src/shared/json-stream/encode.js`
- `src/shared/json-stream/streams.js`
- `src/shared/json-stream/compress.js`
- `src/shared/json-stream/atomic.js`
- `src/shared/json-stream/runtime.js`
- `src/shared/artifact-io.js`
- `src/shared/artifact-io/constants.js`
- `src/shared/artifact-io/limits.js`
- `src/shared/artifact-io/manifest.js`
- `src/shared/artifact-io/loaders.js`
- `src/shared/artifact-io/json.js`
- `src/shared/artifact-io/jsonl.js`
- `src/shared/artifact-io/graph.js`
- `src/shared/artifact-io/compression.js`
- `src/shared/artifact-io/cache.js`
- `src/shared/artifact-io/fs.js`
- `src/shared/bundle-io.js`
- `src/shared/encoding.js`
- `src/shared/files.js`
- `src/shared/file-stats.js`
- `src/shared/lines.js`
- `docs/perf/shared-io-serialization.md` (new)
- `tests/shared/json-stream/large-array-stream.test.js` (new)
- `tests/shared/artifact-io/manifest-streaming.test.js` (new)
- `tests/shared/artifact-io/jsonl-stream-roundtrip.test.js` (new)

### Docs/specs to add or update
- `docs/perf/shared-io-serialization.md` (new)

### Tasks
- [ ] Enforce streaming decode/encode paths for large arrays and JSONL.
- [ ] Tune chunk sizes and backpressure handling in json-stream.
- [ ] Use bounded buffers for atomic writes and compression.
- [ ] Add shared IO telemetry hooks for large artifact reads.

### Tests
- [ ] `tests/shared/json-stream/large-array-stream.test.js`
- [ ] `tests/shared/artifact-io/manifest-streaming.test.js`
- [ ] `tests/shared/artifact-io/jsonl-stream-roundtrip.test.js`

### Acceptance
- [ ] Large artifact loads stay within memory bounds.
- [ ] Shared IO paths demonstrate improved throughput.

---

## Cross-cutting Tests to Run
- [ ] `node tests/run.js --lane ci-lite`
- [ ] `node tests/run.js --lane ci`

---

## Acceptance (overall)
- [ ] Stage audit report exists and highlights memory/perf hotspots.
- [ ] Global embeddings cache reduces recomputation and passes tests.
- [ ] Search CLI startup time improved without functional regressions.
- [ ] VFS correctness/perf improvements land before tree-sitter load changes.
- [ ] Retrieval, graph/context-pack, map, and shared IO perf improvements landed with tests.
- [ ] No artifact schema regressions.
- [ ] Documentation and JSDoc standards met.
## Phase 3 — Stage1 (Discovery + Chunking + Token Postings) Optimizations

### Objective
Reduce memory pressure in postings and chunk retention while preserving deterministic output.

### Goals
- Lower peak heap during postings construction and chunk retention.
- Maintain deterministic output and existing artifact schemas.

### Non-goals
- SPIMI spill-to-disk work (tracked separately in `spimi_spec.md`).
- Changes to search ranking or tokenization semantics.

### Files to modify (exhaustive for this phase)
- `src/index/build/state.js`
- `src/index/build/postings.js`
- `src/index/build/file-processor.js`
- `src/index/build/indexer/steps/process-files.js`
- `src/index/build/indexer/steps/postings.js`
- `src/index/build/tokenization.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/shared/cache.js`
- `docs/perf/indexing-stage-audit.md`
- `docs/specs/segmentation-perf.md`
- `docs/specs/large-file-caps-strategy.md`
- `tests/indexing/postings/postings-heap-plateau.test.js` (new)
- `tests/indexing/runtime/chunk-retention-sampling.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage1 findings)
- `docs/specs/segmentation-perf.md` (update perf guidance)
- `docs/specs/large-file-caps-strategy.md` (update if caps change)

### Tasks
- [ ] Identify large allocations in postings construction (token/phrase/chargram maps).
- [ ] Reduce duplicate string retention (file text reuse + token arrays).
- [ ] Evaluate flat postings buffers for token postings (optional if safe).
- [ ] Review token retention defaults for chunk metadata.
- [ ] Ensure early release of intermediate arrays once written.

### Tests
- [ ] `tests/indexing/postings/postings-heap-plateau.test.js`
- [ ] `tests/indexing/runtime/chunk-retention-sampling.test.js`

### Acceptance
- [ ] Stage1 peak heap reduced on large fixtures without regressions.

---

## Phase 4 — Stage2 (Relations + Repo Map + Filter Index) Optimizations

### Objective
Reduce memory spikes caused by relations graphs and large filter indexes.

### Goals
- Bound memory usage for relations processing and filter index creation.
- Preserve artifact schemas and deterministic ordering.

### Non-goals
- Changes to relation semantics or schema versions.
- Search ranking changes.

### Files to modify (exhaustive for this phase)
- `src/index/build/indexer/steps/relations.js`
- `src/index/build/artifacts/writers/file-relations.js`
- `src/index/build/artifacts/writers/repo-map.js`
- `src/index/build/artifacts/filter-index.js`
- `src/index/build/artifacts.js`
- `src/index/build/state.js`
- `docs/perf/indexing-stage-audit.md`
- `tests/indexing/relations/relations-memory-release.test.js` (new)
- `tests/indexing/filter-index/filter-index-sharding.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage2 findings)

### Tasks
- [ ] Identify oversized in-memory relation structures and their lifetimes.
- [ ] Stream or shard relations/filters where feasible.
- [ ] Ensure early release of relation maps after artifact write.
- [ ] Verify stable ordering and deterministic output after streaming/sharding.

### Tests
- [ ] `tests/indexing/relations/relations-memory-release.test.js`
- [ ] `tests/indexing/filter-index/filter-index-sharding.test.js`

### Acceptance
- [ ] Stage2 peak heap reduced; no changes to artifact schemas.

---

## Phase 5 — Stage3 (Embeddings + ANN + LanceDB) Optimizations

### Objective
Avoid re-computation of embeddings across runs and reduce in-memory vector retention.

### Goals
- Implement global compressed embeddings cache with deterministic invalidation.
- Reduce memory retained during embedding generation.

### Non-goals
- Changing embedding models or ANN semantics.
- Changing artifacts formats beyond cache sidecars.

### Files to modify (exhaustive for this phase)
- `tools/build-embeddings/runner.js`
- `tools/build-embeddings/cache.js`
- `tools/build-embeddings/manifest.js`
- `src/shared/embedding-identity.js`
- `src/shared/embedding-utils.js`
- `src/shared/env.js`
- `src/shared/hash.js`
- `src/shared/cache-roots.js` (new; OS cache path helper)
- `docs/specs/embeddings-cache.md` (new)
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/config/inventory.json`
- `docs/guides/commands.md`
- `tests/indexing/embeddings/cache-binary-roundtrip.test.js` (new)
- `tests/indexing/embeddings/cache-identity-invalidation.test.js` (new)
- `tests/indexing/embeddings/cache-compression-zstd.test.js` (new)
- `tests/indexing/embeddings/cache-pruning.test.js` (new)
- `tests/indexing/embeddings/cache-cross-repo-reuse.test.js` (new)

### Docs/specs to add or update
- `docs/specs/embeddings-cache.md` (new)
- `docs/contracts/indexing.md` (update Stage3 cache mention)
- `docs/contracts/artifact-contract.md` (note cache is out-of-band)
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/guides/commands.md`

### Tasks
- [ ] Implement a global, compressed embeddings cache in OS cache root.
- [ ] Cache format: binary + zstd, store quantized vectors and metadata.
- [ ] Use `@mongodb-js/zstd` for compression.
- [ ] Cache keys include file hash, chunkSignature, identityKey.
- [ ] Add pruning by size and age with a stable policy.
- [ ] Ensure cache identity mismatch invalidates entries deterministically.

### Tests
- [ ] `tests/indexing/embeddings/cache-binary-roundtrip.test.js`
- [ ] `tests/indexing/embeddings/cache-identity-invalidation.test.js`
- [ ] `tests/indexing/embeddings/cache-compression-zstd.test.js`
- [ ] `tests/indexing/embeddings/cache-pruning.test.js`
- [ ] `tests/indexing/embeddings/cache-cross-repo-reuse.test.js`

### Acceptance
- [ ] Cache hits prevent recomputation for unchanged files.
- [ ] Cache invalidation works for identity/hash/signature changes.

---

## Phase 6 — Stage4 (SQLite Build) Optimizations

### Objective
Reduce memory and time during SQLite builds and incremental updates.

### Goals
- Reduce peak memory and improve throughput for SQLite builds.
- Preserve schema and data correctness.

### Non-goals
- Changing SQLite schema versions.
- Changing query semantics.

### Files to modify (exhaustive for this phase)
- `tools/build-sqlite-index/runner.js`
- `src/storage/sqlite/build/from-artifacts.js`
- `src/storage/sqlite/build/from-bundles.js`
- `src/storage/sqlite/build/incremental-update.js`
- `src/storage/sqlite/incremental.js`
- `src/storage/sqlite/utils.js`
- `docs/perf/indexing-stage-audit.md`
- `tests/storage/sqlite/sqlite-build-memory-guard.test.js` (new)
- `tests/storage/sqlite/sqlite-incremental-memory-profile.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage4 findings)

### Tasks
- [ ] Audit incremental vs artifacts build memory usage.
- [ ] Optimize batch sizes and streaming inserts.
- [ ] Ensure WAL checkpointing and temp file cleanup are bounded.

### Tests
- [ ] `tests/storage/sqlite/sqlite-build-memory-guard.test.js`
- [ ] `tests/storage/sqlite/sqlite-incremental-memory-profile.test.js`

### Acceptance
- [ ] Stage4 peak memory reduced for large indexes.

---

## Phase 7 — VFS Correctness + Performance

### Objective
Ensure VFS manifests are correct, deterministic, and efficient, and leverage VFS routing to reduce remaining WASM/tooling issues.

### Goals
- Ensure deterministic virtual paths and manifest rows.
- Reduce VFS manifest memory usage via streaming/sharding.
- Enable VFS routing to reduce tree-sitter grammar churn.

### Non-goals
- Changing provider feature sets beyond VFS routing correctness.
- Introducing new VFS schema versions.

### Files to modify (exhaustive for this phase)
- `src/index/tooling/vfs.js`
- `src/index/build/file-processor/process-chunks/ids.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/index/build/artifacts/writers/vfs-manifest.js`
- `src/index/build/artifacts/file-lists.js`
- `src/index/build/state.js`
- `src/index/validate/manifest.js`
- `src/shared/artifact-io/fs.js`
- `src/shared/artifact-io/cache.js`
- `src/shared/fs/ignore.js`
- `src/index/tooling/lsp-provider.js`
- `src/index/tooling/provider-registry.js`
- `src/index/tooling/provider-contract.js`
- `src/index/tooling/providers/index.js`
- `src/index/tooling/orchestrator.js`
- `src/index/tooling/doctor.js`
- `src/index/tooling/typescript-provider.js`
- `src/index/tooling/typescript/host.js`
- `src/index/tooling/clangd-provider.js`
- `src/index/tooling/sourcekit-provider.js`
- `src/index/tooling/pyright-provider.js`
- `src/index/tooling/signature-parse/clike.js`
- `src/index/tooling/signature-parse/python.js`
- `src/index/tooling/signature-parse/swift.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/lsp/positions.js`
- `src/integrations/tooling/lsp/symbols.js`
- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/lsp-provider-hardening.md`
- `docs/specs/tooling-provider-registry.md`
- `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
- `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
- `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- `tests/tooling/vfs/vfs-manifest-streaming.test.js` (new)
- `tests/tooling/vfs/vfs-row-size-trim.test.js` (new)

### Docs/specs to add or update
- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/lsp-provider-hardening.md`
- `docs/specs/tooling-provider-registry.md`

### Tasks
- [ ] Validate VFS virtualPath determinism and path normalization across platforms.
- [ ] Stream or shard VFS manifest rows to avoid large in-memory arrays.
- [ ] Enforce row size caps and deterministic trimming rules.
- [ ] Ensure VFS routing always uses `.poc-vfs/` paths for segment docs.
- [ ] Use VFS segment language routing to minimize unnecessary tree-sitter loads.
- [ ] Provide stable mapping from virtualPath → disk path (for LSP file scheme fallback).

### Tests
- [ ] `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
- [ ] `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
- [ ] `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- [ ] `tests/tooling/vfs/vfs-manifest-streaming.test.js`
- [ ] `tests/tooling/vfs/vfs-row-size-trim.test.js`

### Acceptance
- [ ] VFS manifest rows are deterministic and schema-valid.
- [ ] VFS manifest generation remains bounded in memory.
- [ ] Tooling providers work with `.poc-vfs` paths and fall back safely when needed.

---

## Phase 8 — Tree-sitter WASM Handling + Load Strategy

### Objective
Reduce tree-sitter WASM churn, improve load determinism, and avoid unnecessary grammar loads while keeping parsing quality.

### Goals
- Bound loaded WASM grammars deterministically.
- Reduce grammar swaps by batching and VFS language routing.

### Non-goals
- Adding new grammars or changing parser semantics.
- Changing token classification rules beyond performance improvements.

### Files to modify (exhaustive for this phase)
- `src/lang/tree-sitter.js`
- `src/lang/tree-sitter/runtime.js`
- `src/lang/tree-sitter/worker.js`
- `src/lang/tree-sitter/state.js`
- `src/lang/tree-sitter/config.js`
- `src/lang/tree-sitter/options.js`
- `src/lang/tree-sitter/chunking.js`
- `src/lang/tree-sitter/ast.js`
- `src/lang/workers/tree-sitter-worker.js`
- `src/index/build/runtime/runtime.js`
- `src/index/build/runtime/tree-sitter.js`
- `src/index/build/file-processor/cpu/chunking.js`
- `src/index/build/file-processor/cpu/analyze.js`
- `src/index/build/file-processor/tree-sitter.js`
- `src/index/chunking/tree-sitter.js`
- `src/index/build/indexer/steps/process-files/tree-sitter.js`
- `src/index/build/tokenization.js`
- `docs/specs/segmentation-perf.md`
- `tests/indexing/tree-sitter/tree-sitter-preload-limited.test.js`
- `tests/indexing/tree-sitter/tree-sitter-eviction-determinism.test.js`
- `tests/indexing/tree-sitter/tree-sitter-batch-by-language.test.js`
- `tests/indexing/tree-sitter/tree-sitter-fallback-missing-wasm.test.js`

### Docs/specs to add or update
- `docs/specs/segmentation-perf.md`

### Tasks
- [ ] Ensure tree-sitter runtime is initialized lazily and only when needed.
- [ ] Restrict preloading to languages discovered in the repo (not full registry).
- [ ] Improve LRU eviction rules for WASM grammar cache (deterministic + bounded).
- [ ] Batch tree-sitter parses by language to minimize grammar swaps.
- [ ] Use VFS segment language routing to avoid loading grammars for unused embedded languages.
- [ ] Add a clear fallback path when wasm is missing or load fails (no crash, deterministic logs).

### Tests
- [ ] `tests/indexing/tree-sitter/tree-sitter-preload-limited.test.js`
- [ ] `tests/indexing/tree-sitter/tree-sitter-eviction-determinism.test.js`
- [ ] `tests/indexing/tree-sitter/tree-sitter-batch-by-language.test.js`
- [ ] `tests/indexing/tree-sitter/tree-sitter-fallback-missing-wasm.test.js`

### Acceptance
- [ ] WASM grammar count stays within configured bounds.
- [ ] Tree-sitter load failures do not crash indexing.
- [ ] Language preloading is limited to observed repo languages.

---

## Phase 9 — Retrieval Pipeline Performance (Query → Candidates → Rank → Output)

### Objective
Reduce query latency and memory use by minimizing repeated parsing, avoiding unnecessary artifact loads, and optimizing candidate/filter/ranking stages.

### Goals
- Improve cold and warm query latency by reducing repeated work.
- Reduce per-query memory spikes for large result sets.

### Non-goals
- Changing query semantics or ranking behavior.
- Changing output schema or CLI flags.

### Files to modify (exhaustive for this phase)
- `src/retrieval/pipeline.js`
- `src/retrieval/pipeline/query-ast.js`
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/pipeline/ann-backends.js`
- `src/retrieval/query.js`
- `src/retrieval/query-parse.js`
- `src/retrieval/query-intent.js`
- `src/retrieval/query-cache.js`
- `src/retrieval/index-cache.js`
- `src/retrieval/sqlite-cache.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/lmdb-helpers.js`
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/bitmap.js`
- `src/retrieval/rankers.js`
- `src/retrieval/embedding.js`
- `src/retrieval/fts.js`
- `src/retrieval/context-expansion.js`
- `src/retrieval/output/format.js`
- `src/retrieval/output/filters.js`
- `src/retrieval/output/filters/candidates.js`
- `src/retrieval/output/filters/file-prefilter.js`
- `src/retrieval/output/filters/file.js`
- `src/retrieval/output/filters/meta.js`
- `src/retrieval/output/filters/predicates.js`
- `src/retrieval/output/filters/structural.js`
- `src/retrieval/output/context.js`
- `src/retrieval/output/summary.js`
- `src/retrieval/output/explain.js`
- `src/retrieval/output/risk-explain.js`
- `src/retrieval/output/graph-impact.js`
- `src/retrieval/output/graph-context-pack.js`
- `src/retrieval/output/suggest-tests.js`
- `src/retrieval/output/architecture.js`
- `src/retrieval/output/cache.js`
- `src/retrieval/ann/types.js`
- `src/retrieval/ann/providers/dense.js`
- `src/retrieval/ann/providers/hnsw.js`
- `src/retrieval/ann/providers/lancedb.js`
- `src/retrieval/ann/providers/sqlite-vec.js`
- `src/retrieval/sparse/types.js`
- `src/retrieval/sparse/providers/js-bm25.js`
- `src/retrieval/sparse/providers/sqlite-fts.js`
- `src/retrieval/sparse/providers/tantivy.js`
- `docs/perf/retrieval-pipeline.md` (new)
- `tests/retrieval/pipeline/query-cache-hit.test.js` (new)
- `tests/retrieval/pipeline/filter-bitmap-shortcircuit.test.js` (new)
- `tests/retrieval/pipeline/candidates-memory-plateau.test.js` (new)
- `tests/retrieval/pipeline/ranking-fastpath.test.js` (new)

### Docs/specs to add or update
- `docs/perf/retrieval-pipeline.md` (new)

### Tasks
- [ ] Add query parse + plan cache keyed by query + index signature.
- [ ] Avoid loading heavy artifacts when query does not need them.
- [ ] Use bitmap/bitset short-circuit for filters and structural predicates.
- [ ] Reduce candidate retention by streaming and early cutoff.
- [ ] Track per-stage retrieval timing and memory checkpoints.

### Tests
- [ ] `tests/retrieval/pipeline/query-cache-hit.test.js`
- [ ] `tests/retrieval/pipeline/filter-bitmap-shortcircuit.test.js`
- [ ] `tests/retrieval/pipeline/candidates-memory-plateau.test.js`
- [ ] `tests/retrieval/pipeline/ranking-fastpath.test.js`

### Acceptance
- [ ] Query latency reduced on cold and warm runs.
- [ ] Retrieval memory spikes reduced for large result sets.

---

## Phase 10 — Graph + Context Pack Performance

### Objective
Reduce graph traversal overhead and context pack assembly cost while preserving deterministic results.

### Goals
- Lower memory use during graph neighborhood expansion and context pack assembly.
- Avoid redundant sorts and repeated artifact parsing.

### Non-goals
- Changing graph semantics or output schema.
- Changing provenance or truncation behavior.

### Files to modify (exhaustive for this phase)
- `src/graph/store.js`
- `src/graph/neighborhood.js`
- `src/graph/ordering.js`
- `src/graph/impact.js`
- `src/graph/architecture.js`
- `src/graph/context-pack.js`
- `src/graph/suggest-tests.js`
- `src/context-pack/assemble.js`
- `src/retrieval/output/graph-impact.js`
- `src/retrieval/output/graph-context-pack.js`
- `src/retrieval/output/architecture.js`
- `src/retrieval/output/suggest-tests.js`
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/architecture-check.js`
- `src/integrations/tooling/api-contracts.js`
- `docs/perf/graph-context-pack.md` (new)
- `tests/graph/graph-neighborhood-cache.test.js` (new)
- `tests/graph/graph-truncation-deterministic.test.js` (new)
- `tests/context-pack/context-pack-excerpt-range.test.js` (new)
- `tests/context-pack/context-pack-assembly-memory.test.js` (new)

### Docs/specs to add or update
- `docs/perf/graph-context-pack.md` (new)

### Tasks
- [ ] Build and reuse symbol/edge indexes instead of re-sorting per request.
- [ ] Cache graph relations and reuse across calls within a session.
- [ ] Use range reads for excerpts instead of full file loads.
- [ ] Reduce intermediate array churn in neighborhood traversal.
- [ ] Track graph/context-pack timings and memory checkpoints.

### Tests
- [ ] `tests/graph/graph-neighborhood-cache.test.js`
- [ ] `tests/graph/graph-truncation-deterministic.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-range.test.js`
- [ ] `tests/context-pack/context-pack-assembly-memory.test.js`

### Acceptance
- [ ] Graph and context pack generation uses less memory on large graphs.
- [ ] Deterministic outputs remain unchanged.

---

## Phase 11 — Search CLI Startup Time + UX Fast Paths

### Objective
Reduce search CLI startup time by eliminating unnecessary work on cold start and lazy-loading heavy dependencies.

### Goals
- Improve cold-start time for `pairofcleats search` and `search.js`.
- Ensure `--help`/`--version` are fast paths with minimal initialization.

### Non-goals
- Changing search output schema or ranking behavior.
- Adding new CLI flags beyond profiling hooks.

### Files to modify (exhaustive for this phase)
- `bin/pairofcleats.js`
- `search.js`
- `src/integrations/core/search.js`
- `src/integrations/core/embeddings.js`
- `src/retrieval/cli.js`
- `src/retrieval/cli-args.js`
- `src/retrieval/cli-index.js`
- `src/retrieval/cli-sqlite.js`
- `src/retrieval/cli-lmdb.js`
- `src/retrieval/cli-dictionary.js`
- `src/retrieval/cli/ansi.js`
- `src/retrieval/cli/auto-sqlite.js`
- `src/retrieval/cli/backend-context.js`
- `src/retrieval/cli/branch-filter.js`
- `src/retrieval/cli/highlight.js`
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/cli/index-state.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/model-ids.js`
- `src/retrieval/cli/normalize-options.js`
- `src/retrieval/cli/options.js`
- `src/retrieval/cli/persist.js`
- `src/retrieval/cli/policy.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/cli/render-output.js`
- `src/retrieval/cli/render.js`
- `src/retrieval/cli/resolve-run-config.js`
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/cli/runner.js`
- `src/retrieval/cli/search-runner.js`
- `src/retrieval/cli/telemetry.js`
- `src/shared/cli.js`
- `src/shared/cli-options.js`
- `src/shared/cli/ansi-utils.js`
- `src/shared/cli/progress-events.js`
- `src/shared/cli/display.js`
- `src/shared/cli/display/bar.js`
- `src/shared/cli/display/colors.js`
- `src/shared/cli/display/progress.js`
- `src/shared/cli/display/render.js`
- `src/shared/cli/display/terminal.js`
- `src/shared/cli/display/text.js`
- `src/shared/runtime-envelope.js`
- `src/shared/env.js`
- `tools/shared/dict-utils.js`
- `docs/contracts/search-cli.md`
- `docs/guides/commands.md`
- `tests/cli/search/search-help-fastpath.test.js` (new)
- `tests/cli/search/search-startup-profiler.test.js` (new)
- `tests/cli/search/search-lazy-imports.test.js` (new)

### Docs/specs to add or update
- `docs/contracts/search-cli.md`
- `docs/guides/commands.md`

### Tasks
- [ ] Add a startup profiler (checkpoint timing) for CLI commands.
- [ ] Ensure `--help` and `--version` avoid loading heavy modules.
- [ ] Lazy-load search pipeline and config only after command resolution.
- [ ] Avoid loading indexing/runtime configuration for search-only invocations.
- [ ] Add a fast-path for `search --help` and `search --backend` validation without full config load.

### Tests
- [ ] `tests/cli/search/search-help-fastpath.test.js`
- [ ] `tests/cli/search/search-startup-profiler.test.js`
- [ ] `tests/cli/search/search-lazy-imports.test.js`

### Acceptance
- [ ] Search CLI startup time improves measurably on cold start.
- [ ] `--help` and `--version` do not initialize heavy subsystems.

---

## Phase 12 — Map Build + Viewer Performance

### Objective
Reduce map build memory usage and improve isometric viewer runtime performance on large repos.

### Goals
- Stream map build outputs to avoid large in-memory graph payloads.
- Reduce viewer frame drops via instancing, culling, and LOD.

### Non-goals
- Changing map output schema or UI layout semantics.
- Replacing the renderer or UI framework.

### Files to modify (exhaustive for this phase)
- `src/map/build-map.js`
- `src/map/build-map/normalize.js`
- `src/map/build-map/nodes.js`
- `src/map/build-map/edges.js`
- `src/map/build-map/symbols.js`
- `src/map/build-map/filters.js`
- `src/map/build-map/io.js`
- `src/map/utils.js`
- `src/map/constants.js`
- `src/map/isometric-viewer.js`
- `src/map/isometric/client/viewer.js`
- `src/map/isometric/client/viewer-app.js`
- `src/map/isometric/client/scene.js`
- `src/map/isometric/client/scene-utils.js`
- `src/map/isometric/client/layout.js`
- `src/map/isometric/client/layout-utils.js`
- `src/map/isometric/client/meshes.js`
- `src/map/isometric/client/materials.js`
- `src/map/isometric/client/edges.js`
- `src/map/isometric/client/edges/aggregate.js`
- `src/map/isometric/client/edges/endpoints.js`
- `src/map/isometric/client/edges/resolvers.js`
- `src/map/isometric/client/edges/routing.js`
- `src/map/isometric/client/edges/style.js`
- `src/map/isometric/client/controls.js`
- `src/map/isometric/client/state.js`
- `src/map/isometric/client/selection.js`
- `src/map/isometric/client/rebuild.js`
- `src/map/isometric/client/map-data.js`
- `src/map/isometric/client/three-loader.js`
- `src/map/isometric/client/dom.js`
- `src/map/isometric/client/defaults.js`
- `src/map/isometric/client/utils.js`
- `src/map/isometric/client/ui.js`
- `docs/perf/map-pipeline.md` (new)
- `tests/map/map-build-streaming.test.js` (new)
- `tests/map/map-viewer-display-limits.test.js` (new)

### Docs/specs to add or update
- `docs/perf/map-pipeline.md` (new)

### Tasks
- [ ] Stream map build output and avoid full graph materialization.
- [ ] Precompute edge aggregates and reduce per-frame allocations.
- [ ] Use instancing + frustum culling for large node sets.
- [ ] Add LOD strategy for edges/labels under load.
- [ ] Add viewer telemetry for dropped frames and memory usage.

### Tests
- [ ] `tests/map/map-build-streaming.test.js`
- [ ] `tests/map/map-viewer-display-limits.test.js`

### Acceptance
- [ ] Map build memory usage reduced for large inputs.
- [ ] Viewer remains responsive under large graphs.

---

## Phase 13 — Documentation + JSDoc

### Objective
Document the audit outputs and embeddings cache with clear JSDoc requirements.

### Goals
- Ensure docs and config inventories reflect new behavior.
- Require consistent JSDoc for new/shared modules.

### Non-goals
- Writing new features beyond documentation and JSDoc standards.

### Files to modify (exhaustive for this phase)
- `docs/perf/indexing-stage-audit.md`
- `docs/specs/embeddings-cache.md`
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/config/inventory.json`
- `docs/guides/commands.md`
- `docs/guides/jsdoc-standards.md` (new)
- `tests/docs/embeddings-cache-docs-sync.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md`
- `docs/specs/embeddings-cache.md`
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/guides/commands.md`
- `docs/guides/jsdoc-standards.md` (new)

### JSDoc requirements
- New/shared modules must document:
  - purpose + performance characteristics
  - input/output types and invariants
  - error behavior + side effects
  - determinism constraints and edge cases

### Tests
- [ ] `tests/docs/embeddings-cache-docs-sync.test.js`

### Acceptance
- [ ] Docs updated and referenced in commands/config inventories.
- [ ] JSDoc standards documented and enforced for new modules.

---

