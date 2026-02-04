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
- [x] Inventory duplicate helper patterns across graph/context-pack/retrieval tooling.
- [x] Implement shared helpers for provenance resolution, truncation recording, and limit normalization.
- [x] Update all call sites to use shared helpers.
- [x] Document shared component expectations and examples.

### Acceptance
- [x] Duplicate helper implementations removed and replaced by shared modules.

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
- `tools/build/embeddings/runner.js`
- `tools/build/sqlite/runner.js`
- `docs/perf/indexing-stage-audit.md` (new)
- `tests/indexing/runtime/stage-memory-checkpoints.test.js` (new)
- `tests/indexing/runtime/stage-timing-checkpoints.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (new)

### Tasks
- [x] Add per-stage checkpoints (time + heapUsed + rss + external + arrayBuffers).
- [x] Record checkpoints in build state or perf profile (schema versioned).
- [x] Emit a concise audit summary per mode and per stage.
- [x] Capture high-watermarks for postings maps, chunk arrays, relations, and embeddings buffers.
- [x] Document the audit output format and interpretation guide.

### Tests
- [x] `tests/indexing/runtime/stage-memory-checkpoints.test.js`
- [x] `tests/indexing/runtime/stage-timing-checkpoints.test.js`

### Acceptance
- [x] Each stage records timing and memory checkpoints.
- [x] Audit report is produced and documented.

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
- [x] Enforce streaming decode/encode paths for large arrays and JSONL.
- [x] Tune chunk sizes and backpressure handling in json-stream.
- [x] Use bounded buffers for atomic writes and compression.
- [x] Add shared IO telemetry hooks for large artifact reads.

### Tests
- [x] `tests/shared/json-stream/large-array-stream.test.js`
- [x] `tests/shared/artifact-io/manifest-streaming.test.js`
- [x] `tests/shared/artifact-io/jsonl-stream-roundtrip.test.js`

### Acceptance
- [ ] Large artifact loads stay within memory bounds.
- [ ] Shared IO paths demonstrate improved throughput.

---

## Cross-cutting Tests to Run
- [x] `node tests/run.js --lane ci-lite`
- [x] `node tests/run.js --lane ci`

---

## Acceptance (overall)
- [x] Stage audit report exists and highlights memory/perf hotspots.
- [ ] Global embeddings cache reduces recomputation and passes tests.
- [ ] Search CLI startup time improved without functional regressions.
- [ ] VFS correctness/perf improvements land before tree-sitter load changes.
- [ ] Retrieval, graph/context-pack, map, and shared IO perf improvements landed with tests.
- [ ] No artifact schema regressions.
- [x] Documentation and JSDoc standards met.

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
- [x] Identify large allocations in postings construction (token/phrase/chargram maps).
- [x] Reduce duplicate string retention (file text reuse + token arrays).
- [x] Evaluate flat postings buffers for token postings (optional if safe).
- [x] Review token retention defaults for chunk metadata.
- [x] Ensure early release of intermediate arrays once written.

### Tests
- [x] `tests/indexing/postings/postings-heap-plateau.test.js`
- [x] `tests/indexing/runtime/chunk-retention-sampling.test.js`

### Acceptance
- [x] Stage1 peak heap reduced on large fixtures without regressions.

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
- [x] Identify oversized in-memory relation structures and their lifetimes.
- [x] Stream or shard relations/filters where feasible.
- [x] Ensure early release of relation maps after artifact write.
- [x] Verify stable ordering and deterministic output after streaming/sharding.

### Tests
- [x] `tests/indexing/relations/relations-memory-release.test.js`
- [ ] `tests/indexing/filter-index/filter-index-sharding.test.js`

### Acceptance
- [x] Stage2 peak heap reduced; no changes to artifact schemas.

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
- `tools/build/embeddings/runner.js`
- `tools/build/embeddings/cache.js`
- `tools/build/embeddings/manifest.js`
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
- [x] Implement a global, compressed embeddings cache in OS cache root.
- [x] Cache format: binary + zstd, store quantized vectors and metadata.
- [x] Cache keys include file hash, chunkSignature, identityKey.
- [x] Add pruning by size and age with a stable policy.
- [x] Ensure cache identity mismatch invalidates entries deterministically.

### Tests
- [x] `tests/indexing/embeddings/cache-binary-roundtrip.test.js`
- [ ] `tests/indexing/embeddings/cache-identity-invalidation.test.js`
- [x] `tests/indexing/embeddings/cache-compression-zstd.test.js`
- [x] `tests/indexing/embeddings/cache-pruning.test.js`
- [x] `tests/indexing/embeddings/cache-cross-repo-reuse.test.js`

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
- Stream compressed JSONL ingestion without full in-memory buffers.
- Bound WAL/temp file growth and avoid runaway disk usage.
- Add build telemetry for batch sizing and throughput.

### Non-goals
- Changing SQLite schema versions.
- Changing query semantics.
- Introducing new SQLite dependencies or native extensions.
- Disabling integrity checks beyond existing build pragmas.
- Changing artifact formats (JSON/JSONL) for inputs.

### Files to modify (exhaustive for this phase)
- `tools/build/sqlite/runner.js`
- `src/storage/sqlite/build/from-artifacts.js`
- `src/storage/sqlite/build/from-bundles.js`
- `src/storage/sqlite/build/incremental-update.js`
- `src/storage/sqlite/incremental.js`
- `src/storage/sqlite/utils.js`
- `src/storage/sqlite/build/pragmas.js`
- `src/storage/sqlite/build/validate.js`
- `src/storage/sqlite/build/manifest.js`
- `docs/perf/sqlite-build.md` (new)
- `tools/bench/sqlite/build-from-artifacts.js` (new)
- `tools/bench/sqlite/build-from-bundles.js` (new)
- `tools/bench/sqlite/incremental-update.js` (new)
- `tools/bench/sqlite/jsonl-streaming.js` (new)
- `docs/perf/indexing-stage-audit.md`
- `tests/storage/sqlite/sqlite-build-memory-guard.test.js` (new)
- `tests/storage/sqlite/sqlite-incremental-memory-profile.test.js` (new)
- `tests/storage/sqlite/sqlite-build-pragmas-restore.test.js` (new)
- `tests/storage/sqlite/sqlite-build-pragmas-dynamic.test.js` (new)
- `tests/storage/sqlite/sqlite-jsonl-streaming-gzip.test.js` (new)
- `tests/storage/sqlite/sqlite-jsonl-streaming-zstd.test.js` (new)
- `tests/storage/sqlite/sqlite-batch-size-adaptive.test.js` (new)
- `tests/storage/sqlite/sqlite-wal-size-limit.test.js` (new)
- `tests/storage/sqlite/sqlite-incremental-transaction-boundary.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage4 findings)
- `docs/perf/sqlite-build.md` (new)

### Tasks
- [x] **6.A Build pragmas + transaction strategy**
- [x] Task 6.A.1: Make build pragmas adaptive based on input size + available memory (cache_size, mmap_size).
- [x] Task 6.A.2: Set `wal_autocheckpoint` and `journal_size_limit` during builds; restore after.
- [x] Task 6.A.3: Use `locking_mode=EXCLUSIVE` for build database temp files; restore after finalize.
- [x] Task 6.A.4: Add explicit `BEGIN/COMMIT` wrapping per-table inserts to reduce transaction churn.
- [x] Task 6.A.5: Run `PRAGMA optimize` (and optional `ANALYZE`) after indexes are created.
- [x] Task 6.A.6: Record applied pragmas + batch sizes in build telemetry.

- [x] **6.B Streaming JSONL ingestion**
- [x] Task 6.B.1: Replace `.gz/.zst` JSONL reads that load into memory with streaming decompress + parse.
- [x] Task 6.B.2: Ensure `readJsonLinesFile` handles compressed files without `readJsonLinesArray`.
- [x] Task 6.B.3: Add guardrails for max JSON bytes during streaming parse.

- [x] **6.C Batch sizing + throughput**
- [x] Task 6.C.1: Tune `resolveSqliteBatchSize` using inputBytes + row counts; add min/max clamps.
- [x] Task 6.C.2: Record batch counts per table (token/postings/chargram/minhash).
- [x] Task 6.C.3: Add per-table throughput metrics (rows/sec).

- [x] **6.D Incremental update improvements**
- [x] Task 6.D.1: Add transaction boundaries around delete + insert phases to avoid partial WAL growth.
- [x] Task 6.D.2: Cap incremental updates by change ratio (already) and log skip reasons to build state.
- [x] Task 6.D.3: Add explicit `wal_checkpoint(TRUNCATE)` after incremental updates.

- [x] **6.E Validation + compaction hooks**
- [x] Task 6.E.1: Ensure compact/validate paths use the same adaptive pragma set.
- [x] Task 6.E.2: Emit validation timing + row counts to Stage4 audit.

- [x] **6.F Benchmarks**
- [x] Task 6.F.1: Add `tools/bench/sqlite/build-from-artifacts.js` with baseline vs optimized runs.
- [x] Task 6.F.2: Add `tools/bench/sqlite/build-from-bundles.js`.
- [x] Task 6.F.3: Add `tools/bench/sqlite/incremental-update.js`.
- [x] Task 6.F.4: Add `tools/bench/sqlite/jsonl-streaming.js` to compare compressed streaming vs array load.
- [x] Task 6.F.5: Document benchmark setup + expected deltas in `docs/perf/sqlite-build.md`.

### Tests
- [x] `tests/storage/sqlite/sqlite-build-memory-guard.test.js`
- [x] `tests/storage/sqlite/sqlite-incremental-memory-profile.test.js`
- [x] `tests/storage/sqlite/sqlite-build-pragmas-restore.test.js`
  - Success: pragmas are restored to safe defaults after build.
- [x] `tests/storage/sqlite/sqlite-build-pragmas-dynamic.test.js`
  - Success: adaptive pragma values scale with input size.
