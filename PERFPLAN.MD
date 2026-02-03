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
- `src/shared/limits.js` (new)
- `src/shared/provenance.js` (new)
- `src/shared/truncation.js` (new)
- `src/shared/path-normalize.js` (new)
- `src/shared/time-format.js` (new)
- `src/shared/seed-ref.js` (new)
- `src/shared/safe-regex.js`
- `src/graph/impact.js`
- `src/graph/suggest-tests.js`
- `src/graph/architecture.js`
- `src/graph/context-pack.js`
- `src/graph/neighborhood.js`
- `src/graph/work-budget.js`
- `src/context-pack/assemble.js`
- `src/index/build/file-scan.js`
- `src/index/build/graphs.js`
- `src/index/build/runtime/caps.js`
- `src/index/comments.js`
- `src/index/segments/config.js`
- `src/index/segments/markdown.js`
- `src/index/structural.js`
- `src/index/risk.js`
- `src/integrations/tooling/api-contracts.js`
- `src/integrations/tooling/architecture-check.js`
- `src/integrations/tooling/context-pack.js`
- `src/integrations/tooling/graph-context.js`
- `src/integrations/tooling/impact.js`
- `src/integrations/tooling/suggest-tests.js`
- `src/retrieval/cli/normalize-options.js`
- `src/retrieval/context-expansion.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/output/filters/file.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/lang/kotlin.js`
- `src/storage/sqlite/utils.js`
- `tools/bench/language/metrics.js`
- `tools/bench/micro/tinybench.js`
- `tools/indexer-service.js`
- `docs/perf/shared-component-audit.md` (new)
- `docs/guides/shared-components.md` (new)
- `docs/guides/path-handling.md`
- `tests/shared/limits/limits-normalization.test.js` (new)
- `tests/shared/provenance/provenance.test.js` (new)
- `tests/shared/truncation/truncation.test.js` (new)
- `tests/shared/seed-ref/parse-seed-ref.test.js` (new)
- `tests/shared/path-handling.test.js`

### Docs/specs to add or update
- `docs/perf/shared-component-audit.md` (new)
- `docs/guides/shared-components.md` (new)

### Tasks
- [x] Inventory duplicate helper patterns across graph/context-pack/retrieval tooling.
- [x] Implement shared helpers for provenance resolution, truncation recording, limit normalization, path normalization, duration formatting, and seed parsing.
- [x] Update all call sites to use shared helpers.
- [x] Normalize seed reference parsing into a shared helper.
- [x] Document shared component expectations and examples.

### Tests
- [x] `tests/shared/provenance/provenance.test.js`
- [x] `tests/shared/truncation/truncation.test.js`
- [x] `tests/shared/limits/limits-normalization.test.js`
- [x] `tests/shared/seed-ref/parse-seed-ref.test.js`
- [x] `tests/shared/path-handling.test.js`

### Acceptance
- [x] Duplicate helper implementations removed and replaced by shared modules.
- [x] Tests enforce shared helper behavior and prevent drift.

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
- `src/index/build/build-state.js`
- `src/index/build/stage-checkpoints.js` (new)
- `tools/build-embeddings/runner.js`
- `tools/build-sqlite-index/runner.js`
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
- [x] Guard checkpoint writes so metrics I/O failures don’t abort builds.

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
- `src/shared/json-stream/streams.js`
- `src/shared/json-stream/compress.js`
- `src/shared/artifact-io.js`
- `src/shared/artifact-io/json.js`
- `src/shared/artifact-io/telemetry.js` (new)
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
- [x] Large artifact loads stay within memory bounds.
- [x] Shared IO paths demonstrate improved throughput.

---

