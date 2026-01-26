## Phase 7 — Embeddings + ANN: Determinism, Policy, and Backend Parity

### Objective

Make embeddings generation and ANN retrieval **deterministic, build-scoped, and policy-driven** across all supported backends (HNSW, LanceDB, and SQLite dense). This phase hardens the end-to-end lifecycle:

- Embeddings are **optional**, but when enabled they are **contracted**, discoverable, and validated.
- Embeddings jobs are **bound to a specific build output** (no implicit “current build” writes).
- Quantization/normalization rules are **consistent** across tools, caches, and query-time ANN.
- ANN backends behave predictably under real-world constraints (candidate filtering, partial failure, missing deps).

### Exit Criteria

- Embeddings can be **disabled** without breaking builds, validation, or CI.
- When embeddings are enabled, artifacts are **consistent, validated, and build-scoped** (no cross-build contamination).
- HNSW and LanceDB ANN results are **stable and correctly ranked**, with clear selection/availability signaling.
- CI can run without optional native deps (e.g., LanceDB) using an explicit **skip protocol**, while still providing meaningful ANN coverage where possible.

---

### Phase 7.1 — Build-scoped embeddings jobs and best-effort enqueue semantics

- [ ] **Bind embeddings jobs to an explicit build output target (no “current build” inference).**
  - [ ] Extend the embedding job payload to include an immutable provenance tuple and target paths:
    - [ ] `buildId` and `buildRoot` (or an explicit `indexRoot`) for the build being augmented.
    - [ ] `mode` (`code` / `prose`) and the exact `indexDir` (the per-mode output directory) the job must write into.
    - [ ] `configHash` (or equivalent) used to build the base index.
    - [ ] `repoProvenance` snapshot (at minimum: repo path + commit/branch if available).
    - [ ] `embeddingIdentity` + `embeddingIdentityKey` (already present in queue schema; ensure always populated).
    - [ ] A monotonically increasing `embeddingPayloadFormatVersion` that gates behavior.
  - [ ] Update `src/index/build/indexer/pipeline.js` to pass build-scoped paths into `enqueueEmbeddingJob(...)`.
  - [ ] Update `src/index/build/indexer/embedding-queue.js` to accept and forward these fields.
  - Touchpoints:
    - `src/index/build/indexer/pipeline.js`
    - `src/index/build/indexer/embedding-queue.js`
    - `tools/service/queue.js`

- [ ] **Make embedding job enqueue best-effort when embeddings are configured as a service.**
  - [ ] Wrap queue-dir creation and `enqueueJob(...)` in a non-fatal path when `runtime.embeddingService === true`.
    - If enqueue fails, log a clear warning and continue indexing.
    - Ensure indexing does **not** fail due solely to queue I/O failures.
  - [ ] Record “embeddings pending/unavailable” state in `index_state.json` when enqueue fails.
  - Touchpoints:
    - `src/index/build/indexer/embedding-queue.js`
    - `src/index/build/indexer/steps/write.js` (state recording)

- [ ] **Ensure the embeddings worker/runner honors build scoping.**
  - [ ] Update the embeddings job runner (currently `tools/indexer-service.js`) so `build-embeddings` is executed with an explicit `--index-root` (or equivalent) derived from the job payload.
  - [ ] Add defensive checks: if job payload references a missing buildRoot/indexDir, the job must fail without writing output.
  - [ ] Add backwards compatibility behavior for old jobs:
    - If `embeddingPayloadFormatVersion` is missing/old, either refuse the job with a clear error **or** run in legacy mode but emit a warning.
  - Touchpoints:
    - `tools/indexer-service.js`
    - `tools/build-embeddings/cli.js` (ensuring `--index-root` is usable everywhere)

#### Tests / Verification

- [ ] Add `tests/embeddings/job-payload-includes-buildroot.test.js`
  - Verify queue job JSON includes `buildId`, `buildRoot`/`indexRoot`, `indexDir`, `configHash`, and embedding identity fields.
- [ ] Add `tests/embeddings/optional-no-service.test.js`
  - Simulate missing/unwritable queue dir and assert indexing still succeeds with embeddings marked pending/unavailable.
- [ ] Add `tests/embeddings/worker-refuses-mismatched-buildroot.test.js`
  - Provide a job with an invalid/nonexistent target path and assert the runner fails without producing/altering embeddings artifacts.

---

### Phase 7.2 — Embeddings artifact contract and explicit capability signaling