- [x] `tests/storage/sqlite/sqlite-jsonl-streaming-gzip.test.js`
  - Success: gzip JSONL is streamed without loading full file.
- [x] `tests/storage/sqlite/sqlite-jsonl-streaming-zstd.test.js`
  - Success: zstd JSONL is streamed without loading full file.
- [x] `tests/storage/sqlite/sqlite-batch-size-adaptive.test.js`
  - Success: batch size scales with inputBytes and stays within bounds.
- [x] `tests/storage/sqlite/sqlite-wal-size-limit.test.js`
  - Success: WAL is checkpointed/truncated and remains bounded.
- [x] `tests/storage/sqlite/sqlite-incremental-transaction-boundary.test.js`
  - Success: delete+insert phases execute inside explicit transactions.

### Acceptance
- [x] Stage4 peak memory reduced for large indexes.
- [x] WAL/SHM sidecars stay bounded after builds and incremental updates.
- [x] Compressed JSONL ingestion is streaming and does not allocate large arrays.
- [x] Build telemetry captures pragmas, batch sizes, and throughput.

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
- [x] Validate VFS virtualPath determinism and path normalization across platforms.
- [x] Stream or shard VFS manifest rows to avoid large in-memory arrays.
- [x] Enforce row size caps and deterministic trimming rules.
- [x] Ensure VFS routing always uses `.poc-vfs/` paths for segment docs.
- [x] Use VFS segment language routing to minimize unnecessary tree-sitter loads.
- [x] Provide stable mapping from virtualPath → disk path (for LSP file scheme fallback).

