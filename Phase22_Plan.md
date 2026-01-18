
## Phase 22 — Embeddings & ANN (onnx/HNSW/batching/candidate sets)

**Objective:** harden the embeddings + ANN stack for correctness, determinism (where required), performance, and resilient fallbacks across **index build**, **build-embeddings tooling**, and **retrieval-time ANN execution**.

---

#### 22.2.3 Session/model reuse

##### Remaining gaps / action items
- [x] **Guard concurrent use of shared ONNX sessions if required**:
  - [x] Add a per-session mutex/queue around `session.run()` to avoid concurrent use.
  - [x] Document thread-safety assumptions and add a stress test.

---

### 22.4 Performance improvements to prioritize

#### 22.4.2 Minimize serialization between threads/processes (transferable buffers)
- [x] Where embeddings are computed in worker threads/processes (service mode), prefer:
  - transferring `ArrayBuffer`/`SharedArrayBuffer` instead of JSON arrays,
  - or using binary packed formats for vectors.
- [x] Add an explicit “embedding payload format” version in job payloads so workers and callers stay compatible.
  - File touchpoints: `src/index/build/indexer/embedding-queue.js` (job payload)

#### 22.4.3 Pre-allocate and reuse buffers
- [x] **ONNX embedding path**:
  - Avoid per-call allocations:
    - re-use `BigInt64Array` buffers for token ids/masks where shapes are stable,
    - avoid `Array.from()` conversions for slices.
  - Files: `src/shared/onnx-embeddings.js`

#### 22.4.4 Candidate generation tuning
- [x] Push sparse filters earlier and reduce dense scoring work:
  - prefer ANN-restricted candidate sets before dense dot products,
  - prefer pushing candidate constraints into sqlite-vec queries when small enough (already partially implemented).
  - (Some of this lives outside the reviewed file list; track as cross-cutting work.)


---

### 22.5 Refactoring goals

#### 22.5.1 Single embedding interface shared by build + retrieval
- [x] Create a single shared adapter interface, e.g.:
  - `embed(texts: string[], opts) => Float32Array[]`
  - `embedOne(text: string, opts) => Float32Array`
- [x] Move provider selection + error handling behind adapters:
  - `xenova`, `onnx`, `stub`.
- [x] Ensure both index-build and retrieval use the same adapter and the same preprocessing defaults.

#### 22.5.2 Centralize normalization & preprocessing
- [x] Eliminate duplicated `normalizeVec()` implementations:
  - `src/index/embedding.js`
  - `src/shared/onnx-embeddings.js`
  - `tools/build-embeddings/embed.js` (indirectly uses index/embedding normalization)
- [x] Centralize:
  - pooling strategy,
  - normalization strategy,
  - truncation/max_length policy,
  - doc/code merge policy.

#### 22.5.3 Clear ANN backend adapters
- [x] Wrap sqlite-vec and HNSW behind a single “ANN adapter” contract with:
  - candidate set semantics,
  - deterministic tie-break contract,
  - consistent error handling and stats reporting.
  - (Some of this lives outside the reviewed file list.)

---

### Appendix A — File-by-file review notes (actionable items)

> The checklist items above are the canonical “what to fix.” This appendix maps concrete file-level changes back to those items.

#### Appendix A - Artifacts, indexing, and build pipeline (remaining)

- [x] `src/index/build/artifacts.js` (P2) Sort `pieceEntries` by `path` before writing the manifest to reduce diff noise.
- [x] `src/index/build/artifacts/compression.js` (P2) Extending compression to sharded artifacts.
- [x] `src/index/build/artifacts/file-meta.js` (P2) Rename `chunk_authors` in file meta (currently derived from the first chunk and not file-level). (No chunk_authors present.)
- [x] `src/index/build/artifacts/filter-index.js` (P2) Persist schema version/config hash in the filter index artifact for easier debugging.
- [x] `src/index/build/artifacts/metrics.js` (P2) Do not swallow metrics write errors silently (log or propagate based on severity).
- [x] `src/index/build/artifacts/token-mode.js` (P2) Make parsing more robust (case-insensitive modes; integer parsing + clamping).
- [x] `src/index/build/artifacts/writers/chunk-meta.js` (P2) Normalize field naming conventions (`chunk_authors` vs `startLine/endLine`).
- [x] `src/index/build/artifacts/writers/file-relations.js` (P2) JSONL/sharding for very large `file_relations` outputs; add versioning metadata.
- [x] `src/index/build/artifacts/writers/repo-map.js` (P2) Sort output by `{file, name}` for stability.
- [x] `src/index/build/file-processor.js` (P2) Move complexity/lint to per-file scope; avoid repeated per-chunk cache checks.
  - [x] (P2) Fix possible timing double-counting across parse/relation durations.