- [ ] **Define the canonical “embeddings artifacts” contract and make it discoverable.**
  - [ ] Treat the existing dense-vector outputs as the formal embeddings artifact surface:
    - `dense_vectors_uint8.json` (+ any per-mode variants)
    - `dense_vectors_hnsw.bin` + `dense_vectors_hnsw.meta.json`
    - `dense_vectors_lancedb/` + `dense_vectors_lancedb.meta.json`
    - Optional SQLite dense tables when enabled (`dense_vectors`, `dense_meta`, and ANN table)
  - [ ] Ensure embeddings artifacts are present in `pieces/manifest.json` when available and absent when not.
  - Touchpoints:
    - `tools/build-embeddings/manifest.js`
    - `src/index/build/artifacts.js` (piece emission rules)

- [ ] **Emit embedding identity and quantization policy into state and metadata, regardless of build path.**
  - [ ] Ensure `index_state.json.embeddings` always includes:
    - `enabled`, `ready/present`, `mode` (inline/service), and a clear `reason` when not ready.
    - `embeddingIdentity` and `embeddingIdentityKey`.
    - Backend availability summary for this build (HNSW/LanceDB/SQLite dense), including dims + metric/space where applicable.
  - [ ] Align `src/index/build/indexer/steps/write.js` with `tools/build-embeddings/run.js` so inline embeddings builds also include identity/key.
  - Touchpoints:
    - `src/index/build/indexer/steps/write.js`
    - `tools/build-embeddings/run.js`

- [ ] **Harden validation for embeddings presence and consistency.**
  - [ ] Extend strict validation to enforce, when embeddings are present:
    - Dense vector count matches chunk count for the mode.
    - Dimensions match across dense vectors and any ANN index metadata.
    - Model/identity metadata is internally consistent (identity key stable for that build).
  - [ ] When embeddings are absent, validation should still pass but surface a clear “embeddings not present” indicator.
  - Touchpoints:
    - `src/index/validate.js`

- [ ] **Add missing-embeddings reporting (and optional gating).**
  - [ ] Track missing vectors during embedding build (code/doc/merged) instead of silently treating them as equivalent to an all-zero vector.
    - Preserve existing “fill missing with zeros” behavior only as an internal representation, but record missing counts explicitly.
  - [ ] Add configurable thresholds (e.g., maximum allowed missing rate) that can mark embeddings as failed/unusable for ANN.
    - If threshold exceeded: do not publish ANN index availability and record reason in state.
  - Touchpoints:
    - `tools/build-embeddings/embed.js`
    - `tools/build-embeddings/run.js`
    - `src/index/build/indexer/file-processor/embeddings.js` (if inline embeddings path participates)

#### Tests / Verification

- [ ] Add `tests/validate/embeddings-referential-integrity.test.js`
  - Corrupt dense vector count or dims and assert strict validation fails with a clear error.
- [ ] Add `tests/validate/embeddings-optional-absence.test.js`
  - Validate an index without embeddings artifacts and assert validation passes with a “not present” signal.
- [ ] Add `tests/embeddings/missing-rate-gating.test.js`
  - Force a controlled missing-vector rate and assert state/reporting reflects the gating outcome.

---

### Phase 7.3 — Quantization invariants (levels clamp, safe dequantization, no uint8 wrap)

- [ ] **Enforce `levels ∈ [2, 256]` everywhere for uint8 embeddings.**
  - [ ] Clamp in quantization parameter resolution:
    - Update `src/storage/sqlite/vector.js: resolveQuantizationParams()` to clamp levels into `[2, 256]`.
    - Emit a warning when user config requests `levels > 256` (explicitly noting coercion).
  - [ ] Clamp at the quantizer:
    - Update `src/shared/embedding-utils.js: quantizeEmbeddingVector()` to mirror clamping (or route callers to `quantizeEmbeddingVectorUint8`).
    - Ensure no code path can produce values outside `[0, 255]` for “uint8” vectors.
  - [ ] Fix call sites that currently risk wrap:
    - `src/index/embedding.js` (`quantizeVec`) and its downstream usage in incremental updates.
    - `src/storage/sqlite/build/incremental-update.js` packing paths.
  - Touchpoints:
    - `src/shared/embedding-utils.js`
    - `src/storage/sqlite/vector.js`
    - `src/index/embedding.js`
    - `src/storage/sqlite/build/incremental-update.js`