### Tests
- [x] `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
- [x] `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
- [x] `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- [x] `tests/tooling/vfs/vfs-manifest-streaming.test.js`
- [x] `tests/tooling/vfs/vfs-row-size-trim.test.js`

### Acceptance
- [x] VFS manifest rows are deterministic and schema-valid.
- [x] VFS manifest generation remains bounded in memory.
- [x] Tooling providers work with `.poc-vfs` paths and fall back safely when needed.

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
- [x] Ensure tree-sitter runtime is initialized lazily and only when needed.
- [x] Restrict preloading to languages discovered in the repo (not full registry).
- [x] Improve LRU eviction rules for WASM grammar cache (deterministic + bounded).
- [x] Batch tree-sitter parses by language to minimize grammar swaps.
- [x] Use VFS segment language routing to avoid loading grammars for unused embedded languages.
- [x] Add a clear fallback path when wasm is missing or load fails (no crash, deterministic logs).

### Tests
- [x] `tests/indexing/tree-sitter/tree-sitter-preload-limited.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-eviction-determinism.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-batch-by-language.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-fallback-missing-wasm.test.js`

### Acceptance
- [x] WASM grammar count stays within configured bounds.
- [x] Tree-sitter load failures do not crash indexing.
- [x] Language preloading is limited to observed repo languages.

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
- [x] Add query parse + plan cache keyed by query + index signature.
- [x] Avoid loading heavy artifacts when query does not need them.
- [x] Use bitmap/bitset short-circuit for filters and structural predicates.
- [x] Reduce candidate retention by streaming and early cutoff.
- [x] Track per-stage retrieval timing and memory checkpoints.

### Tests
- [x] `tests/retrieval/pipeline/query-cache-hit.test.js`
- [x] `tests/retrieval/pipeline/filter-bitmap-shortcircuit.test.js`
- [x] `tests/retrieval/pipeline/candidates-memory-plateau.test.js`
- [x] `tests/retrieval/pipeline/ranking-fastpath.test.js`

### Acceptance
- [x] Query latency reduced on cold and warm runs.
- [x] Retrieval memory spikes reduced for large result sets.

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
- `tests/graph/graph-index-cache-reuse.test.js` (new)
- `tests/graph/graph-adjacency-deterministic.test.js` (new)
- `tests/graph/graph-truncation-deterministic.test.js` (new)
- `tests/context-pack/context-pack-excerpt-range.test.js` (new)
- `tests/context-pack/context-pack-range-reads.test.js` (new)
- `tests/context-pack/context-pack-excerpt-cache.test.js` (new)
- `tests/context-pack/context-pack-assembly-memory.test.js` (new)

### Docs/specs to add or update
- `docs/perf/graph-context-pack.md` (new)

### Tasks
- [x] Build a shared `GraphIndex` in `src/graph/store.js` that precomputes node/edge maps and sort keys.
- [x] Add compact integer ID remapping for graph nodes/edges with reversible string tables.
- [x] Replace per-edge string keys with numeric IDs or pre-hashed keys in the graph index.
- [x] Normalize import/file paths once in the graph index; avoid per-edge normalization.
- [ ] Make adjacency lists unique + pre-sorted at index build time; skip per-node neighbor sorting.
- [ ] Precompute adjacency partitions (by from/to/type) to avoid per-request sorting and repeated scans.
- [ ] Add prefix-compressed path tables for file path references to reduce memory.
- [ ] Add an opt-in columnar/offsets representation for `graph_relations` to cut parse + memory cost.
- [ ] Store graph relations in memory-mapped or buffer-backed typed arrays for large graphs.
- [ ] Bound graph artifact caches by index signature (LRU eviction) to prevent unbounded growth.
- [ ] Cache the `GraphIndex` by index signature + options; reuse across graph/context-pack calls in a session.
- [ ] Add lazy edge-type loading so call/usage/import graphs are only loaded when requested.
- [ ] Gate graph artifact loads in tooling CLIs based on include flags and edge filters.
- [ ] Parallelize graph artifact loads (`graph_relations`, `symbol_edges`, `call_sites`) with `Promise.all`.
- [ ] Task 10.X.3.a: Resolve required artifacts from CLI flags (`graphs`, `edgeTypes`, include toggles).
- [ ] Task 10.X.3.b: Load only required artifacts; emit warning when required artifact missing.
- [ ] Task 10.X.3.c: Use `Promise.all` for required loads.
- [ ] Task 10.X.3.d: Add tests verifying unused artifacts are not loaded.
- [ ] Add shared chunk lookup index for context-pack to avoid per-call map rebuilds.
- [ ] Task 10.X.8.a: Build shared `ChunkIndex` in context-pack path.
- [ ] Task 10.X.8.b: Thread `ChunkIndex` through impact/context-pack callers.
- [ ] Task 10.X.8.c: Add test that repeated calls reuse index.
- [ ] Add multi-seed BFS for impact/context-pack to avoid repeated graph traversal.
- [ ] Task 10.X.7.a: Implement multi-seed traversal with deterministic merge order.
- [ ] Task 10.X.7.b: Add deterministic test comparing multi-seed vs single-seed union output.
- [ ] Reduce intermediate array churn in neighborhood traversal with streaming + budgeted iterators.
- [ ] Add windowed spill/merge for large neighborhood assembly to cap heap usage.
- [ ] Add parallel neighborhood expansion per edge type with deterministic merge ordering.
- [ ] Precompute deterministic edge buckets for truncation (priority + stable sort keys) to avoid per-call sort.
- [ ] Add lazy witness-path construction; avoid building paths unless requested and within caps.
- [ ] Add fast edge-filter predicate compiled once per request.
- [ ] Ensure budget/truncation ordering is deterministic across runs.
- [ ] Track graph/context-pack timings and memory checkpoints.
- [ ] Track graph/context-pack peak memory and excerpt bytes in stats payload.
- [ ] Use range reads for excerpts instead of full file loads; avoid `fs.readFileSync` for slices.
- [ ] Add `readFileRange` helper; prefer when `start/end` valid.
- [ ] Add a small excerpt LRU cache keyed by `(path,start,end,maxBytes,maxTokens)` to avoid repeated reads.
- [ ] Add file-level excerpt cache keyed by `(filePath, byteRange)` before token slicing.
- [ ] Add excerpt prefetch batching to reduce per-chunk IO latency in context packs.
- [ ] Add excerpt hash de-duplication to avoid emitting duplicate slices.
- [ ] Normalize chunk/file paths once for seed resolution in context-pack assembly.
- [ ] Task 10.X.5.c: Normalize seed paths before lookup; use shared chunk index.
- [ ] Task 10.X.5.d: Add tests for range reads + cache hits + path normalization.
- [ ] Add deterministic output ordering for graph/architecture/suggest-tests renderers and include warnings/truncation sections.
- [ ] Task 10.X.1.a: Sort impact outputs by distance then ref key; include truncation + warnings sections.
- [ ] Task 10.X.1.b: Sort architecture outputs by rule id + edge key; include truncation + warnings sections.
- [ ] Task 10.X.1.c: Sort suggest-tests outputs by score desc then path; include truncation + warnings sections.
- [ ] Task 10.X.1.d: Add renderer tests for deterministic ordering and diagnostics visibility.
- [ ] Add optional skip-resort flag in graph-context-pack renderer when upstream already sorted.
- [ ] Task 10.X.2.a: Thread a `sorted` flag through context-pack payload (stats or top-level).
- [ ] Task 10.X.2.b: Skip `compareGraphNodes/Edges` sorts when `sorted` is true.
- [ ] Task 10.X.2.c: Add test that asserts no resort occurs when `sorted` is set.
- [ ] Cache compiled architecture rules + ordered node lists by rules payload hash.
- [ ] Cache test discovery + compiled matchers in suggest-tests (keyed by repo + patterns).
- [ ] Add signature arity cache + call-site grouping optimizations in api-contracts.
- [ ] Task 10.X.4.a: Add arity cache keyed by signature string.
- [ ] Task 10.X.4.b: Build `callSitesByTarget` once and reuse.
- [ ] Task 10.X.4.c: Skip per-symbol call sorting when `maxCallsPerSymbol` unset.
- [ ] Task 10.X.4.d: Add large-call-site test to validate identical output with cache.
- [ ] Warn when `impact` CLI receives both seed and changed inputs (changed ignored).
- [ ] Task 10.X.6.a: Emit warning in payload/stderr when both seed and changed provided.
- [ ] Task 10.X.6.b: Add test asserting warning and unchanged behavior.
- [ ] Add microbench harness for graph/context-pack latency + memory.
- [ ] Update `docs/perf/graph-context-pack.md` with new graph index, caching, and excerpt strategies.
- [ ] Add JSDoc on tricky components (GraphIndex, ChunkIndex, adjacency builders, spill/merge, excerpt caches).
- [ ] Deduplicate seed candidates in context-pack assembly to avoid repeated lookups.
- [ ] Add seed normalization tests (posix/windows mix) for context-pack and impact outputs.
- [ ] Add streaming load path for api-contracts symbols/call-sites to avoid full array materialization.
- [ ] Validate api-contracts call-site grouping keys against symbol ids/chunkUids (add fallback).

### Tests
- [ ] `tests/graph/graph-neighborhood-cache.test.js`
- [ ] `tests/graph/graph-index-cache-reuse.test.js`
- [ ] `tests/graph/graph-adjacency-deterministic.test.js`
- [ ] `tests/graph/graph-truncation-deterministic.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-range.test.js`
- [ ] `tests/context-pack/context-pack-range-reads.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-cache.test.js`
- [ ] `tests/context-pack/context-pack-assembly-memory.test.js`
- [ ] `tests/graph/graph-id-remap-roundtrip.test.js`
- [ ] `tests/graph/graph-edge-bucket-determinism.test.js`
- [ ] `tests/graph/graph-lazy-edge-load.test.js`
- [ ] `tests/graph/graph-spill-merge-deterministic.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-dedupe.test.js`
- [ ] `tests/graph/graph-multiseed-bfs-deterministic.test.js`
- [ ] `tests/graph/graph-adjacency-presorted.test.js`
- [ ] `tests/graph/graph-store-cache-eviction.test.js`
- [ ] `tests/graph/architecture-rules-cache.test.js`
- [ ] `tests/graph/suggest-tests-cache.test.js`
- [ ] `tests/context-pack/context-pack-shared-index.test.js`
- [ ] `tests/context-pack/context-pack-range-reads.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-cache.test.js`
- [ ] `tests/graph/graph-output-deterministic.test.js`
- [ ] `tests/graph/architecture-output-deterministic.test.js`
- [ ] `tests/graph/suggest-tests-output-deterministic.test.js`
- [ ] `tests/tooling/impact/impact-changed-and-seed-warning.test.js`
- [ ] `tests/graph/graph-witness-path-lazy.test.js`
- [ ] `tests/graph/graph-filter-predicate-deterministic.test.js`
- [ ] `tests/context-pack/context-pack-excerpt-file-cache.test.js`
- [ ] `tests/graph/graph-truncation-order-deterministic.test.js`
- [ ] `tools/bench/graph/context-pack-latency.js` (new)

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
- [x] Add a startup profiler (checkpoint timing) for CLI commands.
- [x] Ensure `--help` and `--version` avoid loading heavy modules.
- [x] Lazy-load search pipeline and config only after command resolution.
- [x] Avoid loading indexing/runtime configuration for search-only invocations.
- [x] Add a fast-path for `search --help` and `search --backend` validation without full config load.

### Tests
- [x] `tests/cli/search/search-help-fastpath.test.js`
- [x] `tests/cli/search/search-startup-profiler.test.js`
- [x] `tests/cli/search/search-lazy-imports.test.js`

### Acceptance
- [ ] Search CLI startup time improves measurably on cold start.
- [x] `--help` and `--version` do not initialize heavy subsystems.

---

## Phase 12 — Map Build + Viewer Performance

### Objective
Reduce map build memory usage and improve isometric viewer runtime performance on large repos.

### Goals
- Stream map build outputs to avoid large in-memory graph payloads.
- Reduce viewer frame drops via instancing, culling, and LOD.
- Keep build output deterministic and schema-compatible with existing consumers.
- Maintain responsive interaction (selection, hover, pan/zoom) on large graphs.
- Add measurable performance telemetry (build time, peak heap, FPS, dropped frames).

### Non-goals
- Changing map output schema or UI layout semantics.
- Replacing the renderer or UI framework.
- Changing graph/repo map semantics or ranking.
- Introducing new runtime dependencies outside existing map stack.
- Breaking the existing saved map viewer format.

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
- `src/map/isometric/client/perf.js` (new)
- `src/map/isometric/client/telemetry.js` (new)
- `tools/bench/map/build-map-streaming.js` (new)
- `tools/bench/map/build-map-memory.js` (new)
- `tools/bench/map/viewer-fps.js` (new)
- `tools/bench/map/viewer-lod-stress.js` (new)
- `docs/perf/map-pipeline.md` (new)
- `docs/specs/map-artifact.md` (new)
- `tests/map/map-build-streaming.test.js` (new)
- `tests/map/map-build-determinism.test.js` (new)
- `tests/map/map-build-heap-guard.test.js` (new)
- `tests/map/map-edge-aggregate-stability.test.js` (new)
- `tests/map/map-viewer-display-limits.test.js` (new)
- `tests/map/map-viewer-instancing-count.test.js` (new)
- `tests/map/map-viewer-culling-correctness.test.js` (new)
- `tests/map/map-viewer-lod-switch.test.js` (new)
- `tests/map/map-viewer-selection-stability.test.js` (new)
- `tests/map/map-viewer-telemetry.test.js` (new)

### Docs/specs to add or update
- `docs/perf/map-pipeline.md` (new)
- `docs/specs/map-artifact.md` (new; schema + determinism rules)

### Tasks
- [ ] **12.A Map build streaming + memory bounds**
- [x] Task 12.A.1: Define streaming writer in `src/map/build-map/io.js` that accepts async iterables and writes JSON in chunks without buffering full arrays.
- [ ] Task 12.A.2: Refactor `build-map.js` pipeline to emit node/edge/symbol iterables and avoid materializing full graph arrays simultaneously.
- [ ] Task 12.A.3: Add a build “spill” path for large graphs that writes partial node/edge sets to temp files, then merges deterministically.
- [x] Task 12.A.4: Add explicit max-bytes guardrails per section (nodes/edges/symbols) with actionable error messages.
- [x] Task 12.A.5: Preserve current output schema (same keys/ordering), but stream in a deterministic stable order.
- [x] Task 12.A.6: Add per-stage build telemetry (time, peak heap, row counts) and export into `docs/perf/map-pipeline.md`.
- [ ] **12.B Map build determinism + aggregation**
- [x] Task 12.B.1: Define canonical ordering rules for nodes, edges, and symbols (sort keys + tie-breakers).
- [ ] Task 12.B.2: Precompute and serialize edge aggregates (counts, weights, min/max) so viewer doesn’t recompute per frame.
- [ ] Task 12.B.3: Avoid duplicate string retention by interning common labels/paths in `normalize.js`.
- [ ] Task 12.B.4: Ensure `build-map/filters.js` uses shared filters and avoids per-node allocations.
- [ ] Task 12.B.5: Add deterministic hashing of map sections to detect mismatches between runs.
- [x] **12.C Viewer instancing + culling**
- [x] Task 12.C.1: Replace per-node mesh creation with instanced meshes in `meshes.js` and `scene.js`.
- [x] Task 12.C.2: Add frustum culling of node and edge instances with spatial buckets (grid or quadtree).
- [x] Task 12.C.3: Batch edge geometry updates and reuse buffers across frames.
- [x] Task 12.C.4: Add configurable max draw counts for nodes/edges/labels under load.
- [x] Task 12.C.5: Ensure selection/hover works with instanced IDs (stable mapping).
- [x] **12.D LOD + load shedding**
- [x] Task 12.D.1: Introduce LOD tiers for edges and labels (full, simplified, hidden).
- [x] Task 12.D.2: Switch LOD based on zoom level + frame budget + visible count.
- [x] Task 12.D.3: Throttle layout updates during high load and defer non-critical UI.
- [x] Task 12.D.4: Keep semantic selection (selected node/edge always visible).
- [x] **12.E Telemetry + profiling hooks**
- [x] Task 12.E.1: Add viewer FPS + dropped frame counters (`performance.now` + RAF deltas).
- [x] Task 12.E.2: Emit memory usage and active instance counts in `viewer-app.js`.
- [x] Task 12.E.3: Add a “perf HUD” toggle for debugging (dev only).
- [x] Task 12.E.4: Persist build metrics in map artifact metadata (non-breaking optional field).
- [x] **12.F Benchmarks + acceptance harness**
- [x] Task 12.F.1: Add `tools/bench/map/build-map-streaming.js` (baseline vs streaming).
- [x] Task 12.F.2: Add `tools/bench/map/build-map-memory.js` (peak heap, duration).
- [x] Task 12.F.3: Add `tools/bench/map/viewer-fps.js` (FPS under fixed scenario).
- [x] Task 12.F.4: Add `tools/bench/map/viewer-lod-stress.js` (LOD tiers, draw counts).
- [x] Task 12.F.5: Document how to run benchmarks and expected deltas in `docs/perf/map-pipeline.md`.
- [ ] **12.G Sub-agent work packets**
- [ ] Task 12.G.1: Sub-agent Packet A — Map build streaming + memory guards (Tasks 12.A.1–12.A.6).
- [ ] Task 12.G.2: Sub-agent Packet B — Viewer instancing + culling (Tasks 12.C.1–12.C.5).
- [ ] Task 12.G.3: Sub-agent Packet C — LOD + load shedding + telemetry (Tasks 12.D.1–12.E.4).
- [ ] Task 12.G.4: Sub-agent Packet D — Benchmarks + docs (Tasks 12.F.1–12.F.5).

### Tests
- [x] `tests/map/map-build-streaming.test.js`
  - Success: stream writer emits identical JSON to prior build for small graphs.
- [x] `tests/map/map-build-determinism.test.js`
  - Success: identical input yields identical map output hashes across runs.
- [x] `tests/map/map-build-heap-guard.test.js`
  - Success: peak heap stays under threshold for medium fixture.
- [ ] `tests/map/map-edge-aggregate-stability.test.js`
  - Success: aggregate counts/weights match pre-aggregate baseline.
- [x] `tests/map/map-viewer-display-limits.test.js`
  - Success: draw count caps engaged and UI remains responsive.
- [x] `tests/map/map-viewer-instancing-count.test.js`
  - Success: instanced meshes used; instance count matches node count.
- [x] `tests/map/map-viewer-culling-correctness.test.js`
  - Success: off-screen elements are culled; visible set is correct.
- [x] `tests/map/map-viewer-lod-switch.test.js`
  - Success: LOD tiers switch deterministically under zoom/load.
- [x] `tests/map/map-viewer-selection-stability.test.js`
  - Success: selected node remains visible and highlighted across LOD transitions.
- [x] `tests/map/map-viewer-telemetry.test.js`
  - Success: FPS/memory metrics emitted and within expected ranges.

### Acceptance
- [ ] Map build memory usage reduced for large inputs (documented via benchmark).
- [ ] Viewer remains responsive under large graphs (FPS + dropped frames within target).
- [ ] Map output remains deterministic and schema-compatible.
- [ ] Benchmarks demonstrate improvements and are documented.

---

## Phase 13 — Documentation + JSDoc

### Objective
Document the audit outputs and embeddings cache with clear JSDoc requirements.

### Goals
- Ensure docs and config inventories reflect new behavior.
- Require consistent JSDoc for new/shared modules.
- Comprehensively explain any "tricky" or complicated behaviors.
- Make docs discoverable and consistent with code contracts.
- Add explicit examples and invariants for sub-agent execution.

### Non-goals
- Writing new features beyond documentation and JSDoc standards.
- Rewriting unrelated legacy specs.
- Changing runtime behavior or schema just to align docs.

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
- `docs/guides/perfplan-execution.md` (new)
- `docs/guides/roadmap-checklists.md` (new)
- `docs/perf/map-pipeline.md`
- `docs/specs/map-artifact.md`
- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/vfs-index.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-io-batching.md`
- `docs/specs/vfs-segment-hash-cache.md`
- `docs/specs/vfs-cdc-segmentation.md`
- `docs/specs/vfs-cold-start-cache.md`
- `docs/specs/lsp-provider-hardening.md`
- `docs/specs/tooling-provider-registry.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `tests/tooling/docs/embeddings-cache-docs-sync.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md`
- `docs/specs/embeddings-cache.md`
- `docs/contracts/indexing.md`
- `docs/contracts/artifact-contract.md`
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/guides/commands.md`
- `docs/guides/jsdoc-standards.md` (new)
- `docs/guides/perfplan-execution.md` (new)
- `docs/guides/roadmap-checklists.md` (new)

