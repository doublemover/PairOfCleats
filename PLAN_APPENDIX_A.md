# Appendix A Plan

This plan tracks the Appendix A tasks from NEW_ROADMAP.md. Update checkboxes as items are completed.

## Setup

## Appendix A - Artifacts, indexing, and build pipeline

This section enumerates each in-scope file and lists file-specific items to address (beyond cross-cutting tasks already listed above).

### src/index/build/artifacts.js
- [ ] (P2) Consider sorting `pieceEntries` by `path` before writing the manifest to reduce diff noise.

### src/index/build/artifacts/checksums.js

### src/index/build/artifacts/compression.js
- [ ] (P2) Consider extending compression to sharded artifacts (optional future work).

### src/index/build/artifacts/file-meta.js
- [ ] (P2) Remove or rename `chunk_authors` in file meta (currently derived from the first chunk and not file-level).

### src/index/build/artifacts/filter-index.js
- [ ] (P2) Consider persisting schema version/config hash in the filter index artifact for easier debugging.

### src/index/build/artifacts/metrics.js
- [ ] (P2) Do not swallow metrics write errors silently (log or propagate based on severity).

### src/index/build/artifacts/token-mode.js
- [ ] (P2) Make parsing more robust (case-insensitive modes; integer parsing + clamping).

### src/index/build/artifacts/writers/chunk-meta.js
- [ ] (P2) Consider normalizing field naming conventions (`chunk_authors` vs `startLine/endLine`).

### src/index/build/artifacts/writers/file-relations.js
- [ ] (P2) Consider JSONL/sharding for very large `file_relations` outputs; add versioning metadata.

### src/index/build/artifacts/writers/repo-map.js
- [ ] (P2) Consider sorting output by `{file, name}` for stability.

### src/index/build/file-processor.js
- [ ] (P2) Move complexity/lint to per-file scope; avoid repeated per-chunk cache checks.
- [ ] (P2) Fix possible timing double-counting across parse/relation durations.

### src/index/build/file-processor/assemble.js

### src/index/build/file-processor/cached-bundle.js
- [ ] (P2) Validate cached bundle shapes more strictly; ensure importLinks shape is consistent.

### src/index/build/file-processor/chunk.js
- [ ] (P2) Adjust comment-to-chunk assignment at boundary (`chunk.end === comment.start`) and consider overlap-based assignment.

### src/index/build/file-processor/incremental.js
- [ ] (P2) Ensure cache invalidation includes schema/version changes for any artifact-impacting changes.

### src/index/build/file-processor/meta.js
- [ ] (P2) Deduplicate `externalDocs` outputs; consider ordering for determinism.

### src/index/build/file-processor/read.js
- [ ] (P2) Consider UTF-8 safe truncation (avoid splitting multi-byte sequences mid-codepoint).

### src/index/build/file-processor/relations.js
- [ ] (P2) Consider sorting/deduping relation arrays (imports/exports/usages) for determinism.

### src/index/build/file-processor/skip.js
- [ ] (P2) Add coverage for `unreadable` and `read-failure` skip paths.

### src/index/build/file-processor/timings.js
- [ ] (P2) Validate that parse/token/embed durations are not double-counted; document semantics.

### src/index/build/graphs.js
- [ ] (P2) Prefer canonical `chunkId` keys where possible instead of `file::name` to avoid collisions.
- [ ] (P2) Sort serialized node lists for full determinism (neighbors are already sorted).

### src/index/build/imports.js

### src/index/build/piece-assembly.js
- [ ] (P2) Remove redundant filterIndex construction (avoid double work; rely on writeIndexArtifacts).

### src/index/build/postings.js
- [ ] (P2) Validate docLengths are finite and consistent; avoid NaN avgDocLen.
- [ ] (P2) Sort Object.entries() iteration for field postings and weights for deterministic output.

### src/index/build/shards.js
- [ ] (P2) Document heuristic thresholds (minFilesForSubdir, hugeThreshold, tenth-largest targets).

### src/index/build/tokenization.js
- [ ] (P2) Review buffer reuse effectiveness (arrays are still cloned); consider pre-sizing and reducing transient allocations further.

### tools/assemble-pieces.js
- [ ] (P2) When `--force` is used, consider cleaning the output dir first to avoid stale artifacts.

### tools/ci-build-artifacts.js

### tools/ci-restore-artifacts.js
- [ ] (P2) Optionally validate `pieces/manifest.json` checksums after restore (fast fail on corrupt artifacts).

### tools/compact-pieces.js
- [ ] (P2) Add perf regression harness and validate output equivalence post-compaction.

### tests/artifact-bak-recovery.js
- [ ] (P2) Expand coverage to include: both primary and backup corrupt; json.gz sidecars; and cleanup expectations.

### tests/artifact-formats.js

### tests/artifact-size-guardrails.js
- [ ] (P2) Extend to cover: chunkMetaFormat=jsonl with switching shard/no-shard, and cleanup behavior.

### tests/artifacts/file-meta.test.js