- [ ] **Fix dequantization safety and parameter propagation.**
  - [ ] Update `dequantizeUint8ToFloat32(...)` to avoid division-by-zero when `levels <= 1` and to use clamped params.
  - [ ] Thread quantization params into LanceDB writer:
    - Update `tools/build-embeddings/lancedb.js: writeLanceDbIndex({ ..., quantization })`.
    - Call `dequantizeUint8ToFloat32(vec, minVal, maxVal, levels)` (no defaults).
  - Touchpoints:
    - `src/storage/sqlite/vector.js`
    - `tools/build-embeddings/lancedb.js`

- [ ] **Regression protection for embedding vector merges.**
  - [ ] Ensure `mergeEmbeddingVectors(code, doc)` does not incorrectly dampen single-source vectors.
    - If this is already fixed earlier, add/keep a regression test here (this phase modifies embedding utilities heavily).
  - Touchpoints:
    - `src/shared/embedding-utils.js`

- [ ] **Decide and document endianness portability for packed integer buffers.**
  - Current pack/unpack helpers rely on platform endianness.
  - [ ] Either:
    - Implement fixed-endian encoding/decoding with backward compatibility, **or**
    - Explicitly record endianness in metadata and defer full portability to a named follow-on phase.
  - Deferred (if not fully addressed here): **Phase 11 — Index Portability & Migration Tooling**.

#### Tests / Verification

- [ ] Add `tests/unit/quantization-levels-clamp.test.js`
  - Pass `levels: 512` and assert it clamps to `256` (and logs a warning).
- [ ] Add `tests/unit/dequantize-levels-safe.test.js`
  - Call dequantization with `levels: 1` and assert no crash and sane output.
- [ ] Add `tests/regression/incremental-update-quantize-no-wrap.test.js`
  - Ensure packed uint8 values never wrap for large `levels` inputs.
- [ ] Extend `tests/lancedb-ann.js` to run with non-default quantization params and verify ANN still functions.

---

### Phase 7.4 — Normalization policy consistency across build paths and query-time ANN

- [ ] **Centralize normalization policy and apply it everywhere vectors enter ANN.**
  - [ ] Create a shared helper that defines normalization expectations for embeddings (index-time and query-time).
    - Prefer deriving this from `embeddingIdentity.normalize` to ensure build outputs and query behavior remain compatible.
  - [ ] Apply consistently:
    - Fresh build path (`tools/build-embeddings/embed.js`).
    - Cached build path (`tools/build-embeddings/run.js`).
    - Query-time ANN (HNSW provider via `src/shared/hnsw.js` and/or the embedder).
  - Touchpoints:
    - `src/shared/embedding-utils.js` (or a new shared policy module)
    - `tools/build-embeddings/embed.js`
    - `tools/build-embeddings/run.js`
    - `src/shared/hnsw.js`

- [ ] **Normalize persisted per-component vectors when they are intended for retrieval.**
  - [ ] Ensure `embed_code_u8` and `embed_doc_u8` are quantized from normalized vectors (or explicitly mark them as non-retrieval/debug-only and keep them out of ANN pathways).
  - Touchpoints:
    - `tools/build-embeddings/embed.js`

#### Tests / Verification

- [ ] Add `tests/unit/normalization-policy-consistency.test.js`
  - Assert fresh vs cached paths produce equivalent normalized vectors for the same input.
- [ ] Add `tests/integration/hnsw-rebuild-idempotent.test.js`
  - Build embeddings twice (cache hit vs miss) and assert stable ANN outputs for a fixed query set.

---

### Phase 7.5 — LanceDB ANN correctness and resilience

- [ ] **Promise-cache LanceDB connections and tables to prevent redundant concurrent opens.**
  - [ ] Change `src/retrieval/lancedb.js` connection/table caching to store promises, not only resolved objects.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Fix candidate-set filtering under-return so `topN` is honored.**
  - [ ] When candidate filtering cannot be pushed down (or is chunked), ensure the query strategy returns at least `topN` results after filtering (unless the candidate set is smaller).
    - Options include iterative limit growth, chunked `IN (...)` pushdown + merge, or multi-pass querying.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Harden `idColumn` handling and query safety.**
  - [ ] Quote/escape `idColumn` (and any identifiers) rather than interpolating raw strings into filters.
  - [ ] Ensure candidate IDs are handled safely for numeric and string identifiers.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Replace global `warnOnce` suppression with structured/rate-limited warnings.**
  - Avoid hiding repeated failures after the first warning.
  - Touchpoints:
    - `src/retrieval/lancedb.js`

- [ ] **Keep quantization parameters consistent (writer + retrieval expectations).**
  - This is primarily implemented via Phase 7.3, but ensure LanceDB metadata emitted from the writer is sufficient for later verification.
  - Touchpoints:
    - `tools/build-embeddings/lancedb.js`
    - `src/retrieval/cli/load-indexes.js` (metadata loading expectations)