### Doc inventory (Phase 13)
| Doc path | Purpose | Required sections | Code touchpoints | Tests | Gaps |
| --- | --- | --- | --- | --- | --- |
| `docs/perf/indexing-stage-audit.md` | Describe stage audit output + interpretation | Output locations, schema, stage list, counters, interpretation | `src/index/build/stage-checkpoints.js`, `src/index/build/perf-profile.js` | `tests/indexing/runtime/stage-memory-checkpoints.test.js`, `tests/indexing/runtime/stage-timing-checkpoints.test.js` | None |
| `docs/specs/embeddings-cache.md` | Global embeddings cache contract | Layout, keys, invalidation, compression, pruning, examples | `tools/build/embeddings/cache.js`, `src/shared/embeddings-cache/*`, `src/shared/embedding-identity.js` | `tests/indexing/embeddings/cache-*.test.js` | None |
| `docs/perf/map-pipeline.md` | Map build pipeline + perf guardrails | Inputs, pipeline steps, cache, outputs, determinism | `src/map/build-map.js`, `tools/reports/report-code-map.js` | `tests/indexing/map/*` | None |
| `docs/specs/map-artifact.md` | Map model schema + ordering | Schema, node/edge shapes, summary, truncation, determinism | `src/map/build-map.js`, `src/map/constants.js` | `tests/indexing/map/*` | None |
| `docs/specs/tooling-vfs-and-segment-routing.md` | VFS routing + path rules | Path format, offset mapping, disk-path safety, routing | `src/index/tooling/vfs*.js`, `src/index/build/artifacts/writers/vfs-manifest.js` | `tests/tooling/vfs/*` | None |
| `docs/specs/vfs-manifest-artifact.md` | VFS manifest artifact schema | Row schema, trim rules, sort order, meta fields | `src/index/build/artifacts/writers/vfs-manifest.js` | `tests/tooling/vfs/vfs-manifest*.test.js` | None |
| `docs/specs/tooling-provider-registry.md` | Provider registry keys + selection | Provider IDs, selection order, gating | `src/tooling/providers/*` | `tests/tooling/providers/*` | None |
| `docs/contracts/indexing.md` | Indexing contracts + artifacts | Build state, provenance, artifact list | `src/contracts/schemas/*` | `tests/indexing/contracts/*` | None |
| `docs/config/contract.md` + `docs/config/inventory.*` | Config surface + invariants | Keys, defaults, env/cli precedence | `src/shared/config.js`, `src/shared/env.js` | `tests/tooling/docs/config-inventory-sync.test.js` | None |
| `docs/guides/jsdoc-standards.md` | JSDoc requirements | Required tags, examples, determinism rules | `tests/tooling/docs/jsdoc-standards-sync.test.js` | `tests/tooling/docs/jsdoc-standards-sync.test.js` | None |
| `docs/guides/perfplan-execution.md` | How to execute PERFPLAN | Phase order, gating, test steps | `tests/tooling/docs/perfplan-docs-sync.test.js` | `tests/tooling/docs/perfplan-docs-sync.test.js` | None |
| `docs/guides/roadmap-checklists.md` | Checklist policy | Checkbox rules, timestamps, test logging | `tests/tooling/docs/roadmap-checklist-consistency.test.js` | `tests/tooling/docs/roadmap-checklist-consistency.test.js` | None |

### JSDoc requirements
- New/shared modules must document:
  - purpose + performance characteristics
  - input/output types and invariants
  - error behavior + side effects
  - determinism constraints and edge cases
  - cross-platform path handling expectations
  - cache invalidation rules (when applicable)
  - concurrency assumptions and thread-pool interactions

### Tests
- [x] `tests/tooling/docs/embeddings-cache-docs-sync.test.js`
- [x] `tests/tooling/docs/perfplan-docs-sync.test.js` (new)
- [x] `tests/tooling/docs/jsdoc-standards-sync.test.js` (new)
- [x] `tests/tooling/docs/config-inventory-sync.test.js` (new; verifies doc updates when CLI flags change)
- [x] `tests/tooling/docs/spec-links-valid.test.js` (new; ensures spec references resolve)
- [x] `tests/tooling/docs/roadmap-checklist-consistency.test.js` (new)

### Acceptance
- [x] Docs updated and referenced in commands/config inventories.
- [x] JSDoc standards documented and enforced for new modules.
- [x] Perfplan execution guide allows a sub-agent to execute phases without ambiguity.
- [x] Spec links and references are valid and consistent.

### Tasks
- [x] **13.A Inventory + gap analysis**
- [x] Task 13.A.1: Inventory all docs touched by Phases 0–12 and list missing sections (schemas, invariants, examples).
- [x] Task 13.A.2: Identify config/CLI changes that require inventory updates (schema, contract, commands).
- [x] Task 13.A.3: Audit for out-of-date references (renamed files, removed flags, new artifacts).
- [x] Task 13.A.4: Create a doc update checklist with explicit owners and completion criteria.

- [x] **13.B Embeddings cache spec hardening**
- [x] Task 13.B.1: Document cache layout (directory hierarchy, shard naming, metadata).
- [x] Task 13.B.2: Define cache key and invalidation rules (provider/model/dims/quantization/hash).
- [x] Task 13.B.3: Describe compression format, headers, and compatibility guarantees.
- [x] Task 13.B.4: Add examples for cache hits, partial reuse, and invalidation paths.

- [x] **13.C VFS + tooling spec alignment**
- [x] Task 13.C.1: Ensure VFS manifest specs match actual row trimming and sorting order.
- [x] Task 13.C.2: Add precise virtualPath encoding rules and disk-path safety constraints.
- [x] Task 13.C.3: Align token URI and hash routing docs with current code paths.
- [x] Task 13.C.4: Document cold-start cache and segment hash cache invariants.

- [x] **13.D CLI + contracts + inventories**
- [x] Task 13.D.1: Update `docs/contracts/indexing.md` and `docs/contracts/artifact-contract.md` for new artifacts/sidecars.
- [x] Task 13.D.2: Update `docs/guides/commands.md` to reflect new CLI flags or behaviors.
- [x] Task 13.D.3: Regenerate/update config inventories and explain any new fields in `docs/config/contract.md`.

- [x] **13.E JSDoc standards + enforcement**
- [x] Task 13.E.1: Write `docs/guides/jsdoc-standards.md` with mandatory tags and examples.
- [x] Task 13.E.2: Add rules for tricky behaviors (streaming, caching, determinism, path handling).
- [x] Task 13.E.3: Update touched modules with missing JSDoc blocks.

- [x] **13.F Execution guides**
- [x] Task 13.F.1: Add `docs/guides/perfplan-execution.md` describing how to execute phases in order.
- [x] Task 13.F.2: Add `docs/guides/roadmap-checklists.md` explaining checkbox rules and test logging.