- [x] `src/index/build/file-processor/cached-bundle.js` (P2) Validate cached bundle shapes more strictly; ensure importLinks shape is consistent.
- [x] `src/index/build/file-processor/chunk.js` (P2) Adjust comment-to-chunk assignment at boundary (`chunk.end === comment.start`) and consider overlap-based assignment.
- [x] `src/index/build/file-processor/incremental.js` (P2) Ensure cache invalidation includes schema/version changes for any artifact-impacting changes.
- [x] `src/index/build/file-processor/meta.js` (P2) Deduplicate `externalDocs` outputs; consider ordering for determinism.
- [x] `src/index/build/file-processor/read.js` (P2) UTF-8 safe truncation (avoid splitting multi-byte sequences mid-codepoint).
- [x] `src/index/build/file-processor/relations.js` (P2) Sorting/deduping relation arrays (imports/exports/usages) for determinism.
- [x] `src/index/build/file-processor/skip.js` (P2) Add coverage for `unreadable` and `read-failure` skip paths.
- [x] `src/index/build/file-processor/timings.js` (P2) Validate that parse/token/embed durations are not double-counted; document semantics.
- [x] `src/index/build/graphs.js` (P2) Prefer canonical `chunkId` keys where possible instead of `file::name` to avoid collisions.
  - [x] (P2) Sort serialized node lists for full determinism (neighbors are already sorted).
- [x] `src/index/build/piece-assembly.js` (P2) Remove redundant filterIndex construction (avoid double work; rely on writeIndexArtifacts).
- [x] `src/index/build/postings.js` (P2) Validate docLengths are finite and consistent; avoid NaN avgDocLen.
  - [x] (P2) Sort Object.entries() iteration for field postings and weights for deterministic output.
- [x] `src/index/build/shards.js` (P2) Document heuristic thresholds (minFilesForSubdir, hugeThreshold, tenth-largest targets).
- [x] `src/index/build/tokenization.js` (P2) Review buffer reuse effectiveness (arrays are still cloned); consider pre-sizing and reducing transient allocations further.
- [x] `tools/assemble-pieces.js` (P2) When `--force` is used, consider cleaning the output dir first to avoid stale artifacts.
- [x] `tools/ci-restore-artifacts.js` (P2) Optionally validate `pieces/manifest.json` checksums after restore (fast fail on corrupt artifacts).
- [x] `tools/compact-pieces.js` (P2) Add perf regression harness and validate output equivalence post-compaction.
- [x] `tests/artifact-bak-recovery.js` (P2) Expand coverage to include: both primary and backup corrupt; json.gz sidecars; and cleanup expectations.
- [x] `tests/artifact-size-guardrails.js` (P2) Extend to cover: chunkMetaFormat=jsonl with switching shard/no-shard, and cleanup behavior.
- [x] `tests/artifacts/token-mode.test.js` (P2) Add coverage for invalid modes, case-insensitive parsing, and maxTokens/maxFiles parsing edge cases.
- [x] `tests/clean-artifacts.js` (P2) Consider adding a check that `.bak` files are handled correctly (optional).
- [x] `tests/file-processor/skip.test.js` (P2) Add coverage for `unreadable` and `read-failure` paths (permissions, ENOENT races).
- [x] `tests/filter-index-artifact.js` (P2) Add a schema assertion for filter_index fields/versioning to prevent drift.
- [x] `tests/filter-index.js` (P2) Consider adding a determinism check for serialized filter index (same inputs => same output).
- [x] `tests/graph-chunk-id.js` (P2) Add a collision regression test for graph keys, or migrate to chunkId-based keys.
- [x] `tests/incremental-tokenization-cache.js` (P2) Add a second invalidation scenario (e.g., tokenization config changes that affect stemming/synonyms).
- [x] `tests/postings-quantize.js` (P2) Extend to test scale and dims, and doc/code embedding behavior.
- [x] `tests/shard-merge.js` (P2) Consider adding checksum and manifest equivalence checks as well.
- [x] `tests/shard-plan.js` (P2) Add stress case coverage (many files, equal weights, perfProfile enabled).
- [x] `tests/tokenization-buffering.js` (P2) Consider adding a non-ASCII tokenization regression case.
- [x] `docs/contracts/coverage-ledger.md` (P2) Add entries for new/critical tooling: `tools/assemble-pieces.js`, `tools/compact-pieces.js`, and CI artifact scripts.

#### src