#### Tests / Verification

- [ ] Update `tests/lancedb-ann.js`:
  - [ ] Pass `--ann-backend lancedb` explicitly.
  - [ ] Use skip exit code 77 when LanceDB dependency is missing.
  - [ ] Add a candidate-set test that exercises the “pushdown disabled” path and asserts `topN` is still achieved.
- [ ] Add a focused unit test (or harness test) that ensures concurrent queries do not open multiple LanceDB connections.

---

### Phase 7.6 — HNSW ANN correctness, compatibility, and failure observability

- [ ] **Make HNSW index loading compatible with pinned `hnswlib-node` signatures.**
  - [ ] Update `src/shared/hnsw.js: loadHnswIndex()` to call `readIndexSync` with the correct signature.
    - If the signature differs across versions, detect via function arity and/or guarded calls.
  - Touchpoints:
    - `src/shared/hnsw.js`

- [ ] **Verify and correct similarity mapping for `ip` and `cosine` spaces.**
  - [ ] Add a small correctness harness that confirms returned distances map to expected similarity ordering.
  - Touchpoints:
    - `src/shared/hnsw.js`

- [ ] **Improve insertion failure observability while preserving safe build semantics.**
  - [ ] Keep all-or-nothing index generation as the default policy.
  - [ ] In `tools/build-embeddings/hnsw.js`:
    - Capture insertion failures with `{ chunkIndex, errorMessage }`.
    - Throw an error that includes a concise failure summary (capped list + counts).
    - Optionally emit `dense_vectors_hnsw.failures.json` next to the index for debugging.
  - Touchpoints:
    - `tools/build-embeddings/hnsw.js`

- [ ] **Preserve atomicity for index + metadata publication.**
  - Ensure meta updates remain consistent with `.bin` publication; avoid partially updated states.

#### Tests / Verification

- [ ] Add `tests/hnsw-insertion-failures-report.test.js`
  - Force deterministic insertion failures and assert:
    - Failures are reported.
    - The index is not marked available.
    - Atomic write behavior is preserved.
- [ ] Add `tests/hnsw-ip-similarity.test.js`
  - Verify similarity ranking is correct for known vectors under `ip`.
- [ ] Ensure existing `tests/hnsw-atomic.js` and `tests/hnsw-ann.js` remain stable after signature/policy updates.

---

### Phase 7.7 — ANN backend policy and parity (selection, availability, explicit tests)

- [ ] **Provide an explicit policy contract for ANN backend selection.**
  - [ ] Confirm or introduce a single canonical config/CLI surface (e.g., `--ann-backend` and `retrieval.annBackend` or `retrieval.vectorBackend`).
  - [ ] Ensure `auto` selection is deterministic and based on:
    - Backend availability for the mode (artifacts present + loadable).
    - Compatibility with the embedding identity (dims, normalize policy, metric/space).
  - Touchpoints:
    - Retrieval CLI option normalization (`src/retrieval/cli/normalize-options.js`)
    - ANN provider selection (`src/retrieval/ann/index.js` and providers)

- [ ] **Record backend availability and the selected backend in observable state.**
  - [ ] Ensure `index_state.json` captures availability for HNSW/LanceDB/SQLite dense per mode.
  - [ ] Ensure query stats include the selected backend (already present as `annBackend` in several paths; make it consistent).

- [ ] **Make tests explicit about backend choice.**
  - [ ] Update `tests/lancedb-ann.js` (see Phase 7.5).
  - [ ] Ensure any other ANN tests pass an explicit backend flag to prevent policy drift from breaking intent.

#### Tests / Verification

- [ ] Add `tests/ann-backend-selection-fallback.test.js`
  - Validate `auto` chooses the expected backend when one is missing/unavailable.
- [ ] Add `tests/ann-backend-selection-explicit.test.js`
  - Validate explicit selection fails clearly (or falls back if policy allows) when requested backend is unavailable.

---

### Phase 7.8 — Backend storage resilience required by embeddings/ANN workflows

- [ ] **LMDB map size planning for predictable index builds.**
  - [ ] Add config support and defaults:
    - `indexing.lmdb.mapSizeBytes` with a sane default and override.
  - [ ] Estimate required map size from corpus characteristics (with headroom), and log the chosen size + inputs.
  - [ ] Pass `mapSize` to LMDB `open()` in `tools/build-lmdb-index.js`.
  - Touchpoints:
    - `tools/build-lmdb-index.js`