- [x] **13.G Docs validation tests**
- [x] Task 13.G.1: Implement `tests/tooling/docs/embeddings-cache-docs-sync.test.js`.
- [x] Task 13.G.2: Add tests for spec link validation and checklist consistency.
- [x] Task 13.G.3: Add docs/config inventory sync test.

### Task details (decision-complete)
#### 13.A Inventory + gap analysis
- [x] Build a doc inventory table in Phase 13 with columns: doc path, purpose, required sections, code touchpoints, tests, gaps.
- [x] List docs touched by Phases 0-12 (use git history and PERFPLAN checklists as source of truth).
- [x] Enumerate missing sections for each doc: schema, invariants, examples, determinism, error behavior, compatibility.
- [x] Capture renamed files/flags/artifacts and link to the code that superseded them.
- [x] Output a checklist of required doc edits with explicit owners and completion criteria.

Doc update checklist (Phase 13.A.4):
- [x] `docs/specs/vfs-hash-routing.md` - Owner: tooling docs - Completion: hash routing path uses docHash with prefix and matches code.
- [x] `docs/specs/vfs-token-uris.md` - Owner: tooling docs - Completion: token derivation and URI format match LSP URI code.
- [x] `docs/specs/vfs-cold-start-cache.md` - Owner: tooling docs - Completion: cache validation, defaults, and testing behavior match code.
- [x] `docs/specs/vfs-segment-hash-cache.md` - Owner: tooling docs - Completion: in-memory LRU behavior and caps match code.
- [x] `docs/perf/map-pipeline.md` - Owner: perf docs - Completion: stage2 map pipeline steps documented.
- [x] `docs/specs/map-artifact.md` - Owner: perf docs - Completion: map schema matches current artifact writer.
- [x] `docs/perf/indexing-stage-audit.md` - Owner: perf docs - Completion: determinism guidance included.
- [x] `docs/contracts/indexing.md` - Owner: contracts docs - Completion: VFS artifacts and sidecars listed.
- [x] `docs/contracts/artifact-contract.md` - Owner: contracts docs - Completion: VFS artifacts and sidecars listed.
- [x] `docs/guides/commands.md` - Owner: docs - Completion: no Phase 13 flag changes; no update required.
- [x] `docs/config/contract.md` + `docs/config/inventory.*` - Owner: docs - Completion: VFS config surface already covered; no update required.

#### 13.B Embeddings cache spec hardening
- [x] Add a cache layout section with full directory tree, shard naming rules, and sidecars.
- [x] Document cache keys and invalidation rules (provider/model/dims/quantization/index signature/schema version).
- [x] Specify compression format(s), headers, and forward/backward compatibility rules.
- [x] Add examples for: cache hit, partial reuse, invalidation after config change.
- [ ] Touchpoints to review:
  - `src/shared/embeddings-cache/*`
  - `tools/build/embeddings/*`
  - `src/index/build/*` (cache reuse/write paths)

#### 13.C VFS + tooling spec alignment
- [x] Align VFS manifest trimming and sorting order with actual implementation (row trim, spill/merge order).
- [x] Document virtualPath encoding and disk-path safety constraints (including Windows specifics).
- [x] Align token URI and hash routing docs with current code.
- [x] Document cold-start cache and segment hash cache invariants (inputs, invalidation, fallbacks).
- [ ] Touchpoints to review:
  - `src/index/build/vfs-*`
  - `src/index/tooling/vfs*`
  - `src/index/segments/*` (CDC segmentation)

#### 13.D CLI + contracts + inventories
- [x] Update `docs/contracts/indexing.md` and `docs/contracts/artifact-contract.md` for new artifacts and sidecars.
- [x] Update `docs/guides/commands.md` for new flags or behavior (no Phase 13 deltas found).
- [x] Regenerate config inventories and add explanations for new fields in `docs/config/contract.md` (no Phase 13 deltas found).
- [x] Touchpoints to review:
  - `src/retrieval/cli*`
  - `src/index/build/*`
  - `tools/*` CLI entrypoints

#### 13.E JSDoc standards + enforcement
- [x] Write `docs/guides/jsdoc-standards.md` with required tags and examples.
- [x] Require sections for streaming behavior, caching/invalidation, determinism, path normalization, concurrency.
- [ ] JSDoc targets (Phase 13 + Quantum spindle work):
  - `src/shared/limits.js`
  - `src/shared/provenance.js`
  - `src/shared/truncation.js`
  - `src/shared/path-normalize.js`
  - `src/shared/time-format.js`
  - `src/shared/seed-ref.js`
  - `src/shared/bloom.js`
  - `src/shared/cache-roots.js`
  - `src/shared/metrics.js`
  - `src/shared/embeddings-cache/layout.js`
  - `src/shared/embeddings-cache/lru.js`
  - `src/shared/embedding-utils.js`
  - `src/shared/embedding-identity.js`
  - `tools/build/embeddings/cache.js`
  - `tools/build/embeddings/manifest.js`
  - `src/index/build/stage-checkpoints.js`
  - `src/retrieval/pipeline/stage-checkpoints.js`
  - `src/retrieval/query-plan-cache.js`
  - `src/retrieval/query-plan-schema.js`
  - `src/index/build/vfs-manifest-collector.js`
  - `src/index/build/vfs-segment-hash-cache.js`
  - `src/index/tooling/vfs-hash-routing.js`
  - `src/index/tooling/vfs-index.js`
  - `src/index/tooling/vfs.js`
  - `src/index/segments/cdc.js`

#### 13.F Execution guides
- [x] `docs/guides/perfplan-execution.md`: how to run phases, gating criteria, expected artifacts, failure triage.
- [x] `docs/guides/roadmap-checklists.md`: checkbox rules, test logging, ISO-8601 timestamp policy.

#### 13.G Docs validation tests
- [x] Add tests under `tests/tooling/docs/`:
  - `embeddings-cache-docs-sync`: ensure required sections and examples exist.
  - `perfplan-docs-sync`: ensure Phase 13 doc inventory table exists and references required docs.
  - `jsdoc-standards-sync`: ensure standards doc exists and includes required tags.
  - `spec-links-valid`: ensure spec references resolve.
  - `roadmap-checklist-consistency`: ensure checklist formatting/requirements.
  - `config-inventory-sync`: ensure config docs match schema.

---

## Phase 14 — Index Artifact Pipelines (State, Imports, Symbols, Postings, Relations, Chunk Meta)

### Objective
Reduce memory and IO overhead for index state writing, import resolution graphs, symbol artifacts, chargram postings, graph relations, and chunk metadata without changing schemas.

### Goals
- Minimize build_state read/modify/write overhead and avoid redundant writes.
- Reduce peak memory for import-resolution graphs and relation aggregation.
- Stream symbol occurrences/edges and chunk metadata without full-array materialization.
- Bound chargram postings growth and prevent unbounded memory spikes.
- Preserve deterministic output and schema compatibility for all artifacts.
- Add targeted microbenchmarks and guards for high‑volume artifacts.

### Non-goals
- Changing artifact schemas or output formats.
- Replacing the tokenizer or changing ranking semantics.
- Introducing new dependencies or native modules.
- Implementing SPIMI (tracked separately in `spimi_spec.md`).

### Files to modify (exhaustive for this phase)
- `src/index/build/build-state.js`
- `src/index/build/stage-checkpoints.js`
- `src/index/build/import-resolution.js`
- `src/index/build/indexer/steps/relations.js`
- `src/index/build/file-processor/relations.js`
- `src/index/build/graphs.js`
- `src/index/build/postings.js`
- `src/index/build/tokenization.js`
- `src/index/build/artifacts/helpers.js`
- `src/index/build/artifacts/graph-relations.js`
- `src/index/build/artifacts/writers/chunk-meta.js`
- `src/index/build/artifacts/writers/symbol-occurrences.js`
- `src/index/build/artifacts/writers/symbol-edges.js`
- `src/index/build/artifacts.js`
- `src/index/build/piece-assembly/merge.js`
- `src/index/validate.js`
- `docs/perf/index-artifact-pipelines.md` (new)
- `docs/specs/build-state.md` (new or update if exists)
- `docs/specs/import-resolution.md` (new)
- `docs/specs/symbol-occurrences.md` (new)
- `docs/specs/symbol-edges.md` (new)
- `docs/specs/chargram-postings.md` (new)
- `docs/specs/graph-relations.md` (new)
- `docs/specs/chunk-meta.md` (new)
- `tools/bench/index/build-state-write.js` (new)
- `tools/bench/index/import-resolution-graph.js` (new)
- `tools/bench/index/symbol-artifacts.js` (new)
- `tools/bench/index/chargram-postings.js` (new)
- `tools/bench/index/graph-relations.js` (new)
- `tools/bench/index/chunk-meta-stream.js` (new)
- `tools/bench/index/jsonl-offset-index.js` (new)
- `tools/bench/index/postings-packed.js` (new)
- `tools/bench/index/jsonl-compression-pipeline.js` (new)
- `tools/bench/index/import-graph-incremental.js` (new)
- `tests/indexing/build-state/build-state-debounce.test.js` (new)
- `tests/indexing/build-state/build-state-merge-consistency.test.js` (new)
- `tests/indexing/imports/import-resolution-cache.test.js` (new)
- `tests/indexing/imports/import-resolution-determinism.test.js` (new)
- `tests/indexing/imports/import-resolution-graph-cap.test.js` (new)
- `tests/indexing/symbols/symbol-occurrences-streaming.test.js` (new)
- `tests/indexing/symbols/symbol-edges-streaming.test.js` (new)
- `tests/indexing/symbols/symbol-artifacts-determinism.test.js` (new)
- `tests/indexing/postings/chargram-postings-memory-guard.test.js` (new)
- `tests/indexing/postings/chargram-postings-spill-merge.test.js` (new)
- `tests/indexing/relations/graph-relations-streaming.test.js` (new)
- `tests/indexing/relations/graph-relations-determinism.test.js` (new)
- `tests/indexing/chunk-meta/chunk-meta-streaming.test.js` (new)
- `tests/indexing/chunk-meta/chunk-meta-trim-order.test.js` (new)
- [x] `tests/indexing/chunk-meta/chunk-meta-ordering.test.js` (new)
- [x] `tests/indexing/artifacts/symbols/symbol-by-file-index.test.js` (new)