- [x] Switch job IDs to `crypto.randomUUID()` for collision resistance.
- [x] `src/index/build/context-window.js` Document that context-window estimation is heuristic and may vary with sampling strategy.
`src/index/build/embedding-batch.js`:
  - [x] Parse `baseSize` if it may come from config as a numeric string.
  - [x] Add explicit documentation for multiplier precedence (fallback vs user config).
`src/index/embedding.js`:
  - [x] Centralize `normalizeVec`/`quantizeVec` into shared utilities; remove duplication.
  - [x] Harden `normalizeBatchOutput()` to:
    - guarantee output length equals input count,
    - handle unexpected tensor dims more defensively,
    - avoid returning a single huge vector when output is 3D.
`src/retrieval/embedding.js`:
  - [x] Use a normalized/fingerprinted ONNX config in the embedder cache key (avoid JSON-order sensitivity).
  - [x] If retrieval can request embeddings without known dims (ANN-only paths), require dims or ensure consistent default dims.
  - [x] Log embedder load failures once to aid debugging.
- [x] `src/shared/hnsw.js` Read/validate `dense_vectors_hnsw.meta.json` to confirm `dims/space/model` before using the index.
`src/shared/onnx-embeddings.js`:
  - [x] Improve performance by avoiding heavy array conversions and by reusing buffers/tensors.
  - [x] Concurrency guards around `session.run()` if onnxruntime sessions are not safe concurrently.

---

#### tools

- [x] `tools/build-embeddings/atomic.js` Consolidating atomic replace logic with `src/shared/json-stream.js` to avoid divergence (optional refactor).
`tools/build-embeddings/chunks.js`:
  - [x] Incorporating doc-related signals into the chunk signature (or into identity versioning) so doc embedding caches invalidate when doc extraction logic changes.
  - [x] Normalize `start/end` to finite numbers before signature generation (avoid stringifying `undefined`).
- [x] `tools/build-embeddings/cli.js` Document the behavior where `mode=service` is coerced to `inline` for this tool.
- [x] `tools/build-embeddings/embed.js` Consider failing fast on non-vector outputs instead of silently returning `[]` entries (to avoid quietly producing all-zero embeddings).
`tools/build-embeddings/hnsw.js`:
  - [x] Ensure stable vector insertion order into HNSW (ascending chunkIndex).
  - [x] When adding vectors reconstructed from cache (dequantized), consider re-normalizing for cosine space to reduce drift.
- [x] `tools/build-embeddings/manifest.js`Consider reading HNSW meta to report accurate `count`/`dims` for ANN piece files, rather than relying on `totalChunks` (defensive correctness).
`tools/build-embeddings/run.js`:
  - [x] Use `Number.isFinite()` for chunk start/end to avoid 0/NaN edge cases from `||` coercion.
  - [x] Make HNSW build deterministic (stable insertion order).
  - [x] Adding a global cross-file batcher for throughput.
- [x] `tools/build-embeddings/sqlite-dense.js`Batching inserts in larger chunks or using prepared statements more aggressively for performance on large vector sets.
- [x] `tools/compare-models.js` If comparing ONNX vs xenova providers, ensure the script can capture and report provider config differences (identity) to interpret deltas correctly (minor enhancement).
`tools/download-models.js`:
  - [x] Support explicit download of ONNX model artifacts when users rely on `indexing.embeddings.provider=onnx` and custom `onnx.modelPath`.
  - [x] Improve output to show where models were cached and what to set in config if needed.

---

#### tests

- [x] `tests/build-embeddings-cache.js` Extend to assert cache identity changes for ONNX config changes (once identity schema is expanded).
- [x] `tests/embedding-batch-autotune.js` Loosen or documenting assumptions about minimum batch size on low-memory systems (or adjust runtime min to match test expectations).
- [x] `tests/embeddings-cache-identity.js` Extend to cover ONNX-specific identity fields (tokenizerId/modelPath/etc).
- [x] `tests/embeddings-cache-invalidation.js` Add invalidation scenarios tied to preprocessing knobs (pooling/normalize/max_length) once surfaced in identity.
- [x] `tests/embeddings-sqlite-dense.js` Add coverage for vector extension load failure paths (extension missing), not only baseline dense sqlite insertions.
- [x] `tests/hnsw-ann.js` Add correctness assertions beyond “backend selected”:
  - candidate set filterig (once exposed),
  - tie-break determinism,
  - sanity check of returned ordering for a known query on fixture corpus.
- [x] `tests/hnsw-atomic.js` Add test for `.bak` fallback on corrupt primary index/meta (reader-side).
- [x] `tests/smoke-embeddings.js` new tests to this suite after implementing performance regression and fallback tests.
- [x] `tests/sqlite-vec-candidate-set.js` Add a column-name sanitization test (table is covered; column is not).