- [ ] **SQLite dense writer safety: avoid cross-mode ANN table deletion when DBs are shared.**
  - [ ] Confirm whether SQLite dense DBs are per-mode (separate DB files) in all supported configurations.
  - [ ] If shared DBs are possible, ensure ANN table deletes are mode-scoped:
    - Either add a mode discriminator column and filter deletes, or use mode-specific ANN table names.
  - Touchpoints:
    - `tools/build-embeddings/sqlite-dense.js`

- [ ] **Avoid O(N) cache scans during embeddings preflight.**
  - [ ] Replace full-directory scans in `tools/build-embeddings/run.js` with a lightweight cache metadata file (e.g., `cache/index.json`) that records:
    - dims, identity keys, and a small index of available cached chunks.
  - [ ] Keep backward compatibility by falling back to scan only when metadata is missing.
  - Touchpoints:
    - `tools/build-embeddings/run.js`
    - `tools/build-embeddings/cache.js`

#### Tests / Verification

- [ ] Add `tests/lmdb-map-size-planning.test.js`
  - Build an LMDB index of moderate size and verify it does not fail due to map size.
- [ ] Add `tests/sqlite-dense-cross-mode-safety.test.js`
  - Build both modes and rebuild one mode; verify the other mode’s ANN data remains intact.
- [ ] Add `tests/embeddings/cache-preflight-metadata.test.js`
  - Ensure preflight uses metadata without scanning when the meta file exists, and remains correct.