## Cross-cutting Tests to Run
- [x] `node tests/run.js --lane ci-lite`
- [x] `node tests/run.js --lane ci`
- [x] `node tests/run.js --lane ci-long`

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
- `src/index/build/postings.js`
- `src/index/build/tokenization.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/build/file-processor/process-chunks/index.js`
- `src/index/build/file-processor/process-chunks/limits.js`
- `src/index/build/file-processor/cpu/tokenizer.js`
- `docs/perf/indexing-stage-audit.md`
- `tests/indexing/postings/postings-heap-plateau.test.js` (new)
- `tests/indexing/runtime/chunk-retention-sampling.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage1 findings)

### Tasks
- [x] Identify large allocations in postings construction (token/phrase/chargram maps).
- [x] Reduce duplicate string retention (token arrays, field/comment tokenization).
- [x] Evaluate flat postings buffers for token postings (deferred; would require schema change).
- [x] Review token retention defaults for chunk metadata (validated auto sampling).
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
- `src/index/build/graphs.js`
- `src/index/build/artifacts/writers/repo-map.js`
- `src/index/build/artifacts/filter-index.js`
- `src/retrieval/filter-index.js`
- `docs/perf/indexing-stage-audit.md`
- `tests/indexing/relations/relations-memory-release.test.js` (new)
- `tests/indexing/filter-index/filter-index-release.test.js` (new)

### Docs/specs to add or update
- `docs/perf/indexing-stage-audit.md` (update Stage2 findings)

### Tasks
- [x] Identify oversized in-memory relation structures and their lifetimes.
- [x] Avoid buffering call-site edge lists during graph construction.
- [x] Reduce duplicate retention in repo map construction.
- [x] Release filter-index map/set memory after serialization.

### Tests
- [x] `tests/indexing/relations/relations-memory-release.test.js`
- [x] `tests/indexing/filter-index/filter-index-release.test.js`

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
- `tools/build-embeddings/runner.js`
- `tools/build-embeddings/cache.js`
- `tools/build-embeddings/backends.js` (new)
- `tools/build-embeddings/batch.js` (new)
- `tools/build-embeddings/manifest.js`
- `src/shared/embeddings-cache/index.js` (new)
- `src/shared/embeddings-cache/format.js` (new)
- `src/shared/embeddings-cache/layout.js` (new)
- `src/shared/embeddings-cache/lru.js` (new)
- `src/shared/embedding-identity.js`
- `src/shared/embedding-utils.js`
- `src/shared/env.js`
- `src/shared/hash.js`
- `src/shared/json-stream/encode.js`
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
- `tests/indexing/embeddings/embeddings-cache-invalidation.test.js`
- `tests/indexing/embeddings/cache-compression-zstd.test.js` (new)
- `tests/indexing/embeddings/cache-pruning.test.js` (new)
- `tests/indexing/embeddings/cache-cross-repo-reuse.test.js` (new)
- `tests/indexing/embeddings/cache-partial-reuse.test.js` (new)
- `tests/indexing/embeddings/cache-index-append-only.test.js` (new)
- `tests/indexing/embeddings/cache-layout-provider-model.test.js` (new)

### Docs/specs to add or update
- `docs/specs/embeddings-cache.md` (new)
- `docs/contracts/indexing.md` (update Stage3 cache mention)
- `docs/contracts/artifact-contract.md` (note cache is out-of-band)
- `docs/config/schema.json` + `docs/config/contract.md` + `docs/config/inventory.*`
- `docs/guides/commands.md`

### Tasks
- [x] Implement a global, compressed embeddings cache in OS cache root.
- [x] Partition cache by provider/model/dims to avoid scanning unrelated entries.
- [x] Replace per-file cache entries with append-only shards + index for faster listing.
- [x] Cache format: binary + zstd, store quantized vectors and metadata header.
- [x] Include cache schema/version fields (quantization, normalize flags, model identity) in headers.
- [x] Use Node zlib Zstd for cache compression.
- [x] Cache keys include file hash, chunkSignature, identityKey.
- [x] Validate cache key inputs cover content; add chunk-content hash guard if needed.
- [x] Add LRU metadata and two-phase pruning by size and age.
- [x] Ensure cache identity mismatch invalidates entries deterministically.
- [x] Support partial reuse when only some chunks in a file change.
- [x] Isolate HNSW writes in tests/Windows to avoid native heap crashes.

### Tests
- [x] `tests/indexing/embeddings/cache-binary-roundtrip.test.js`
- [x] `tests/indexing/embeddings/embeddings-cache-invalidation.test.js`
- [x] `tests/indexing/embeddings/cache-compression-zstd.test.js`
- [x] `tests/indexing/embeddings/cache-pruning.test.js`
- [x] `tests/indexing/embeddings/cache-cross-repo-reuse.test.js`
- [x] `tests/indexing/embeddings/cache-partial-reuse.test.js` (new)
- [x] `tests/indexing/embeddings/cache-index-append-only.test.js` (new)
- [x] `tests/indexing/embeddings/cache-layout-provider-model.test.js` (new)

### Acceptance
- [x] Cache hits prevent recomputation for unchanged files.
- [x] Cache invalidation works for identity/hash/signature changes.

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
- `src/index/build/vfs-manifest-collector.js`
- `src/index/build/artifacts/file-lists.js`
- `src/index/build/file-processor.js`
- `src/index/build/state.js`
- `src/index/validate/manifest.js`
- `src/shared/artifact-io/fs.js`
- `src/shared/artifact-io/cache.js`
- `src/shared/fs/ignore.js`
- `src/shared/files.js`
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
- `src/index/type-inference-crossfile/tooling.js`
- `src/integrations/tooling/providers/lsp.js`
- `src/integrations/tooling/providers/shared.js`
- `src/integrations/tooling/lsp/client.js`
- `src/integrations/tooling/lsp/positions.js`
- `src/integrations/tooling/lsp/symbols.js`
- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/lsp-provider-hardening.md`
- `docs/specs/tooling-provider-registry.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-index.md`
- `docs/specs/vfs-segment-hash-cache.md`
- `docs/specs/vfs-io-batching.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-cdc-segmentation.md`
- `docs/specs/vfs-cold-start-cache.md`
- `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
- `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
- `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- `tests/tooling/vfs/vfs-hash-routing-contract.test.js`
- `tests/tooling/vfs/vfs-idx-contract.test.js`
- `tests/tooling/vfs/vfs-token-uri-contract.test.js`
- `tests/indexing/vfs/vfs-segment-hash-cache-contract.test.js`
- `tests/indexing/vfs/vfs-cdc-segmentation-contract.test.js`
- `tests/tooling/vfs/vfs-manifest-streaming.test.js` (new)
- `tests/tooling/vfs/vfs-row-size-trim.test.js` (new)

### Docs/specs to add or update
- `docs/specs/vfs-manifest-artifact.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/specs/lsp-provider-hardening.md`
- `docs/specs/tooling-provider-registry.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-index.md`
- `docs/specs/vfs-segment-hash-cache.md`
- `docs/specs/vfs-io-batching.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-cdc-segmentation.md`
- `docs/specs/vfs-cold-start-cache.md`

### Tasks
- [x] **Foundational specs + JSDoc first (blocker):**
  - [x] Expand `docs/specs/vfs-manifest-artifact.md` with schema, row sort order (`compareVfsManifestRows`), virtualPath encoding rules, `docHash` format, trim order, and max row bytes.
  - [x] Expand `docs/specs/tooling-vfs-and-segment-routing.md` with effective language precedence and `.poc-vfs/` routing rules.
  - [x] Expand `docs/specs/lsp-provider-hardening.md` with `poc-vfs` URI encoding, disk fallback mapping, and write semantics.
  - [x] Expand `docs/specs/tooling-provider-registry.md` with provider ordering + language normalization rules.
  - [x] Add/refresh JSDoc in `src/index/tooling/vfs.js` and `src/integrations/tooling/providers/lsp.js` for determinism and safety invariants.
- [x] **Deterministic path + language foundation (must land before perf work):**
  - [x] Define a single effective language resolver used by `buildToolingVirtualDocuments` and `buildVfsManifestRowsForFile`, and align with provider language filtering.
  - [x] Document that `virtualPath` is always derived from `relKey` (POSIX) and only escapes `%`/`#` in the container path.