### tests/artifacts/token-mode.test.js
- [ ] (P2) Add coverage for invalid modes, case-insensitive parsing, and maxTokens/maxFiles parsing edge cases.

### tests/clean-artifacts.js
- [ ] (P2) Consider adding a check that `.bak` files are handled correctly (optional).

### tests/file-processor/cached-bundle.test.js

### tests/file-processor/skip.test.js
- [ ] (P2) Add coverage for `unreadable` and `read-failure` paths (permissions, ENOENT races).

### tests/filter-index-artifact.js
- [ ] (P2) Add a schema assertion for filter_index fields/versioning to prevent drift.

### tests/filter-index.js
- [ ] (P2) Consider adding a determinism check for serialized filter index (same inputs => same output).

### tests/graph-chunk-id.js
- [ ] (P2) Add a collision regression test for graph keys, or migrate to chunkId-based keys.

### tests/incremental-tokenization-cache.js
- [ ] (P2) Add a second invalidation scenario (e.g., tokenization config changes that affect stemming/synonyms).

### tests/piece-assembly.js

### tests/postings-quantize.js
- [ ] (P2) Extend to test scale and dims, and doc/code embedding behavior.

### tests/shard-merge.js
- [ ] (P2) Consider adding checksum and manifest equivalence checks as well.

### tests/shard-plan.js
- [ ] (P2) Add stress case coverage (many files, equal weights, perfProfile enabled).

### tests/tokenization-buffering.js
- [ ] (P2) Consider adding a non-ASCII tokenization regression case.

### docs/artifact-contract.md

### docs/contracts/coverage-ledger.md
- [ ] (P2) Add entries for new/critical tooling: `tools/assemble-pieces.js`, `tools/compact-pieces.js`, and CI artifact scripts.

### docs/contracts/indexing.md

---

## Appendix A - Embeddings, ANN, and retrieval

> The checklist items above are the canonical "what to fix." This appendix maps concrete file-level changes back to those items.

#### src

##### `src/index/build/context-window.js`
- [ ] Sort/sanitize file list before sampling to reduce OS-dependent nondeterminism.
- [ ] Consider documenting that context-window estimation is heuristic and may vary with sampling strategy.

##### `src/index/build/embedding-batch.js`
- [ ] Consider parsing `baseSize` if it may come from config as a numeric string.
- [ ] Add explicit documentation for multiplier precedence (fallback vs user config).