- [ ] Unskip phase-tagged LMDB tests once Phase 7/8 deliverables land:
  - Remove `DelayedUntilPhase7_8` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lmdb-backend`, `lmdb-corruption`, `lmdb-report-artifacts`.

---

---

## Added detail (Phase 7 task mapping)

### 7.1 Build-scoped embeddings jobs + best-effort enqueue
- Task: Bind embedding jobs to explicit build output target
  - Files to change/create:
    - src/index/build/indexer/pipeline.js (enqueueEmbeddingJob call at ~323 already passes indexRoot; extend with configHash/repoProvenance)
    - src/index/build/indexer/embedding-queue.js (payload fields at ~8-33)
    - tools/service/queue.js (job schema validation if any)
  - Call sites/line refs:
    - src/index/build/indexer/pipeline.js:323
    - src/index/build/indexer/embedding-queue.js:8-33
  - Gaps/conflicts:
    - embedding job payload currently lacks configHash/repo provenance; Phase 7 requires it for determinism.
- Task: Best-effort enqueue when embeddingService is enabled
  - Files to change/create:
    - src/index/build/indexer/embedding-queue.js (wrap ensureQueueDir/enqueueJob, set pending state on failure)
    - src/index/build/indexer/steps/write.js (index_state.embeddings fields at ~52-98)
  - Call sites/line refs:
    - src/index/build/indexer/embedding-queue.js:8-46
    - src/index/build/indexer/steps/write.js:52-98
- Task: Worker honors build scoping
  - Files to change/create:
    - tools/indexer-service.js (runBuildEmbeddings uses --repo only at ~260-284; add --index-root/indexDir)
    - tools/build-embeddings/cli.js + tools/build-embeddings/args.js (ensure --index-root is parsed)
  - Call sites/line refs:
    - tools/indexer-service.js:260-284
    - tools/build-embeddings/cli.js (args wiring)

### 7.2 Embeddings artifact contract + capability signaling
- Task: Manifest + artifact discovery
  - Files to change/create:
    - tools/build-embeddings/manifest.js (embeddingPieces list at ~52-70; currently filtered by ARTIFACT_SCHEMA_DEFS)
    - src/index/build/artifacts.js (dense_vectors pieces at ~255-300)
  - Call sites/line refs:
    - tools/build-embeddings/manifest.js:52-90
    - src/index/build/artifacts.js:255-300
  - Gaps/conflicts:
    - tools/build-embeddings/manifest.js drops entries whose name is not in ARTIFACT_SCHEMA_DEFS, so dense_vectors_hnsw.bin and lancedb dirs are silently omitted; reconcile with “discoverable” requirement.
- Task: Emit embedding identity + backend availability in index_state
  - Files to change/create:
    - src/index/build/indexer/steps/write.js (index_state.embeddings at ~52-90)
    - tools/build-embeddings/runner.js (index_state updates at ~175-191 and ~692-704)
    - src/retrieval/cli-index.js (embeddingsState read at ~101-107)
  - Call sites/line refs:
    - src/index/build/indexer/steps/write.js:52-90
    - tools/build-embeddings/runner.js:175-191, 692-704
    - src/retrieval/cli-index.js:101-107
- Task: Harden validation for embeddings presence/consistency
  - Files to change/create:
    - src/index/validate.js (dense vector validation at ~413-491)
  - Call sites/line refs:
    - src/index/validate.js:413-491
- Task: Missing-vector reporting + gating
  - Files to change/create:
    - tools/build-embeddings/embed.js (fillMissingVectors at ~120-150; add missing counters)
    - tools/build-embeddings/runner.js (propagate missing stats into index_state)
    - src/index/build/file-processor/embeddings.js (inline embeddings path)
  - Call sites/line refs:
    - tools/build-embeddings/embed.js:108-145

### 7.3 Quantization invariants
- Task: Clamp levels to [2,256] everywhere
  - Files to change/create:
    - src/storage/sqlite/vector.js (resolveQuantizationParams at ~10-20)
    - src/shared/embedding-utils.js (quantizeEmbeddingVector at ~56-74)
    - src/index/embedding.js (quantizeVec export at ~8-12)
    - src/storage/sqlite/build/incremental-update.js (quantize/pack paths at ~15-40)
  - Call sites/line refs:
    - src/storage/sqlite/vector.js:10-20
    - src/shared/embedding-utils.js:56-86
    - src/index/embedding.js:8-12
    - src/storage/sqlite/build/incremental-update.js:15-40
- Task: Safe dequantization + param propagation
  - Files to change/create:
    - src/storage/sqlite/vector.js (dequantizeUint8ToFloat32 at ~22-40)
    - tools/build-embeddings/lancedb.js (buildBatch uses dequantize with defaults at ~28-45)
  - Call sites/line refs:
    - src/storage/sqlite/vector.js:22-40
    - tools/build-embeddings/lancedb.js:28-45
- Task: MergeEmbeddingVectors regression guard
  - Files to change/create:
    - src/shared/embedding-utils.js (mergeEmbeddingVectors at ~6-32)

### 7.4 Normalization policy consistency
- Task: Centralize normalization policy
  - Files to change/create:
    - src/shared/embedding-utils.js (normalizeEmbeddingVector* at ~36-55) or new policy module
    - tools/build-embeddings/embed.js (normalizeEmbeddingVector call at ~4-10, ~108-121)
    - src/index/build/file-processor/embeddings.js (normalizeVec calls at ~238-240)
    - src/retrieval/embedding.js (query-time embeddings)
  - Call sites/line refs:
    - tools/build-embeddings/embed.js:1-15, 108-121
    - src/index/build/file-processor/embeddings.js:238-240

### 7.5 LanceDB ANN correctness
- Task: Promise-cache connections + candidate filtering
  - Files to change/create:
    - src/retrieval/lancedb.js (connection caching and candidate filtering paths)
  - Call sites/line refs:
    - src/retrieval/lancedb.js (connection map + rankLanceDb usage)
- Task: idColumn handling + warning policy
  - Files to change/create:
    - src/retrieval/lancedb.js (filter construction and warnOnce)
  - Gaps/conflicts:
    - tools/build-embeddings/lancedb.js meta lacks quantization params; add for later verification.

### 7.6 HNSW ANN correctness
- Task: Load signature compatibility + similarity mapping
  - Files to change/create:
    - src/shared/hnsw.js (loadHnswIndex + rankHnswIndex at ~40-120)
  - Call sites/line refs:
    - src/shared/hnsw.js:40-120
- Task: Insertion failure observability
  - Files to change/create:
    - tools/build-embeddings/hnsw.js (writeIndex at ~52-110)
  - Call sites/line refs:
    - tools/build-embeddings/hnsw.js:52-110

### 7.7 ANN backend policy + parity
- Task: Canonical ann-backend selection
  - Files to change/create:
    - src/retrieval/cli/normalize-options.js (backend choice)
    - src/retrieval/ann/index.js (provider selection)
    - src/retrieval/ann/providers/*.js (availability rules)
  - Call sites/line refs:
    - src/retrieval/ann/providers/hnsw.js:9-22
    - src/retrieval/ann/providers/lancedb.js:9-27
    - src/retrieval/ann/providers/sqlite-vec.js:8-23
- Task: Record backend availability in state
  - Files to change/create:
    - src/index/build/indexer/steps/write.js (index_state.features detail)
    - src/retrieval/cli/run-search-session.js (annBackendUsed at ~483-487)
  - Call sites/line refs:
    - src/retrieval/cli/run-search-session.js:483-487

### 7.8 Backend storage resilience
- Task: LMDB map size planning
  - Files to change/create:
    - tools/build-lmdb-index.js (lmdb open config; currently no map size config)
  - Call sites/line refs:
    - tools/build-lmdb-index.js:1-90 (open import and options)
- Task: SQLite dense cross-mode safety
  - Files to change/create:
    - tools/build-embeddings/sqlite-dense.js (deleteDense/deleteAnn at ~130-150; uses global table name)
  - Call sites/line refs:
    - tools/build-embeddings/sqlite-dense.js:118-150
- Task: Embedding cache preflight metadata
  - Files to change/create:
    - tools/build-embeddings/run.js (preflight; see runner invocation)
    - tools/build-embeddings/cache.js (cache scan logic)
  - Gaps/conflicts:
    - Current run.js is minimal; cache scanning appears in runner.js; add metadata file to avoid full directory scan.

## Phase 7 addendum: dependencies, ordering, artifacts, tests, edge cases

### 7.1 Dependencies and order of operations
- Dependencies:
  - Build-scoped job payload schema must land before worker changes.
  - Queue enqueue changes must land before state recording.
- Order of operations:
  1) Extend payload schema (buildId/buildRoot/indexDir/configHash).
  2) Update enqueue call sites to populate payload.
  3) Update worker to enforce buildRoot and reject mismatches.
  4) Update index_state embeddings.pending/ready logic.
  5) Add tests for payload and failure modes.

### 7.1 Acceptance criteria + tests (lane)
- tests/embeddings/job-payload-includes-buildroot.test.js (test:integration)
- tests/embeddings/optional-no-service.test.js (test:integration)
- tests/embeddings/worker-refuses-mismatched-buildroot.test.js (test:integration)

### 7.1 Edge cases and fallback behavior
- Unwritable queue dir in service mode: log warning, set embeddings.pending=true, continue build.
- Missing buildRoot/indexDir in job: refuse job, do not write artifacts.

### 7.2 Artifact row fields (embeddings artifacts)
- dense_vectors_uint8.json (and dense_vectors_doc_uint8.json, dense_vectors_code_uint8.json):
  - required keys: dims, vectors
  - optional keys: model, scale
  - vectors: array of uint8 arrays, length == chunk count for the mode
  - caps: dims >= 1; each vector length == dims; values in [0,255]
- dense_vectors_hnsw.meta.json:
  - required keys: dims, count, space, m, efConstruction, efSearch
  - optional keys: version, generatedAt, model
  - caps: count <= vectors length; dims >= 1
- dense_vectors_lancedb.meta.json:
  - required keys: dims, count, metric, table, embeddingColumn, idColumn
  - optional keys: version, generatedAt, model
  - caps: count <= vectors length; dims >= 1
- pieces/manifest.json entries (for each embedding artifact):
  - required keys: type="embeddings", name, format, path
  - recommended keys: count, dims, checksum, bytes

### 7.2 Dependencies and order of operations
- Dependencies:
  - 7.1 payload scoping before artifact publication in service mode.
  - Validation rules must align with manifest entries.
- Order of operations:
  1) Define artifact contract + manifest entries.
  2) Emit index_state.embeddings capability summary.
  3) Harden validator for counts/dims.
  4) Add missing-vectors reporting + gating.

### 7.2 Acceptance criteria + tests (lane)
- tests/validate/embeddings-referential-integrity.test.js (test:services)
- tests/validate/embeddings-optional-absence.test.js (test:services)
- tests/embeddings/missing-rate-gating.test.js (test:integration)

### 7.2 Edge cases and fallback behavior
- Embeddings absent: validation passes, index_state.embeddings.ready=false with reason.
- Dims mismatch: validation fails in strict mode; non-strict logs warning.

### 7.3 Dependencies and order of operations
- Dependencies:
  - Quantization utils updated before any backend writes (HNSW/LanceDB).
- Order of operations:
  1) Clamp levels in config resolution.
  2) Clamp levels at quantizer/dequantizer.
  3) Thread quantization params through writers.

### 7.3 Acceptance criteria + tests (lane)
- tests/unit/quantization-levels-clamp.test.js (test:unit)
- tests/unit/dequantize-levels-safe.test.js (test:unit)
- tests/regression/incremental-update-quantize-no-wrap.test.js (test:integration)

### 7.3 Edge cases and fallback behavior
- levels <= 1: dequantize safely (no divide by zero) and clamp to 2.
- levels > 256: clamp to 256 with warning.

### 7.4 Dependencies and order of operations
- Dependencies:
  - Normalization policy must be defined before ANN query-time use.
- Order of operations:
  1) Centralize normalization policy.
  2) Apply to build-time embedding vectors.
  3) Apply to query-time embedding vectors.

### 7.4 Acceptance criteria + tests (lane)
- tests/unit/normalization-policy-consistency.test.js (test:unit)
- tests/integration/hnsw-rebuild-idempotent.test.js (test:integration)

### 7.4 Edge cases and fallback behavior
- Policy mismatch detected between build/query: mark ANN unavailable and fall back to lexical search.

### 7.5 Dependencies and order of operations
- Dependencies:
  - 7.3 quantization invariants and 7.4 normalization before LanceDB query fixes.
- Order of operations:
  1) Promise-cache LanceDB connections.
  2) Fix candidate filtering to honor topN.
  3) Escape identifiers and sanitize filters.
  4) Replace warnOnce suppression with rate-limited warnings.

### 7.5 Acceptance criteria + tests (lane)
- tests/lancedb-ann.js (test:services, skip 77 if missing deps)
- tests/unit/lancedb-connection-caching.test.js (test:unit)

### 7.5 Edge cases and fallback behavior
- LanceDB missing: skip backend, mark availability false, continue with other backends.
- Candidate set too small: return fewer results, log cap hit; never crash.

### 7.6 Dependencies and order of operations
- Dependencies:
  - 7.3 quantization invariants before HNSW build.
- Order of operations:
  1) Fix load signature.
  2) Verify similarity mapping (ip/cosine).
  3) Capture insertion failures with summary.

### 7.6 Acceptance criteria + tests (lane)
- tests/unit/hnsw-signature-compat.test.js (test:unit)
- tests/unit/hnsw-similarity-mapping.test.js (test:unit)
- tests/integration/hnsw-insert-failure-reporting.test.js (test:integration)

### 7.6 Edge cases and fallback behavior
- Insert failure: fail build with error summary; do not write partial index.
- Missing HNSW index: mark availability false; fall back to other backends.

### 7.7 Dependencies and order of operations
- Dependencies:
  - 7.5 and 7.6 must land before backend selection parity.
- Order of operations:
  1) Enumerate backend availability in index_state.
  2) Apply selection policy (config + availability).
  3) Add explicit backend tests with skip semantics.

### 7.7 Acceptance criteria + tests (lane)
- tests/services/ann-backend-selection.test.js (test:services)
- tests/services/ann-backend-availability-reporting.test.js (test:services)

### 7.7 Edge cases and fallback behavior
- Preferred backend unavailable: select next available backend; record reason in state.

### 7.8 Dependencies and order of operations
- Dependencies:
  - Storage backend guardrails must land before embeddings/ANN rely on them.
- Order of operations:
  1) Harden storage open/create paths.
  2) Add explicit error reporting (no silent partial writes).
  3) Add resilience tests.

### 7.8 Acceptance criteria + tests (lane)
- tests/storage/embeddings-backend-resilience.test.js (test:storage)

### 7.8 Edge cases and fallback behavior
- Partial storage failure: mark embeddings unavailable, do not expose ANN indexes.

## Fixtures list (Phase 7)

- tests/fixtures/embeddings/basic-repo
- tests/fixtures/embeddings/missing-vectors
- tests/fixtures/embeddings/quantization-caps

## Compat/migration checklist (Phase 7)

- Keep existing dense_vectors_* filenames; do not rename artifacts.
- Accept legacy embedding jobs with a warning or explicit refusal (no silent mutation).
- Preserve current zero-fill behavior for missing vectors but record missing counts/gating.
- Keep ANN backends optional; missing deps must skip, not fail builds.

## Artifacts contract appendix (Phase 7)

- dense_vectors_uint8.json (and dense_vectors_doc_uint8.json, dense_vectors_code_uint8.json)
  - required keys: dims, vectors
  - optional keys: model, scale
  - caps: dims >= 1; vectors length == chunk count; values in [0,255]
- dense_vectors_hnsw.meta.json
  - required keys: dims, count, space, m, efConstruction, efSearch
  - optional keys: version, generatedAt, model
- dense_vectors_lancedb.meta.json
  - required keys: dims, count, metric, table, embeddingColumn, idColumn
  - optional keys: version, generatedAt, model
- pieces/manifest.json entries for embeddings
  - required keys: type="embeddings", name, format, path
  - recommended keys: count, dims, checksum, bytes