- [x] Validate VFS virtualPath determinism and path normalization across platforms.
- [x] Stream or shard VFS manifest rows to avoid large in-memory arrays (use collector runs).
- [x] Use a heap/priority queue for `mergeSortedRuns` when there are many run files to avoid `O(runs)` scans per row.
- [x] Enforce row size caps and deterministic trimming rules (extensions → segmentId → drop row).
- [x] Ensure VFS routing always uses `.poc-vfs/` paths for segment docs.
- [x] Use VFS segment language routing to minimize unnecessary tree-sitter loads.
- [x] Provide stable mapping from virtualPath → disk path (for LSP file scheme fallback).
- [x] Skip rewriting VFS disk files when `docHash` is unchanged to reduce IO churn.
- [x] Avoid re-hashing full text when a segment hash can be reused via file hash + range metadata cache.
Note: `docHash` must remain `xxh64` of segment text per the VFS specs; any optimization must reuse cached segment hashes rather than derive from file hash alone.
- [x] Emit VFS metrics (rows, trimmed rows, runs spilled, max line bytes) into stage checkpoints.
- [x] Draft VFS expert enhancement specs (hash routing, vfs index, segment hash cache, IO batching, token URIs, CDC segmentation, cold start cache).
- [x] Add baseline VFS contract tests for hash routing, vfs index, token URIs, segment hash cache, CDC segmentation.