### Docs/specs to add or update
- `docs/perf/index-artifact-pipelines.md` (new)
- `docs/specs/build-state.md`
- `docs/specs/import-resolution.md`
- `docs/specs/import-graph-incremental.md` (new)
- `docs/specs/symbol-occurrences.md`
- `docs/specs/symbol-edges.md`
- `docs/specs/symbol-by-file-index.md` (new)
- `docs/specs/chargram-postings.md`
- `docs/specs/postings-packed.md` (new)
- `docs/specs/graph-relations.md`
- `docs/specs/chunk-meta.md`
- `docs/specs/artifact-offset-index.md` (new)
- `docs/specs/artifact-compression-pipeline.md` (new)

### Tasks
- [x] **14.A Foundations: shared streaming + determinism helpers**
- [x] Task 14.A.1: Add shared spill/merge helpers (K‑way heap + JSONL run writer) in `src/index/build/artifacts/helpers.js`.
- [x] Task 14.A.1.a: Reuse the VFS merge‑runs heap for row comparison and deterministic merge order.
- [x] Task 14.A.2: Add shared byte‑tracking helper to avoid repeated JSON.stringify for guards/telemetry.
- [x] Task 14.A.2.a: Provide `trackBytesForRow(row)` that accepts pre‑stringified rows to avoid double work.
- [x] Task 14.A.3: Centralize deterministic comparators for symbol rows, chunk meta rows, and graph relation rows.
- [x] Task 14.A.4: Add shared “trim stats” accumulator for artifact writers (rows dropped, bytes trimmed, max row bytes).
- [x] Task 14.A.5: Add a shared “artifact telemetry” helper that writes counts/bytes to stage checkpoints.

- [x] **14.B Build state writing + streaming**
- [x] Task 14.B.1: Add an in‑memory state cache with version checks to avoid re-reading `build_state.json` on every update.
- [x] Task 14.B.1.a: Cache last‑read state with `mtimeMs` + size fingerprint; invalidate on mismatch.
- [x] Task 14.B.1.b: Keep a per‑buildRoot cache object keyed by resolved path.
- [x] Task 14.B.2: Add a write debounce/merge window (e.g. 250–500ms) to coalesce bursts of updates.
- [x] Task 14.B.2.a: Make debounce window adaptive (short for CLI, longer for batch builds).
- [x] Task 14.B.2.b: Expose an explicit “flush now” hook for shutdown paths.
- [x] Task 14.B.3: Split large subtrees (e.g. stage checkpoints) into separate optional sidecar JSON files to reduce write volume.
- [x] Task 14.B.3.a: Add `build_state.stage-checkpoints.json` (per‑mode) and `build_state.progress.json`.
- [x] Task 14.B.3.b: Keep `build_state.json` minimal with references and updatedAt.
- [x] Task 14.B.4: Add per‑field “dirty” tracking so unchanged sections are not re‑serialized.
- [x] Task 14.B.4.a: Track dirty flags for `phases`, `progress`, `counts`, `signatures`, `stageCheckpoints`.
- [x] Task 14.B.4.b: Skip serialization for sections without dirty flag.
- [x] Task 14.B.5: Add a best‑effort append‑only event log (`build_state.events.jsonl`) for debugging without expanding the main file.
- [x] Task 14.B.5.a: Log `phase` transitions and checkpoint writes only.
- [x] Task 14.B.5.b: Cap log size and rotate by date/build id.
- [x] Task 14.B.6: Ensure `updateBuildState` remains atomic and safe across concurrent callers.
- [x] Task 14.B.6.a: Use the existing queue but ensure coalesced writes apply in order.
- [x] Task 14.B.6.b: Validate merged state includes schema + signature versions.
- [x] Task 14.B.7: Add a last‑write snapshot hash to skip no‑op writes.
- [x] Task 14.B.8: Add explicit shutdown flush in `startBuildHeartbeat` stop handler.
- [x] Task 14.B.9: Add append-only delta records for build_state writes with periodic compaction.
- [x] Task 14.B.9.a: Write `{op, path, value, ts}` deltas to `build_state.deltas.jsonl`.
- [x] Task 14.B.9.b: Add compaction job to rewrite a full snapshot when delta log exceeds a size threshold.
- [x] Task 14.B.9.c: Ensure compaction is atomic and never blocks primary writes.
- [x] Task 14.B.10: Add write-through cache for serialized checkpoint blocks to avoid re-stringify.
- [x] Task 14.B.10.a: Cache JSON strings per section keyed by snapshot hash + size.
- [x] Task 14.B.10.b: Invalidate on dirty flags or schema/version changes.

- [x] **14.C Import resolution graph performance**
- [x] Task 14.C.1: Cache resolved specifiers per importer + tsconfig hash to avoid repeated resolution.
- [x] Task 14.C.1.a: Cache negative lookups for specifiers that do not resolve.
- [x] Task 14.C.1.b: Include `paths`/`baseUrl` fingerprint in cache key.
- [x] Task 14.C.2: Add a fast path when `paths`/`baseUrl` are absent (skip tsconfig traversal).
- [x] Task 14.C.2.a: Detect “no tsconfig in root” once and reuse.
- [x] Task 14.C.3: Replace repeated `fs.existsSync` calls with a directory cache + file lookup map.
- [x] Task 14.C.3.a: Build a `Set` of repo‑relative paths from scan to avoid syscalls.
- [x] Task 14.C.4: Precompute extension candidates and normalize only once per specifier.
- [x] Task 14.C.4.a: Normalize specifiers at parse time and reuse (trim/query/hash removed once).
- [x] Task 14.C.5: Keep graph node/edge caps deterministic; record when caps drop edges.
- [x] Task 14.C.5.a: Record capped count by edge type (imports/usage/calls).
- [x] Task 14.C.6: Emit import‑graph telemetry (nodes, edges, capped count, warnings).
- [x] Task 14.C.6.a: Add telemetry into stage checkpoints for stage2.
- [x] Task 14.C.7: Add a path-segment trie cache for rapid “exists” prefix checks.
- [x] Task 14.C.7.a: Reuse trie to short-circuit repeated path joins under common roots.
- [x] Task 14.C.8: Add negative cache TTL so new files are eventually re-checked.
- [x] Task 14.C.8.a: Evict negative entries after a short window (e.g. 30–60s).
- [x] Task 14.C.9: Precompile `paths`/`baseUrl` matchers into regexes for faster specifier resolution.
- [x] Task 14.C.9.a: Cache compiled matchers per tsconfig fingerprint.

- [x] **14.D Chunk meta streaming**
- [x] Task 14.D.1: Move chunk meta emission to a streaming writer fed from the file processor.
- [x] Task 14.D.1.a: Emit JSONL rows as chunks are finalized.
- [x] Task 14.D.2: Apply `compactChunkMetaEntry` on the fly; avoid holding full `metaV2` in memory.
- [x] Task 14.D.2.a: Track trimmed fields in a per‑artifact stats block.
- [x] Task 14.D.3: Preserve canonical docId ordering even when processing order changes.
- [x] Task 14.D.3.a: Add `canonicalOrderIndex` from discovery order and keep processing reorder separate.
- [x] Task 14.D.3.b: Ensure `orderedAppender` uses canonical order for docId assignment.
- [x] Task 14.D.3.c: Add optional windowed batching to cap pending buffers when processing order diverges.
- [x] Task 14.D.3.d: Detect out‑of‑order chunk_meta stream; only enable external sort when needed.
- [x] Task 14.D.3.e: External sort by numeric `id` only to preserve docId alignment.
- [x] Task 14.D.3.f: Stream JSONL directly when already ordered (skip spill collector).
- [x] Task 14.D.3.g: Emit chunk_meta ordering telemetry in stage checkpoints.
- [x] Task 14.D.3.h: Add docId alignment guardrails and verification in tests.
- [x] Task 14.D.3.i: Add bucketed external sort by `id` range to avoid full compare sort.
- [x] Task 14.D.3.j: Log the first out‑of‑order pair (prevId/nextId) for diagnostics.
- [x] Task 14.D.3.k: Add ID‑only spill index to re‑order without re‑serializing rows.
- [x] Task 14.D.3.l: Cache JSONL row strings when measuring to avoid double stringify in sorting paths.
- [x] Touchpoints 14.D.3: `src/index/build/indexer/steps/discover.js`, `src/index/build/indexer/steps/process-files/tree-sitter.js`, `src/index/build/indexer/steps/process-files/ordered.js`, `src/index/build/artifacts/writers/chunk-meta.js`, `src/index/build/artifacts/helpers.js`, `src/index/validate/checks.js`.
- [x] Task 14.D.4: Track trimming stats (what fields were dropped) in build state.
- [x] Task 14.D.5: Add strict mode test to ensure no trimming occurs on small fixtures.
- [x] Task 14.D.6: Add optional columnar chunk_meta format with boundary conversion to row objects.
- [x] Task 14.D.6.a: Keep compatibility loader that inflates columnar arrays to row objects on demand.
- [x] Task 14.D.6.b: Add config switch + manifest flag for columnar chunk_meta.