##### `src/index/build/file-processor/embeddings.js`
- [ ] Add dims contract validation (non-empty vectors must share dims; fail fast otherwise).
- [ ] Support `Float32Array` outputs (don't rely on `Array.isArray`).
- [ ] Avoid allocating `new Array(dims).fill(0)` per chunk; reuse a single `zeroVec`.
- [ ] Validate that `getChunkEmbeddings(texts).length === texts.length`; if not, log + fail or retry with a clear warning.
- [ ] Ensure doc embedding results are length-aligned with `docPayloads` (currently assumes perfect alignment).

##### `src/index/build/indexer/embedding-queue.js`
- [ ] Include embedding identity/config hash in job payload to prevent mismatched worker behavior.
- [ ] Consider switching job IDs to `crypto.randomUUID()` for collision resistance.
- [ ] Ensure `maxQueued` has a safe default; document backpressure behavior.

##### `src/index/build/runtime/embeddings.js`
- [ ] Reconcile auto-batch policy with tooling (`tools/build-embeddings/cli.js`).
- [ ] Consider incorporating ONNX thread settings into concurrency auto-tune to avoid oversubscription.

##### `src/index/embedding.js`
- [ ] Centralize `normalizeVec`/`quantizeVec` into shared utilities; remove duplication.
- [ ] Add strict provider validation (unknown provider should error/warn).
- [ ] Harden `normalizeBatchOutput()` to:
  - guarantee output length equals input count,
  - handle unexpected tensor dims more defensively,
  - avoid returning a single huge vector when output is 3D.
- [ ] Prefer returning `Float32Array` (or at least accept typed arrays downstream).

##### `src/retrieval/embedding.js`
- [ ] Use a normalized/fingerprinted ONNX config in the embedder cache key (avoid JSON-order sensitivity).
- [ ] If retrieval can request embeddings without known dims (ANN-only paths), require dims or ensure consistent default dims.
- [ ] Consider logging embedder load failures once (rate-limited) to aid debugging.

##### `src/shared/embedding.js`
- [ ] Unify stub default dims with the rest of the system (recommend 384).
- [ ] Optionally return `Float32Array` to match the desired end-to-end contract.

##### `src/shared/hnsw.js`
- [ ] Implement `.bak` fallback when the primary index exists but is corrupt/unreadable.
- [ ] Read/validate `dense_vectors_hnsw.meta.json` to confirm `dims/space/model` before using the index.
- [ ] Handle empty candidate sets explicitly by returning `[]`.
- [ ] Add unit tests for distance conversion across spaces (l2/cosine/ip) and adjust similarity conversion if required.

##### `src/shared/onnx-embeddings.js`
- [ ] Remove/fix dead provider check (`normalizeEmbeddingProvider('onnx')`).
- [ ] Add clearer error messaging for missing model artifacts + remediation steps.
- [ ] Improve performance by avoiding heavy array conversions and by reusing buffers/tensors.
- [ ] Consider concurrency guards around `session.run()` if onnxruntime sessions are not safe concurrently.

---

#### tools

##### `tools/build-embeddings.js`
- No issues observed beyond those in underlying implementation modules.

##### `tools/build-embeddings/atomic.js`
- [ ] Consider consolidating atomic replace logic with `src/shared/json-stream.js` to avoid divergence (optional refactor).

##### `tools/build-embeddings/cache.js`
- [ ] Expand identity schema to include preprocessing and provider-specific config (especially ONNX knobs).
- [ ] Add a bumpable "identity version" or build-tool version fingerprint.

##### `tools/build-embeddings/chunks.js`
- [ ] Consider incorporating doc-related signals into the chunk signature (or into identity versioning) so doc embedding caches invalidate when doc extraction logic changes.
- [ ] Consider normalizing `start/end` to finite numbers before signature generation (avoid stringifying `undefined`).

##### `tools/build-embeddings/cli.js`
- [ ] Document (or change) the behavior where `mode=service` is coerced to `inline` for this tool.
- [ ] Unify auto-batch defaults with index-build runtime (or document why they differ).

##### `tools/build-embeddings/embed.js`
- [ ] Update to accept and return typed arrays (`Float32Array`) instead of insisting on JS arrays.
- [ ] Consider failing fast on non-vector outputs instead of silently returning `[]` entries (to avoid quietly producing all-zero embeddings).

##### `tools/build-embeddings/hnsw.js`
- [ ] Ensure stable vector insertion order into HNSW (ascending chunkIndex).
- [ ] When adding vectors reconstructed from cache (dequantized), consider re-normalizing for cosine space to reduce drift.

##### `tools/build-embeddings/manifest.js`
- [ ] Consider reading HNSW meta to report accurate `count`/`dims` for ANN piece files, rather than relying on `totalChunks` (defensive correctness).

##### `tools/build-embeddings/run.js`
- [ ] Make cache writes atomic (optional but recommended).
- [ ] Use `Number.isFinite()` for chunk start/end to avoid 0/NaN edge cases from `||` coercion.
- [ ] Apply `ensureVectorArrays()` to embedded doc batches just like code batches.
- [ ] Make HNSW build deterministic (stable insertion order).
- [ ] Consider adding a global cross-file batcher for throughput.

##### `tools/build-embeddings/sqlite-dense.js`
- [ ] Add tests for "vector extension missing/failed to load" fallback behavior.
- [ ] Consider batching inserts in larger chunks or using prepared statements more aggressively for performance on large vector sets.

##### `tools/compare-models.js`
- [ ] If comparing ONNX vs xenova providers, ensure the script can capture and report provider config differences (identity) to interpret deltas correctly (minor enhancement).

##### `tools/download-models.js`
- [ ] Consider supporting explicit download of ONNX model artifacts when users rely on `indexing.embeddings.provider=onnx` and custom `onnx.modelPath`.
- [ ] Improve output to show where models were cached and what to set in config if needed.

---

#### tests

##### `tests/build-embeddings-cache.js`
- [ ] Extend to assert cache identity changes for ONNX config changes (once identity schema is expanded).

##### `tests/embedding-batch-autotune.js`
- [ ] Consider loosening or documenting assumptions about minimum batch size on low-memory systems (or adjust runtime min to match test expectations).

##### `tests/embedding-batch-multipliers.js`
- No issues; good coverage of multiplier normalization.

##### `tests/embeddings-cache-identity.js`
- [ ] Extend to cover ONNX-specific identity fields (tokenizerId/modelPath/etc).

##### `tests/embeddings-cache-invalidation.js`
- [ ] Add invalidation scenarios tied to preprocessing knobs (pooling/normalize/max_length) once surfaced in identity.

##### `tests/embeddings-dims-mismatch.js`
- Good.

##### `tests/embeddings-dims-validation.js`
- Good.

##### `tests/embeddings-sqlite-dense.js`
- [ ] Add coverage for vector extension load failure paths (extension missing), not only baseline dense sqlite insertions.

##### `tests/embeddings-validate.js`
- Good baseline index-state + artifact validation coverage.

##### `tests/hnsw-ann.js`
- [ ] Add correctness assertions beyond "backend selected":
  - candidate set filtering (once exposed),
  - tie-break determinism,
  - sanity check of returned ordering for a known query on fixture corpus.

##### `tests/hnsw-atomic.js`
- [ ] Add test for `.bak` fallback on corrupt primary index/meta (reader-side).

##### `tests/smoke-embeddings.js`
- Good smoke harness; consider adding new tests to this suite after implementing performance regression and fallback tests.

##### `tests/sqlite-vec-candidate-set.js`
- [ ] Add a column-name sanitization test (table is covered; column is not).

##### `tests/vector-extension-sanitize.js`
- Good table sanitization coverage; extend for column sanitization as above.

---