### Tests
- [x] `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
- [x] `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
- [x] `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- [x] `tests/indexing/vfs/vfs-manifest-streaming.test.js`
- [x] `tests/indexing/vfs/vfs-manifest-row-trimming.test.js`
- [x] `tests/tooling/vfs/vfs-row-trim-order.test.js` (new)
- [x] `tests/tooling/vfs/vfs-disk-path-safety.test.js` (new)
- [x] `tests/tooling/vfs/vfs-collector-cleanup-on-error.test.js` (new)
- [x] `tests/tooling/vfs/vfs-doc-hash-skip-rewrite.test.js` (new)
- [x] `tests/tooling/vfs/vfs-hash-routing-roundtrip.test.js` (new)
- [x] `tests/indexing/runtime/vfs-checkpoint-stats.test.js` (new)
- [x] `tests/indexing/vfs/vfs-idx-lookup-roundtrip.test.js` (new)
- [x] `tests/indexing/vfs/vfs-path-map-roundtrip.test.js` (new)
- [x] `tests/tooling/vfs/vfs-hash-routing-contract.test.js`
- [x] `tests/tooling/vfs/vfs-idx-contract.test.js`
- [x] `tests/tooling/vfs/vfs-token-uri-contract.test.js`
- [x] `tests/indexing/vfs/vfs-segment-hash-cache-contract.test.js`
- [x] `tests/indexing/vfs/vfs-cdc-segmentation-contract.test.js`

### Sub-agent Work (Parallelizable)

#### Sub-agent 7A — VFS Routing + Language Audit
- [x] Audit all tooling entrypoints to ensure `.poc-vfs/` routing for segmented docs only.
- [x] Inspect `src/index/tooling/vfs.js`, `src/index/type-inference-crossfile/tooling.js`, `src/index/tooling/provider-registry.js`, `src/integrations/tooling/providers/lsp.js`.
- [x] Confirm `languageId` is normalized to lowercase end-to-end for routing.
- [x] Add/update tests to assert `.poc-vfs/` prefix for segmented docs and correct routing on uppercase language IDs.
- [x] Run: `tests/tooling/vfs/vfs-routing-by-effective-language.test.js` and `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`.
- [x] Update PERFPLAN checkboxes for tasks/tests completed.

#### Sub-agent 7B — VFS Manifest Streaming + Metrics Audit
- [x] Verify `createVfsManifestCollector` is used for all non-empty VFS rows and spills to runs deterministically.
- [x] Inspect `src/index/build/vfs-manifest-collector.js`, `src/index/build/artifacts/writers/vfs-manifest.js`, `src/index/build/indexer/steps/process-files.js`, `src/index/build/indexer/pipeline.js`, `src/index/build/state.js`.
- [x] Add a test to assert VFS stats are emitted into stage checkpoints (rows, bytes, trimmed, dropped, runsSpilled).
- [x] Ensure `mergeSortedRuns` heap ordering is deterministic for equal rows.
- [x] Run: `tests/indexing/vfs/vfs-manifest-streaming.test.js` and the new stats test.
- [x] Update PERFPLAN checkboxes for tasks/tests completed.

#### Sub-agent 7C — VFS docHash Cache (avoid re-hashing)
- [x] Locate all docHash computation call sites (`buildToolingVirtualDocuments`, `buildVfsManifestRowsForFile`) and keep the spec invariant (`xxh64` of segment text).
- [x] Add a bounded in-memory cache keyed by `fileHash + fileHashAlgo + containerPath + segmentUid + segmentRange`.
- [x] Only enable caching when `fileHash` is present; bypass cache if missing to avoid stale hashes.
- [x] Ensure cache key uses normalized POSIX container paths and exact segment ranges.
- [x] Plumb `fileHash` + `fileHashAlgo` into `prepareChunkIds` and `buildVfsManifestRowsForFile`.
- [x] Confirm repeated docHash lookups reuse cached values without changing outputs.
- [x] Update PERFPLAN checkboxes once code + tests are complete.

### Acceptance
- [x] VFS manifest rows are deterministic and schema-valid.
- [x] VFS manifest generation remains bounded in memory.
- [x] Tooling providers work with `.poc-vfs` paths and fall back safely when needed.
- [x] VFS disk fallback mapping is stable and safe for weird path names.
- [x] VFS IO avoids unnecessary rewrites and records useful metrics.

### Optional: VFS Expert Enhancements (Stretch)

#### Goals
- Push VFS throughput and stability on large repos.
- Reduce IO and URI edge cases for tooling providers.

#### Non-goals
- Changing existing tooling output schema.
- Removing existing VFS manifest artifacts.

#### Specs to add or update
- `docs/specs/vfs-hash-routing.md` (new; content-addressed virtual docs + compatibility)
- `docs/specs/vfs-index.md` (new; `.vfsidx` schema + lookup rules)
- `docs/specs/vfs-segment-hash-cache.md` (new; hash keying + invalidation)
- `docs/specs/vfs-io-batching.md` (new; IO queueing + flush rules)
- `docs/specs/vfs-token-uris.md` (new; token map + URI format)
- `docs/specs/vfs-cdc-segmentation.md` (new; content-defined segmentation rules)
- `docs/specs/vfs-cold-start-cache.md` (new; cache layout + pruning)
- `docs/specs/vfs-manifest-artifact.md` (update; if any format changes)
- `docs/specs/tooling-vfs-and-segment-routing.md` (update; routing/segment changes)
- `docs/specs/lsp-provider-hardening.md` (update; URI + disk mapping changes)

#### Tasks
- [x] **Spec + baseline tests first (blocker for stretch work).**
- [x] Content-addressed virtual docs:
  - [x] Touchpoints: `src/index/tooling/vfs.js:24`, `src/index/build/file-processor.js:207`, `src/index/build/artifacts/writers/vfs-manifest.js:286`, `src/integrations/tooling/providers/lsp.js:87`, `src/index/tooling/provider-registry.js:60`.
  - [x] Introduce `.poc-vfs/by-hash/<docHash>.ext` or `.poc-vfs/by-id/<docId>.ext`.
  - [x] Add a sidecar map `virtualPath ↔ containerPath + segmentUid + range`.
  - [x] Keep existing virtualPath for compatibility; add config flag to opt into hash routing.
  - [x] Benchmark: `tools/bench/vfs/hash-routing-lookup.js` (compare path encode vs hash lookup).
- [x] Sparse VFS manifest index (`.vfsidx`):
  - [x] Touchpoints: `src/index/build/artifacts/writers/vfs-manifest.js:138/286`, `src/index/build/vfs-manifest-collector.js:54`.
  - [x] Write a compact index of `virtualPath → byte offset` for each shard.
  - [x] Add a lookup helper that reads only the needed row (no full scan).
  - [x] Benchmark: `tools/bench/vfs/vfsidx-lookup.js` (random lookup vs full scan).
- [x] Segment hash cache:
  - [x] Touchpoints: `src/index/tooling/vfs.js:139/235`, `src/index/build/file-processor.js:207`, `src/shared/hash.js`.
  - [x] Cache segment hashes keyed by `fileHash + range + ext + languageId`.
  - [x] Reuse cached hashes during manifest creation to avoid re-hashing text.
  - [x] Benchmark: `tools/bench/vfs/segment-hash-cache.js` (hash time with/without cache).
- [x] Heap-based merge for many runs:
  - [x] Touchpoints: `src/index/build/artifacts/writers/vfs-manifest.js:74`.
  - [x] Replace `mergeSortedRuns` linear scan with a binary heap priority queue.
  - [x] Keep deterministic ordering via `compareVfsManifestRows`.
  - [x] Benchmark: `tools/bench/vfs/merge-runs-heap.js` (runs=10/50/200).
- [x] Canonical path tokens for LSP URIs:
  - [x] Touchpoints: `src/integrations/tooling/providers/lsp.js:87/95/101/174`, `src/index/tooling/vfs.js:270`.
  - [x] Add a token map (`token → virtualPath`) and use tokens in URIs.
  - [x] Keep fallback decoding for existing virtualPath URIs.
  - [x] Benchmark: `tools/bench/vfs/token-uri-encode.js` (URI encode/parse cost).
- [x] Chunk-range coalescing:
  - [x] Touchpoints: `src/index/tooling/vfs.js:89`, `src/index/build/file-processor/process-chunks/ids.js:3`, `src/index/build/file-processor/process-chunks/index.js:24`.
  - [x] Merge adjacent segments with same language/ext into one virtual doc.
  - [x] Preserve per-target ranges and offsets in the manifest.
  - [x] Benchmark: `tools/bench/vfs/coalesce-docs.js` (doc count + LSP ops).
- [x] Content-defined chunking for segments:
  - [x] Touchpoints: `src/index/build/file-processor/cpu/chunking.js`, `src/index/chunking/*`, `src/index/build/file-processor/process-chunks/index.js:24`.
  - [x] Use rolling hash boundaries to stabilize segment IDs across edits.
  - [x] Benchmark: `tools/bench/vfs/cdc-segmentation.js` (segment churn before/after).
- [x] Bloom filter for shard existence checks:
  - [x] Touchpoints: `src/index/build/artifacts/writers/vfs-manifest.js:286`, `src/index/tooling/vfs.js`, `src/shared/bloom.js`, `docs/specs/vfs-manifest-artifact.md`.
  - [x] Emit a per-shard bloom filter keyed by `virtualPath` or `docHash`.
  - [x] Use filter to skip negative lookups without disk IO.
  - [x] Benchmark: `tools/bench/vfs/bloom-negative-lookup.js` (negative lookup rate).
- [x] Parallel VFS manifest generation:
  - [x] Touchpoints: `src/index/build/file-processor/process-chunks/ids.js`, `src/index/build/file-processor/process-chunks/index.js`, `src/index/build/file-processor.js`, `src/index/build/file-processor/cpu.js`, `src/index/tooling/vfs.js`.
  - [x] Generate VFS rows in parallel with bounded worker pool.
  - [x] Merge/sort deterministically post-parallelization.
  - [x] Benchmark: `tools/bench/vfs/parallel-manifest-build.js` (1/2/4/8 workers).
- [x] IO batching for VFS writes:
  - [x] Touchpoints: `src/integrations/tooling/providers/lsp.js:78`, `src/shared/artifact-io/fs.js`.
  - [x] Batch virtual doc writes (queue + flush) to reduce tiny writes.
  - [x] Benchmark: `tools/bench/vfs/io-batching.js` (write latency on Windows/Linux).
- [x] Partial LSP doc open:
  - [x] Touchpoints: `src/integrations/tooling/providers/lsp.js:174`, `src/shared/lines.js`.
  - [x] Avoid building line indexes for docs that never need symbol queries.
  - [x] Lazy load `buildLineIndex` based on target usage.
- [x] Benchmark: `tools/bench/vfs/partial-lsp-open.js` (doc open latency).
- [x] VFS cold-start cache:
  - [x] Touchpoints: `src/index/tooling/vfs.js`, `src/integrations/tooling/providers/lsp.js`, `docs/specs/vfs-cold-start-cache.md`, `docs/config/schema.json`.
  - [x] Persist a compact cache of hot virtual docs / tool outputs.
  - [x] Add TTL + size cap and use on next run.
  - [x] Benchmark: `tools/bench/vfs/cold-start-cache.js` (cold vs warm).

#### Tests
- [x] `tests/tooling/vfs/vfs-hash-routing.test.js` (new)
- [x] `tests/tooling/vfs/vfs-hash-routing-compat.test.js` (new)
- [x] `tests/tooling/vfs/vfs-index-lookup.test.js` (new)
- [x] `tests/tooling/vfs/vfs-index-negative.test.js` (new)
- [x] `tests/tooling/vfs/vfs-segment-hash-cache.test.js` (new)
- [x] `tests/tooling/vfs/vfs-merge-heap-deterministic.test.js` (new)
- [x] `tests/tooling/vfs/vfs-token-uri-roundtrip.test.js` (new)
- [x] `tests/tooling/vfs/vfs-segment-coalesce.test.js` (new)
- [x] `tests/tooling/vfs/vfs-cdc-segmentation-stability.test.js` (new)
- [x] `tests/tooling/vfs/vfs-partial-lsp-open.test.js` (new)
- [x] `tests/tooling/vfs/vfs-bloom-negative-lookup.test.js` (new)
- [x] `tests/tooling/vfs/vfs-parallel-manifest-deterministic.test.js` (new)
- [x] `tests/tooling/vfs/vfs-io-batch-consistency.test.js` (new)
- [x] `tests/tooling/vfs/vfs-partial-lsp-open.test.js` (new)
- [x] `tests/tooling/vfs/vfs-cold-start-cache.test.js` (new)

#### Acceptance
- [x] Hash/token routing improves URI stability without breaking existing paths.
- [x] `.vfsidx` allows O(log n) lookup for individual docs.
- [x] Segment hash cache reduces hashing time on repeat runs.
- [x] Parallel manifest generation preserves deterministic row ordering.
- [x] IO batching reduces write time without changing contents.
- [x] Cold-start cache improves repeat-run startup time without stale data.

#### Benchmark Harness (Shared)
- [x] Add `tools/bench/vfs/README.md` describing:
  - [x] Dataset fixtures (small/medium/large repos) and how to generate them.
  - [x] Standard bench command format and JSON output schema.
  - [x] Required metrics: wall time, CPU time, peak RSS/heap, IO bytes, file count.
  - [x] Baseline capture + delta reporting rules (median of 5, ignore first run).
  - [x] CI‑safe mode (reduced dataset, no network, fixed seed).

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
- [x] Add grammar churn observability and preflight guards.
  - [x] Record load/eviction/fallback counts in stage audit output.
  - [x] Validate WASM file presence for observed languages once per run.
  - [x] Emit one deterministic warning per missing grammar id.
  - [x] Add a summary of grammar cache size at the end of the stage.
- [x] Centralize language discovery + deterministic inputs.
  - [x] Build observed language set from VFS segment metadata (embedded languages).
  - [x] Normalize and de-duplicate language IDs in one helper used by preload + batching.
  - [x] Preload grammars in deterministic order (frequency desc, then languageId).
  - [x] Ensure `.poc-vfs` routing is the source of truth for embedded languages.
- [x] Ensure lazy initialization and stable configuration.
  - [x] Move `initTreeSitterWasm` behind first parse/preload call.
  - [x] Skip init entirely when tree-sitter is disabled.
  - [x] Cache resolved WASM runtime/grammar paths in build state/runtime cache.
  - [x] Add per-language maxBytes overrides for expensive grammars (TS/JS/HTML).
- [x] Enforce bounded caches in main thread and workers.
  - [x] Improve LRU eviction rules (never evict active grammar).
  - [x] Keep eviction deterministic under the same inputs.
  - [x] Prune worker caches to `maxLoadedLanguages` after each batch.
- [x] Make batching and fallback behavior deterministic.
  - [x] Batch parses by language with stable batch keys.
  - [x] Include embedded language sets in batch keys when relevant.
  - [x] Ensure fallback to heuristic chunking uses consistent logs.
  - [x] Track repeated parse timeouts and disable that language for the current run.
- [x] Extract only what we need, with bounded memory.
  - [x] Precompile and reuse per-language tree-sitter queries.
  - [x] Prefer query-based extraction where supported; fall back to traversal otherwise.
  - [x] Stream chunk candidates during traversal to avoid large node arrays.
- [x] Add adaptive tuning for heavy grammars.
  - [x] Track node density metrics per language.
  - [x] Adjust traversal caps for dense grammars.
- [x] Reuse parse work across incremental runs.
  - [x] Cache parse trees by file hash/mtime in watch/incremental mode.
  - [x] Invalidate cache on content changes.
- [x] Parallelize worker parsing by language batches.
  - [x] Group worker tasks by language id for batch execution.
  - [x] Ensure worker pruning between batches.

### Milestones
- [x] **Determinism + Observability**: churn metrics, preflight checks, deterministic preload order, shared language discovery helper.
- [x] **Bounded Caches**: deterministic LRU eviction and worker pruning with strict `maxLoadedLanguages`.
- [x] **Extraction Efficiency**: query caching + query-based extraction + streaming chunk emission.
- [x] **Adaptive + Incremental**: adaptive traversal budgets and parse tree reuse for unchanged files.

### Tests
- [x] `tests/indexing/tree-sitter/tree-sitter-preload-limited.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-preload-order-deterministic.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-eviction-determinism.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-batch-by-language.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-fallback-missing-wasm.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-worker-prune-bounds.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-vfs-language-routing.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-query-precompile-cache.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-streaming-chunking.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-adaptive-budget.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-timeout-disable.test.js`
- [x] `tests/indexing/tree-sitter/tree-sitter-wasm-path-cache.test.js`

### Acceptance
- [x] WASM grammar count stays within configured bounds.
- [x] Tree-sitter load failures do not crash indexing.
- [x] Language preloading is limited to observed repo languages.
- [x] Preload/eviction order is deterministic across runs with the same inputs.
- [x] Worker pool cache stays within configured bounds.
- [x] Query compilation overhead is amortized across files.
- [x] Chunking uses bounded memory even on large trees.
- [x] Repeated timeouts degrade gracefully without reattempt storms.

---

## Phase 9 — Retrieval Pipeline Performance (Query → Candidates → Rank → Output)

### Objective
Reduce query latency and memory use by minimizing repeated parsing, avoiding unnecessary artifact loads, optimizing candidate/filter/ranking stages, and improving search script startup time.

### Goals
- Improve cold and warm query latency by reducing repeated work.
- Reduce per-query memory spikes for large result sets.
- Speed up `search` script startup via lazy imports and artifact gating.

### Non-goals
- Changing query semantics or ranking behavior.
- Changing output schema or CLI flags.

### Phase 9A — Query Plan + Parse Cache

#### Goals
- Parse/normalize queries once and reuse across modes.
- Cache derived query artifacts (tokens, AST, phrase sets, filter hints).
- Make plan caching deterministic, bounded, and safe to invalidate.

#### Non-goals
- Changes to parsing semantics or tokenization behavior.

#### Touchpoints
- `src/retrieval/query.js`
- `src/retrieval/query-parse.js`
- `src/retrieval/query-intent.js`
- `src/retrieval/pipeline/query-ast.js`
- `src/retrieval/query-cache.js`
- `src/retrieval/cli/query-plan.js`
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/query-plan-schema.js` (new)
- `tests/retrieval/pipeline/query-cache-hit.test.js` (new)
- `tests/retrieval/pipeline/query-plan-invalidates-config.test.js` (new)
- `tests/retrieval/pipeline/query-plan-invalidates-index.test.js` (new)
- `tests/retrieval/pipeline/query-plan-requirements.test.js` (new)
- `tests/retrieval/pipeline/query-plan-cache-key.test.js` (new)
- `tests/retrieval/pipeline/query-plan-eviction.test.js` (new)
- `tests/retrieval/pipeline/query-plan-schema-version.test.js` (new)

#### Tasks
- [x] Add an in-memory query plan cache keyed by query + normalized config + index signature.
- [x] Persist parse + plan shape (AST, tokens, phrase ngrams, filter hints) inside the plan.
- [x] Define plan cache key material explicitly (normalized query, tokenizer version, parser version, retrieval config hash, index signature hash).
- [x] Add a plan schema with versioning and validation.
- [x] Implement cache eviction (size cap + TTL) and explicit invalidation hooks for config reload.
- [x] Ensure plan cache invalidates on config changes (tokenization, filters, ANN backend, scoring).
- [x] Ensure plan cache invalidates on index signature changes.
- [x] Record cache hits/misses in metrics.

#### Tests
- [x] `tests/retrieval/pipeline/query-cache-hit.test.js`
- [x] `tests/retrieval/pipeline/query-plan-invalidates-config.test.js`
- [x] `tests/retrieval/pipeline/query-plan-invalidates-index.test.js`
- [x] `tests/retrieval/pipeline/query-plan-requirements.test.js`
- [x] `tests/retrieval/pipeline/query-plan-cache-key.test.js`
- [x] `tests/retrieval/pipeline/query-plan-eviction.test.js`
- [x] `tests/retrieval/pipeline/query-plan-schema-version.test.js`

#### Acceptance
- [x] Query parse and plan reuse across modes.
- [x] Plan cache invalidates deterministically on config/index changes.
- [x] Plan cache stays within size/TTL bounds and reports hit/miss metrics.

---

### Phase 9E — Observability + Output Fast Paths

#### Goals
- Add per-stage retrieval timing/memory checkpoints.
- Reduce output formatting overhead and unnecessary file reads.

#### Non-goals
- Changing output format or schema.

#### Touchpoints
- `src/retrieval/pipeline.js`
- `src/retrieval/output/format.js`
- `src/retrieval/output/context.js`
- `src/retrieval/output/summary.js`
- `src/retrieval/output/cache.js`
- `src/retrieval/cli/render.js`
- `tests/retrieval/pipeline/retrieval-stage-checkpoints.test.js` (new)
- `tests/retrieval/output/output-cache-hit.test.js` (new)

#### Tasks
- [x] Add retrieval stage checkpoints (parse, filter, candidates, ANN, fusion, rank, output).
- [x] Emit optional timing/memory summary in verbose mode.
- [x] Delay file reads for summaries/context until needed.
- [x] Expand output caches to reuse formatting work.
- [x] Stream large JSON outputs to avoid building full arrays in memory.
- [x] Add a “no-context” output path that skips file reads entirely when context is not requested.

#### Tests
- [x] `tests/retrieval/pipeline/retrieval-stage-checkpoints.test.js`
- [x] `tests/retrieval/output/output-cache-hit.test.js`
- [x] `tests/retrieval/output/json-streaming.test.js` (new)
- [x] `tests/retrieval/output/context-skips.test.js` (new)

#### Acceptance
- [x] Retrieval stage telemetry is recorded.
- [x] Output path avoids unnecessary IO.

---

### Phase 9B — Artifact Gating + Search Startup

#### Goals
- Avoid loading heavy artifacts when the query plan does not require them.
- Reduce search script cold-start time with lazy imports and fast paths.

#### Non-goals
- Removing any existing artifacts or changing their schema.

#### Touchpoints
- `src/retrieval/cli/index-loader.js`
- `src/retrieval/cli/load-indexes.js`
- `src/retrieval/cli/search-runner.js`
- `src/retrieval/cli/run-search-session.js`
- `src/retrieval/index-cache.js`
- `src/retrieval/sqlite-cache.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/output/cache.js`
- `bin/pairofcleats.js`
- `search.js`
- `src/integrations/core/search.js`
- `tests/retrieval/pipeline/search-startup-fastpath.test.js` (new)
- `tests/retrieval/pipeline/artifact-gating.test.js` (new)
- `tests/retrieval/pipeline/index-loader-lazy.test.js` (new)
- `tests/retrieval/pipeline/ann-lazy-import.test.js` (new)
- `tests/retrieval/pipeline/artifact-gating-deps.test.js` (new)
- `tests/cli/search/search-startup-checkpoints-order.test.js` (new)

#### Tasks
- [x] Introduce a query-plan “requiredArtifacts” set (filterIndex, fileRelations, graphRelations, repoMap, contextIndex, ann).
- [x] Define artifact dependency rules (e.g., repoMap requires graphRelations, filterIndex requires tokenIndex) and enforce them.
- [x] Load only required artifacts for the plan; defer everything else.
- [x] Ensure lazy index loader only parses manifest/metadata first.
- [x] Lazy-import ANN backends and storage adapters only when required by the plan.
- [x] Parallelize required artifact loads with a small concurrency limit and deterministic ordering.
- [x] Add search startup profiler checkpoints and document them.
- [x] Add fast paths for `search --help`/`--version` without initializing retrieval internals.

#### Tests
- [x] `tests/retrieval/pipeline/search-startup-fastpath.test.js`
- [x] `tests/retrieval/pipeline/artifact-gating.test.js`
- [x] `tests/retrieval/pipeline/index-loader-lazy.test.js`
- [x] `tests/retrieval/pipeline/ann-lazy-import.test.js` (new)
- [x] `tests/retrieval/pipeline/artifact-gating-deps.test.js` (new)
- [x] `tests/cli/search/search-startup-checkpoints-order.test.js` (new)

#### Acceptance
- [x] Search startup avoids loading unused artifacts.
- [x] `search --help` avoids heavy initialization.
- [x] Artifact gating respects dependency rules with deterministic load order.

---

### Phase 9C — Filters + Bitsets

#### Goals
- Replace `Set`-based allowed IDs with bitmap/bitset flow where feasible.
- Short-circuit filters and reduce per-query allocations.

#### Non-goals
- Changing filter semantics.

#### Touchpoints
- `src/retrieval/filters.js`
- `src/retrieval/filter-index.js`
- `src/retrieval/bitmap.js`
- `src/retrieval/output/filters.js`
- `src/retrieval/output/filters/file-prefilter.js`
- `src/retrieval/output/filters/predicates.js`
- `tests/retrieval/pipeline/filter-bitmap-shortcircuit.test.js` (new)
- `tests/retrieval/pipeline/filter-bitmap-equivalence.test.js` (new)

#### Tasks
- [x] Build bitmap representations for filter results and candidate sets.
- [x] Use bitmap intersection/union for fast allowlist computation.
- [x] Define a Set↔bitmap threshold (cardinality-based) and keep it configurable.
- [x] Ensure bitmap↔id mapping remains stable across index versions.
- [x] Compile and cache path/ext/pattern predicates in the query plan.
- [x] Add early exit when allowlist is empty or unchanged.
- [x] Keep `Set` fallback for small populations.

#### Tests
- [x] `tests/retrieval/pipeline/filter-bitmap-shortcircuit.test.js`
- [x] `tests/retrieval/pipeline/filter-bitmap-equivalence.test.js`
- [x] `tests/retrieval/pipeline/filter-compiled-reuse.test.js` (new)
- [x] `tests/retrieval/pipeline/filter-bitmap-threshold.test.js` (new)

#### Acceptance
- [x] Filtered queries avoid large `Set` allocations.
- [x] Filter semantics remain identical.

---

### Phase 9D — Candidates + Ranking + ANN

#### Goals
- Reduce candidate retention and full-array sorting.
- Use top‑K selection and early cutoffs where possible.
- Minimize per-query allocations and duplicate candidate materialization.
- Ensure deterministic ordering and stable tie‑breaking.

#### Non-goals
- Changing ranking semantics or ANN backends.

#### Touchpoints
- `src/retrieval/pipeline/candidates.js`
- `src/retrieval/pipeline/fusion.js`
- `src/retrieval/pipeline/graph-ranking.js`
- `src/retrieval/pipeline/ann-backends.js`
- `src/retrieval/rankers.js`
- `src/retrieval/ann/providers/*`
- `src/retrieval/pipeline/candidate-pool.js` (new)
- `src/retrieval/pipeline/topk.js` (new)
- `src/retrieval/pipeline/score-buffer.js` (new)
- `tests/retrieval/pipeline/candidates-memory-plateau.test.js` (new)
- `tests/retrieval/pipeline/ranking-fastpath.test.js` (new)
- `tests/retrieval/pipeline/topk-equivalence.test.js` (new)
- `tests/retrieval/pipeline/topk-tie-break.test.js` (new)
- `tests/retrieval/pipeline/candidates-buffer-reuse.test.js` (new)
- `tests/retrieval/pipeline/candidates-early-cutoff.test.js` (new)
- `tests/retrieval/pipeline/ann-optional-skip.test.js` (new)
- `tests/retrieval/pipeline/ann-fallback-nonvector.test.js` (new)

#### Tasks
- [x] Add a `topk` helper with heap selection and stable tie‑breaking (score, id, secondary key).
- [x] Define the exact tie‑break order (primary score desc, secondary normalized id asc, tertiary source rank).
- [x] Document ordering invariants in `docs/perf/retrieval-pipeline.md` with examples.
- [x] Add a `score-buffer` pool for candidate scores and ids; reuse across pipeline stages.
- [x] Size the pool based on `k` and the max candidate fanout; cap to avoid unbounded growth.
- [x] Stream candidate generation into top‑K rather than materializing full arrays.
- [x] Implement a streaming reducer that only keeps `k + slack` best candidates.
- [x] Add an early cutoff mechanism (score thresholds, `k` saturation, optional time budget).
- [x] Define cutoff heuristics and ensure they never drop a potentially better candidate.
- [x] Reduce duplicate candidate materialization between BM25 + ANN by using shared buffers.
- [x] Merge score buffers in-place to avoid re-allocating intermediate arrays.
- [x] Ensure ANN backends are only initialized when vector mode is active and required.
- [x] Guard ANN initialization behind `requiredArtifacts` and vector mode flags.
- [x] Implement a strict fallback path when ANN is unavailable (log + continue with sparse).
- [x] Define a single warning log with clear reason and recovery path.
- [x] Add metrics for candidate counts, buffer reuse, and cutoff triggers.
- [x] Emit metrics in verbose mode and in perf checkpoints.

#### Tests
- [x] `tests/retrieval/pipeline/candidates-memory-plateau.test.js`
  - Validates that peak memory stays flat (no full-array materialization) on large candidate sets.
  - Success: peak RSS/heap growth remains within a fixed threshold vs baseline.
- [x] `tests/retrieval/pipeline/ranking-fastpath.test.js`
  - Verifies ranking path uses top‑K selection instead of full sort when `k << N`.
  - Success: top‑K helper is invoked; results match full sort output.
- [x] `tests/retrieval/pipeline/topk-equivalence.test.js`
  - Compares top‑K output with full sort for randomized candidate sets.
  - Success: identical ordering and scores for multiple seeds.
- [x] `tests/retrieval/pipeline/topk-tie-break.test.js` (new)
  - Exercises equal-score candidates with differing ids/sources.
  - Success: deterministic tie order matches documented rules.
- [x] `tests/retrieval/pipeline/candidates-buffer-reuse.test.js` (new)
  - Asserts score/id buffers are reused across stages without reallocations.
  - Success: allocation counter does not increase across repeated queries.
- [x] `tests/retrieval/pipeline/candidates-early-cutoff.test.js` (new)
  - Forces cutoff conditions and verifies no better candidates are dropped.
  - Success: results equal to non-cutoff baseline.
- [x] `tests/retrieval/pipeline/ann-optional-skip.test.js` (new)
  - Simulates missing ANN backend in vector mode.
  - Success: warning is logged once; pipeline continues with sparse results.
- [x] `tests/retrieval/pipeline/ann-fallback-nonvector.test.js` (new)
  - Ensures ANN is not initialized when query does not require vectors.
  - Success: ANN provider init not called; results are correct.

#### Acceptance
- [x] Candidate and ranking stages reduce memory spikes and avoid full-array sorts on large inputs.
- [x] Top‑K results match prior ordering within deterministic tie rules.
- [x] ANN backends are only initialized when required and safe to use.
- [x] Fallback to sparse-only ranking preserves correct results without hard failures.

---

### Phase 9F — Stretch Optimizations (Optional)

#### Goals
- Push retrieval performance further without changing semantics.

#### Non-goals
- Introducing new dependencies or index schema changes.

#### Touchpoints
- `src/retrieval/pipeline/*`
- `src/retrieval/ann/*`
- `src/retrieval/sparse/*`
- `src/retrieval/output/*`

#### Tasks
- [x] Add lightweight persistent query-plan cache (optional disk cache) to avoid parse cost across runs.
- [x] Use typed arrays for score accumulation and reduce object churn.
- [x] Add small object pools for candidate structs and buffers to reduce GC churn.
- [x] Add ANN backend preflight to avoid slow failures and repeated retries.
- [x] Profile and cap expensive explain output work when not requested.

#### Tests
- [x] `tests/retrieval/pipeline/query-plan-disk-cache.test.js` (new)
- [x] `tests/retrieval/pipeline/ann-preflight.test.js` (new)
- [x] `tests/retrieval/pipeline/query-plan-disk-cache-size-cap.test.js` (new)
- [x] `tests/retrieval/pipeline/object-pool-leak.test.js` (new)

#### Acceptance
- [x] Additional performance improvements measurable in microbenchmarks.

---

### Docs/specs to add or update
- `docs/perf/retrieval-pipeline.md` (new; includes startup checkpoints and artifact gating rules)

### Acceptance (Phase 9 overall)
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
- `tools/dict-utils.js`
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
- Comprehensively explain any "tricky" or complicated behaviors

### Non-goals
- Writing new features beyond documentation and JSDoc standards.

### Files to modify (exhaustive for this phase)
- any files modified by previous phases in this branch
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