- [x] **14.E Symbol occurrences + edges streaming**
- [x] Task 14.E.1: Replace `buildRows` full arrays with streaming iterators over chunks.
- [x] Task 14.E.1.a: Emit rows per chunk; avoid storing all rows in memory.
- [x] Task 14.E.2: Preserve deterministic ordering by sorting per‑chunk and emitting in chunk order.
- [x] Task 14.E.2.a: If chunk order is unstable, add external merge sort by `(file, chunkUid, role/type, targetName)`.
- [x] Task 14.E.3: Add optional spill files for large symbol artifact sets; merge via heap.
- [x] Task 14.E.3.a: Reuse shared spill/merge helper from 14.A.1.
- [x] Task 14.E.4: Track trimming stats (rows dropped/trimmed, max bytes) in stage checkpoints.
- [x] Task 14.E.4.a: Add per‑artifact meta extension with trim counts.
- [x] Task 14.E.5: Ensure trimming preserves required fields (`host`, `role`, `ref`).
- [x] Task 14.E.6: Skip trim work when row byte size is below threshold (avoid repeated JSON.stringify).
- [x] Task 14.E.7: Add optional columnar JSONL format for symbol occurrences/edges.
- [x] Task 14.E.7.a: Convert to row objects at boundaries only (loaders + CLI).
- [x] Task 14.E.8: Add canonical string tables for symbol names/roles/kinds to reduce repetition.
- [x] Task 14.E.8.a: Store string tables in meta and reference by index in rows.

- [x] **14.F Graph relations streaming + measurement**
- [x] Task 14.F.1: Avoid full `graphRelations` materialization for large graphs; stream into JSONL shards.
- [x] Task 14.F.1.a: Build iterator directly from `relations` inputs in `graphs.js`.
- [x] Task 14.F.2: Replace JSON stringify measurement with incremental byte tracking per edge/node.
- [x] Task 14.F.2.a: Track bytes as rows are emitted (no re‑stringify).
- [x] Task 14.F.3: Add deterministic ordering for graph sections and keys.
- [x] Task 14.F.3.a: Define stable graph name ordering + edge ordering rules.
- [x] Task 14.F.4: Record relation counts and caps in `graph_relations.meta.json` extensions.
- [x] Task 14.F.4.a: Include dropped edge counts and cap reasons.
- [x] Task 14.F.5: Add CSR-style adjacency format for graph relations (offsets + edge list).
- [x] Task 14.F.5.a: Keep JSONL output for compatibility and emit CSR as optional artifact.
- [x] Task 14.F.6: Add byte-budgeted streaming caps for graph_relations to avoid runaway growth.
- [x] Task 14.F.6.a: Record precise drop counts and cap thresholds per graph.

- [x] **14.G Chargram postings memory bounds**
- [x] Task 14.G.1: Reuse per‑chunk chargram buffers/sets to avoid allocations.
- [x] Task 14.G.1.a: Maintain a reusable Set and clear it per chunk.
- [x] Task 14.G.2: Add a spill/merge path for chargram postings when `triPost` exceeds a memory threshold.
- [x] Task 14.G.2.a: Spill vocab fragments to sorted JSONL shards, merge via K‑way heap.
- [x] Task 14.G.2.b: Keep deterministic vocab ordering across spills.
- [x] Task 14.G.3: Keep output ordering stable (sorted vocab, deterministic postings order).
- [x] Task 14.G.4: Add instrumentation: max unique chargrams, dropped tokens, spill count.
- [x] Task 14.G.4.a: Emit guard counters into stage checkpoints.
- [x] Task 14.G.5: Add guardrails for `chargramMaxTokenLength` and `chargramMaxN` to avoid runaway growth.
- [x] Task 14.G.6: Add “no‑chargram” short‑circuit for files with empty field tokens.
- [x] Task 14.G.7: Add rolling hash/sliding window chargram generator to reduce allocations.
- [x] Task 14.G.7.a: Implement a reusable buffer to avoid substring allocations per token.
- [x] Task 14.G.8: Add df-based cutoff for high-frequency chargrams to bound postings growth.
- [x] Task 14.G.8.a: Track dropped high-df chargrams in stage checkpoints.

- [x] **14.H Benchmarks + acceptance harness**
- [x] Task 14.H.1: Implement `tools/bench/index/build-state-write.js` comparing baseline vs debounced writes.
- [x] Task 14.H.1.a: Emit JSON summary with p50/p95 latency and write counts + delta.
- [x] Task 14.H.2: Implement `tools/bench/index/import-resolution-graph.js` for nodes/edges throughput.
- [x] Task 14.H.2.a: Report node/edge counts and cap triggers; include seed and baseline delta.
- [x] Task 14.H.3: Implement `tools/bench/index/symbol-artifacts.js` to compare streaming vs baseline.
- [x] Task 14.H.3.a: Include memory watermark and output hash compare.
- [x] Task 14.H.4: Implement `tools/bench/index/chargram-postings.js` to measure memory + throughput.
- [x] Task 14.H.4.a: Include spill count and vocab size metrics + baseline delta.
- [x] Task 14.H.5: Implement `tools/bench/index/graph-relations.js` for JSONL shard throughput.
- [x] Task 14.H.5.a: Report bytes/sec and shard counts + baseline delta.
- [x] Task 14.H.6: Implement `tools/bench/index/chunk-meta-stream.js` for chunk_meta memory.
- [x] Task 14.H.6.a: Include trim stats and output hash + baseline delta.
- [x] Task 14.H.7: Document how to run benchmarks and expected deltas in `docs/perf/index-artifact-pipelines.md`.
- [x] Task 14.H.8: Implement `tools/bench/index/jsonl-offset-index.js` for random-access lookups.
- [x] Task 14.H.8.a: Compare baseline scan vs offset index (p50/p95 row fetch latency).
- [x] Task 14.H.9: Implement `tools/bench/index/postings-packed.js` to compare JSON vs packed postings.
- [x] Task 14.H.9.a: Report size ratio + load time delta for token/phrase/chargram postings.
- [x] Task 14.H.10: Implement `tools/bench/index/jsonl-compression-pipeline.js` for write throughput.
- [x] Task 14.H.10.a: Compare sync write vs worker compression (wall time + CPU).
- [x] Task 14.H.11: Implement `tools/bench/index/import-graph-incremental.js` for incremental rebuilds.
- [x] Task 14.H.11.a: Report reuse ratio (cached vs recomputed) + total time delta.

- [x] **14.I Artifact access + write acceleration**
- [x] Task 14.I.1: Add byte‑offset indexes for JSONL artifacts (chunk_meta, symbols, symbol_occurrences, symbol_edges, graph_relations, call_sites).
- [x] Task 14.I.1.a: Emit offsets during JSONL write (no second pass); store `offsets.bin` (uint64 LE) + `offsets.meta.json`.
- [x] Task 14.I.1.b: For compressed shards, either keep raw JSONL alongside compressed or use seekable zstd frames; document fallback (offsets require uncompressed output).
- [x] Task 14.I.1.c: Add loader utilities for fast row fetch by index (single read + JSON.parse).
- [x] Task 14.I.1.d: Keep offsets in monotonically increasing order; validate last offset + row length against file size.
- [x] Task 14.I.2: Add per‑file symbol row indexes for `symbol_occurrences`/`symbol_edges`.
- [x] Task 14.I.2.a: Resolve `fileId` while streaming (via host chunkUid -> chunk_meta -> fileId); accumulate row offsets per file.
- [x] Task 14.I.2.b: Store per‑file offset lists in packed varint arrays with a small JSON meta.
- [x] Task 14.I.2.c: Add fast path in tooling to load per‑file rows without scanning all parts.
- [x] Task 14.I.2.d: Keep per‑file offset lists sorted by row index to preserve deterministic output.
- [x] Task 14.I.3: Add write batching + worker thread compression for JSONL artifacts.
- [x] Task 14.I.3.a: Buffer rows into fixed-size byte blocks (e.g., 1–4MB) before writing.
- [x] Task 14.I.3.b: Compress blocks in a bounded worker pool; preserve output ordering.
- [x] Task 14.I.3.c: Backpressure when compression lags to avoid unbounded memory.
- [x] Task 14.I.3.d: Prefer zstd (seekable frames) for large shards; fall back to gzip where required.
- [x] Task 14.I.4: Add packed postings format (delta+varint) for docId lists.
- [x] Task 14.I.4.a: Encode docId deltas + tf counts in a binary blob with offsets per token.
- [x] Task 14.I.4.b: Keep JSON as fallback; loader prefers packed when present.
- [x] Task 14.I.4.c: Use block-encoded varints (e.g., 128/256 doc blocks) to balance decode speed + compression.
- [x] Task 14.I.5: Add incremental import‑graph refresh.
- [x] Task 14.I.5.a: Persist per‑file resolution results keyed by file hash + tsconfig fingerprint.
- [x] Task 14.I.5.b: Invalidate cache on tsconfig/package.json/paths changes; reuse for unchanged files.
- [x] Task 14.I.5.c: Track reuse ratio + invalidations in stage checkpoints for tuning.
- [x] Touchpoints 14.I: `src/index/build/artifacts/writers/*.js`, `src/shared/artifact-io/*.js`, `src/index/build/import-resolution-graph.js`, `src/index/build/indexer/steps/discover.js`, `src/index/build/indexer/steps/process-files/ordered.js`, `src/retrieval/*` loaders.

### Tests
- [ ] `tests/indexing/build-state/build-state-debounce.test.js`
  - Success: multiple rapid updates coalesce into a single write.
- [ ] `tests/indexing/build-state/build-state-sidecars.test.js` (new)
  - Success: stage checkpoint sidecars are written and referenced without expanding main build_state.
- [ ] `tests/indexing/build-state/build-state-event-log-rotation.test.js` (new)
  - Success: events JSONL rotates/caps as configured and never blocks build_state writes.
- [ ] `tests/indexing/build-state/build-state-noop-write.test.js` (new)
  - Success: no-op updates skip disk writes (mtime unchanged).
- [ ] `tests/indexing/build-state/build-state-merge-consistency.test.js`
  - Success: concurrent updates do not lose fields or corrupt state.
- [ ] `tests/indexing/build-state/build-state-delta-compaction.test.js` (new)
  - Success: delta logs compact into identical snapshots.
- [ ] `tests/indexing/build-state/build-state-cache-reuse.test.js` (new)
  - Success: cached sections avoid repeat serialization unless dirty.
- [ ] `tests/indexing/imports/import-resolution-cache.test.js`
  - Success: cached resolutions match baseline outputs.
- [ ] `tests/indexing/imports/import-resolution-negative-cache.test.js` (new)
  - Success: negative cache avoids repeated fs checks while preserving output.
- [ ] `tests/indexing/imports/import-resolution-no-tsconfig-fastpath.test.js` (new)
  - Success: fast path used when no tsconfig exists (same graph, fewer stats).
- [ ] `tests/indexing/imports/import-resolution-determinism.test.js`
  - Success: identical inputs produce identical import graphs.
- [ ] `tests/indexing/imports/import-resolution-graph-cap.test.js`
  - Success: cap enforcement is deterministic and logged.
- [ ] `tests/indexing/imports/import-resolution-trie-cache.test.js` (new)
  - Success: trie cache reduces fs hits without changing graph output.
- [ ] `tests/indexing/imports/import-resolution-negative-ttl.test.js` (new)
  - Success: negative cache expires and detects new files.
- [ ] `tests/indexing/imports/import-resolution-regex-cache.test.js` (new)
  - Success: precompiled matchers produce identical resolutions.
- [x] `tests/indexing/imports/import-graph-incremental-reuse.test.js` (new)
  - Success: unchanged files reuse cached resolutions; graph output identical.
- [ ] `tests/indexing/symbols/symbol-occurrences-streaming.test.js`
  - Success: streaming output matches baseline JSONL content.
- [ ] `tests/indexing/symbols/symbol-edges-streaming.test.js`
  - Success: streaming output matches baseline JSONL content.
- [ ] `tests/indexing/symbols/symbol-artifacts-determinism.test.js`
  - Success: stable ordering and identical hashes across runs.
- [ ] `tests/indexing/symbols/symbol-occurrences-spill-merge.test.js` (new)
  - Success: spill+merge output equals baseline order + hash.
- [ ] `tests/indexing/symbols/symbol-edges-spill-merge.test.js` (new)
  - Success: spill+merge output equals baseline order + hash.
- [ ] `tests/indexing/symbols/symbol-columnar-roundtrip.test.js` (new)
  - Success: columnar symbol rows inflate to baseline row objects.
- [ ] `tests/indexing/symbols/symbol-string-table.test.js` (new)
  - Success: string table indices resolve to original values.
- [ ] `tests/indexing/symbols/symbol-by-file-index.test.js` (new)
  - Success: per-file offset index returns the same rows as full scan.
- [ ] `tests/indexing/postings/chargram-postings-memory-guard.test.js`
  - Success: memory guard triggers spill without changing output.
- [ ] `tests/indexing/postings/chargram-postings-spill-merge.test.js`
  - Success: spill+merge output equals baseline in deterministic order.
- [ ] `tests/indexing/postings/chargram-postings-determinism.test.js` (new)
  - Success: vocab ordering + postings are stable across runs.
- [ ] `tests/indexing/postings/chargram-rolling-hash.test.js` (new)
  - Success: rolling chargram generator matches baseline tokens.
- [ ] `tests/indexing/postings/chargram-df-cutoff.test.js` (new)
  - Success: high‑df chargrams are dropped and reported without corrupting postings.
- [x] `tests/indexing/postings/postings-packed-roundtrip.test.js` (new)
  - Success: packed postings decode to the same JSON postings.
- [ ] `tests/indexing/postings/postings-packed-size.test.js` (new)
  - Success: packed size is smaller than JSON for large vocab.
- [ ] `tests/indexing/relations/graph-relations-streaming.test.js`
  - Success: streaming JSONL output matches baseline graph_relations.
- [ ] `tests/indexing/relations/graph-relations-determinism.test.js`
  - Success: deterministic ordering and stable metadata.
- [ ] `tests/indexing/relations/graph-relations-bytes-tracking.test.js` (new)
  - Success: byte counters match JSONL size without re-stringify.
- [ ] `tests/indexing/relations/graph-relations-csr-roundtrip.test.js` (new)
  - Success: CSR adjacency loads to equivalent node/edge sets.
- [ ] `tests/indexing/relations/graph-relations-byte-budget.test.js` (new)
  - Success: caps drop edges deterministically and report counts.
- [ ] `tests/indexing/relations/jsonl-offset-index.test.js` (new)
  - Success: row fetch via offsets matches baseline scan.
- [ ] `tests/indexing/chunk-meta/chunk-meta-streaming.test.js`
  - Success: JSONL output matches baseline for medium fixture.
- [ ] `tests/indexing/chunk-meta/chunk-meta-trim-order.test.js`
  - Success: trimming preserves required fields and order.
- [ ] `tests/indexing/chunk-meta/chunk-meta-external-sort.test.js` (new)
  - Success: external sort restores deterministic order when chunk IDs are shuffled.
- [ ] `tests/indexing/chunk-meta/chunk-meta-canonical-order.test.js` (new)
  - Success: docId alignment holds even when processing order changes.
- [ ] `tests/indexing/chunk-meta/chunk-meta-out-of-order-detection.test.js` (new)
  - Success: ordered streams skip sort; shuffled streams enable id‑sort.
- [ ] `tests/indexing/chunk-meta/chunk-meta-jsonl-shard-order.test.js` (new)
  - Success: sharded JSONL preserves id order across parts.
- [ ] `tests/indexing/chunk-meta/chunk-meta-bucketed-sort.test.js` (new)
  - Success: bucketed id sort matches full sort output with fewer allocations.
- [ ] `tests/indexing/chunk-meta/chunk-meta-id-index-reorder.test.js` (new)
  - Success: ID‑only spill index produces identical output without re‑stringify.
- [ ] `tests/indexing/chunk-meta/chunk-meta-columnar-roundtrip.test.js` (new)
  - Success: columnar format inflates to row objects equivalent to baseline.
- [ ] `tests/indexing/chunk-meta/chunk-meta-offset-index.test.js` (new)
  - Success: chunk_meta row fetch via offsets matches baseline scan.
- [ ] `tests/indexing/artifacts/jsonl-compression-pipeline-order.test.js` (new)
  - Success: worker compression preserves row order and checksums.

### Acceptance
- [ ] Build state writes are coalesced and deterministic.
- [ ] Build state delta logs compact cleanly without blocking writes.
- [ ] Import resolution graphs are faster and use less memory with the same output.
- [ ] Import resolution caches (trie + regex + negative TTL) reduce syscalls without changing results.
- [ ] Incremental import-graph refresh reuses cached resolutions for unchanged files.
- [ ] Symbol occurrences/edges and chunk meta stream without large intermediate arrays.
- [ ] Symbol artifacts optionally support columnar output + string tables with identical semantics.
- [ ] Chunk meta ordering preserves docId alignment regardless of processing order.
- [ ] Chargram postings are bounded by memory guards and retain deterministic output.
- [ ] Chargram postings drop high‑df entries deterministically when configured.
- [ ] Graph relations write paths scale to large repos with sharded JSONL.
- [ ] Graph relations CSR format round‑trips to the same node/edge sets.
- [ ] JSONL offset indexes enable fast random access without full scans.
- [ ] Packed postings are smaller and load faster than JSON in benchmarks.
- [ ] Worker compression preserves row order and checksums while reducing wall time.
- [ ] Benchmarks show measurable gains (baseline vs current deltas captured) and are documented.

### Commit Review (21-40)
- 0f4f4b5c Track chunk_meta trim stats and symbol trim metadata: Regression risk: `resolveChunkMetaOrder` is no longer used, so non-JSONL `chunk_meta` output can become non-deterministic when chunk order is unstable.
- 7e3bfe8e Optimize import resolution graph: Potential regression: skips tsconfig lookup entirely when `tsconfig.json` is not present in the scanned entries; if tsconfig exists but is excluded from entries, `paths`/`baseUrl` resolution is silently disabled.
- 9c1b2d07 Artifacts: fallback chunk_meta + pragma threshold: Potential perf regression if `inputBytes` is missing/0; build pragmas/optimize default to off, even for large builds.
- 3708b325 Stabilize test runner output and tooling fixtures: Potential regression: Swift signatures without explicit return types no longer default to `Void`, which may drop return types in type inference.
- 05e2c83c Fix LSP param type enrichment for clangd: Gap: `mergeSignatureInfo` only adopts `paramTypes` when none exist, so hover results cannot fill missing parameter types for partial signatures.

### Commit Review (41-60)
- 421cc4d9 Implement VFS tokens, coalescing, and CDC segmentation: Gap: token cache in `src/integrations/tooling/lsp/uris.js` is unbounded and never evicted, so long-running sessions can grow memory with many unique virtual paths.
- 75d70209 docs: absorb lexicon drafts into LEXI: Gap: lexicon draft specs were deleted from `future/lexi/*` instead of archived under `docs/archived` per the spec deprecation process.
- 7d3d3f4b Groan improvement (#46): Potential regression: tool script paths were renamed without compatibility shims (e.g. `tools/download-dicts.js` -> `tools/download/dicts.js`), so external automation using old paths will break.

---

### Commit Review (Last 20 commits on QUANTUM-SPINDLE)
- a3644d3d Add columnar chunk_meta support — New `columnar` artifact format is not documented in `docs/contracts/*` or artifact schema allowlists; update artifact contract/schemas and docs to include `.columnar.json` and format enum.
- 602ef1bd Add columnar symbol artifacts — New `symbolArtifactsFormat` config and `.columnar.json` outputs are not reflected in `docs/config/schema.json` / inventory or artifact contract docs; add config surface + contract updates.
- 9567fe0c Optimize chargram generation and drop high-df terms — Added `chargramMaxDf` config without docs/config schema + inventory updates; decide whether public (document) or internal (hide/rename).
