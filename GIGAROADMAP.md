# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

## Roadmap List
### Foundational
- Phase R -- Make Monoliths Modular, My Man
- Phase 6 -- Finalization of Past Work
- Phase 7 -- Embeddings + ANN: Determinism, Policy, and Backend Parity
    - 7.1 - Build-scoped embeddings jobs and Best-Effort Enqueue Semantics
    - 7.2 - Embeddings Artifact Contract and Explicit Capability Signaling
    - 7.3 - Quantization Invariants
    - 7.4 - Normalization Policy Consistency Across Build Paths and Query-Time ANN
    - 7.5 - LanceDB ANN correctness and resilience
    - 7.6 - HNSW ANN correctness, compatibility, and failure observability
    - 7.7 - ANN Backend Policy and Parity 
    - 7.8 - Backend Storage Resilience Required by Embeddings/ANN Workflows
- Phase 9 -- Symbol Identity + Cross-File Linking
    - 9.1 - Verify Identity Primitives 
    - 9.2 - Symbol Identity 
        - 9.2.1 Implement Symbol Identity Helpers
        - 9.2.2 Attach `metaV2.symbol`
    - 9.3 - Import Bindings + resolver
        - 9.3.1 Emit `importBindings` in `file_relations`
        - 9.3.2 Relative Import Resolver Helper
        - 9.3.3 SymbolRef Resolver
        - 9.3.4 Tests
    - 9.4 - Cross-file Linking Pipeline 
        - 9.4.1 Replace `file::name` Join Logic with SymbolRef resolution
        - 9.4.2 Emit new-format `callLinks` and `usageLinks`
        - 9.4.3 Keep `callSummaries`, but add resolved IDs where possible
        - 9.4.4 Tooling Provider Audit
        - 9.4.5 Pipeline Tests
    - 9.5 - Symbol Graph Artifacts
        - 9.5.1 Writers
        - 9.5.2 Artifact Integration
    - 9.6 - Graph Building
        - 9.6.1 Update Graph Builder to ingest SymbolRef links
        - 9.6.2 Version Bump
    - 9.7 - Map Build (stop using `file::name` as member identity)
        - 9.7.1 Member ID Strategy
        - 9.7.2 Backward Compatibility
    - 9.8 - Determinism + throughput
        - 9.8.2 Throughput Checks
- Phase 10 -- Interprocedural Risk Flows
    - 10.1 - Configuration + Runtime Wiring
    - 10.2 - Contract Hardening Prerequisites
    - 10.3 - Risk Summaries
    - 10.4 - Call-Site Sampling + `call_sites.jsonl`
    - 10.5 - Propagation engine + `risk_flows.jsonl`
    - 10.6 - Artifact writing, Sharding, Validation, & determinism (E2E)
    - 10.7 - Explainability Tooling (CLI)
    - 10.8 - End-to-End Test Matrix & Performance Guardrails
    - 10.A - Risk Interprocedural Config Spec 
    - 10.B - `risk_summaries.jsonl` Spec 
    - 10.C - `risk_flows.jsonl` + `call_sites.jsonl` Spec 
    - 10.D - `risk_interprocedural_stats.json` Spec 
    - 10.E -- Implementation Notes 
### Features
- Phase 11 -- Graph-Powered Product Features (context packs, impact, explainability, ranking)
    - 11.1 - Graph Context Packs (bounded neighborhood extraction) + retrieval context-expansion hardening
    - 11.2 - Impact Analysis (callers/callees + k-hop impact radius) with witness paths
    - 11.3 - Context Pack Assembly for Tooling/LLM (chunk text + graph + types + risk) + explainability rendering
    - 11.4 - Graph-Aware Ranking Hooks (opt-in) + Explainability
    - 11.5 - Graph Expansion Caps as a Config Surface + Calibration Harness (language × size tier)
    - 11.6 - Cross-file API Contracts (report + optional artifact)
    - 11.7 - Architecture Slicing & Boundary Enforcement 
    - 11.8 - Test Selection Heuristics 
- Phase 12 -- MCP Migration + API/Tooling Contract Formalization
    - 12.1 - Dependency strategy and Capability Pating for the Official MCP SDK
    - 12.2 - SDK-backed MCP server (Parallel Mode with Explicit Cutover Flag)
    - 12.3 - Tool Schema Versioning, Conformance, and Drift Guards
    - 12.4 - Error codes, Protocol Negotiation, and Response-Shape Consistency
    - 12.5 - Cancellation, Timeouts, and Process Hygiene
    - 12.6 - Documentation and Migration Notes
- Phase 13 -- JJ Support (via Provider API)
    - 13.1 - Introduce `ScmProvider` Interface + Registry + Config/State Schema Wiring
    - 13.2 - Migrate Git onto the Provider Interface
    - 13.3 - Implement JJ Provider (read-only default, robust parsing)
    - 13.4 - CLI + Tooling Visibility (make SCM selection obvious)
    - 13.5 - Non-Repo Environments (explicitly supported)
- Phase 14 -- Incremental Diffing & Snapshots (Time Travel, Regression Debugging)
    - 14.1 - Snapshot & Diff Artifact Surface (contracts, retention, safety)
    - 14.2 - Pointer Snapshots (creation, validation gating, CLI/API)
    - 14.3 - Frozen Snapshots (immutable copies + integrity verification)
    - 14.4 - Deterministic Diff Computation (bounded, machine-readable)
    - 14.5 - Retrieval + Tooling Integration: “as-of” snapshots and “what changed” surfaces
- Phase 15 -- Federation & Multi-Repo (Workspaces, Catalog, Federated Search)
- Phase 16 -- Prose Ingestion + Retrieval Routing Correctness (PDF/DOCX + FTS policy)
- Phase 17 -- Vector-Only Profile (Embeddings-First, Build + Search w/o Sparse Postings)
- Phase 20 -- Distribution & Platform Hardening (Release Matrix, Packaging, & Optional Python)


#### Recommended Parallel Implementation Lanes
  - Lane A: Phase R (refactoring monoliths)
  - Lane B: Phase 6 Finalization (tests and cleanup, should be quick)
  - Lane C: Phase 7 (shotgun)
  - Lane D: Phase 9.1 → 9.2 + 9.3 → 9.4 → 9.5/9.6 → 9.7 → 9.8 (heavily sequential)
  - Lane E: Phase 10.1 early; 10.2+ only after we have call_sites + chunkUid + chunkUid graph

---

## Phase R -- Make Monoliths Modular, My Man

- [ ] `REFACT.md` Has a list of refactor targets and almost-finished work
- [ ] There are ~5-6 Monoliths left to refactor down into modules
  - [ ] Once complete, scan for other refactoring candidates
  - [ ] After everything has been split up, closely evaluate splits of all module systems
    - [ ] See if similar-enough components or functionality can be lifted up and merged into more central components to eliminate repetition 
- [ ] Keep track of call sites being changed, they all must be converted and fixed/working to be able to continue!!

### Phase R.1 -- Pakedge

`package.json` is gross dude.
- We don't need to be surfacing tools like this anymore
- It's fine to just call `node thescript`
- Determine List of Kept Commands
- Delete The Rest, Lint, Run All Tests, Fix any broken shit
- Write new policy gating what can be added to package json

### Phase R.2 -- Cleanup

- Agents.md should be updated with more comprehensive information about docs subfolders
- We should some sort of lightweight script that maps documentation to tags
  - And create a set of tests that will not pass until documents have been updated to reflect changes so that drift can be avoided
- Let's go through the repo and look at the files that have gone the longest without being modified
  - And the files that have changed the least since they've been added
  - And then probably remove them

## Phase 6  -- Finalization

This work may already be done! Look around for it a little before you implement it yourself. 

- [ ] `tests/vfs/virtual-path-stability.test.js` 
- [ ] `tests/vfs/vfs-manifest-roundtrip.test.js` 
- [ ] Verify that validation runs in CI lanes that already validate artifact schemas.
- [ ] Add a determinism test
    - [ ] Rebuilds twice
    - [ ] Asserts the `call_sites` content is at least line-identical for a fixed fixture repo
- [ ] Ensure `metaV2` consistency after post-processing that mutates docmeta/relations.
    - [ ] Sweep integration: cross-file inference mutates `docmeta`/`codeRelations` after `metaV2` is built.
    - [ ] Evaluate how metav2 is handled, is there a finalization pass or is it gathered lazy at write time? Explain this
    - If this is already solved by an earlier contract phase, add a verification test to prevent regressions.

## Phase 7 -- Embeddings + ANN: Determinism, Policy, Parity

### Objective

- Make embeddings generation & ANN retrieval:
    - **Deterministic** 
    - **Build-scoped**
    - **Policy-driven** across all supported backends:
        - HNSW
        - LanceDB
        - SQLite dense

This phase hardens the end-to-end lifecycle:

- Embeddings are **optional**, but when enabled they are **contracted**, discoverable, and validated.
- Embeddings jobs are **bound to a specific build output** (no implicit "current build" writes).
- Quantization/normalization rules are **consistent** across tools, caches, and query-time ANN.
- ANN backends behave predictably under real-world constraints (candidate filtering, partial failure, missing deps).

### Exit Criteria
  - Embeddings can be **disabled** without breaking builds, validation, or CI.
  - When embeddings are enabled, artifacts are **consistent, validated, and build-scoped** (no cross-build contamination).
  - HNSW and LanceDB ANN results are **stable and correctly ranked**, with clear selection/availability signaling.
  - CI can run without optional native deps (e.g., LanceDB) using an explicit **skip protocol**, while still providing meaningful ANN coverage where possible.

---

### Phase 7.1 -- Build-scoped embeddings jobs and best-effort enqueue semantics

- [ ] **Bind embeddings jobs to an explicit build output target (no "current build" inference).**
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
  - [ ] Record "embeddings pending/unavailable" state in `index_state.json` when enqueue fails.
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

### Phase 7.2 -- Embeddings artifact contract and explicit capability signaling

- [ ] **Define the canonical "embeddings artifacts" contract and make it discoverable.**
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
  - [ ] When embeddings are absent, validation should still pass but surface a clear "embeddings not present" indicator.
  - Touchpoints:
    - `src/index/validate.js`
- [ ] **Add missing-embeddings reporting (and optional gating).**
  - [ ] Track missing vectors during embedding build (code/doc/merged) instead of silently treating them as equivalent to an all-zero vector.
    - Preserve existing "fill missing with zeros" behavior only as an internal representation, but record missing counts explicitly.
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
  - Validate an index without embeddings artifacts and assert validation passes with a "not present" signal.
- [ ] Add `tests/embeddings/missing-rate-gating.test.js`
  - Force a controlled missing-vector rate and assert state/reporting reflects the gating outcome.

---

### Phase 7.3 -- Quantization invariants (levels clamp, safe dequantization, no uint8 wrap)

- [ ] **Enforce `levels ∈ [2, 256]` everywhere for uint8 embeddings.**
  - [ ] Clamp in quantization parameter resolution:
    - Update `src/storage/sqlite/vector.js: resolveQuantizationParams()` to clamp levels into `[2, 256]`.
    - Emit a warning when user config requests `levels > 256` (explicitly noting coercion).
  - [ ] Clamp at the quantizer:
    - Update `src/shared/embedding-utils.js: quantizeEmbeddingVector()` to mirror clamping (or route callers to `quantizeEmbeddingVectorUint8`).
    - Ensure no code path can produce values outside `[0, 255]` for "uint8" vectors.
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
  - Deferred (if not fully addressed here): **Phase 11 -- Index Portability & Migration Tooling**.

#### Tests / Verification

- [ ] Add `tests/unit/quantization-levels-clamp.test.js`
  - Pass `levels: 512` and assert it clamps to `256` (and logs a warning).
- [ ] Add `tests/unit/dequantize-levels-safe.test.js`
  - Call dequantization with `levels: 1` and assert no crash and sane output.
- [ ] Add `tests/regression/incremental-update-quantize-no-wrap.test.js`
  - Ensure packed uint8 values never wrap for large `levels` inputs.
- [ ] Extend `tests/lancedb-ann.js` to run with non-default quantization params and verify ANN still functions.

---

### Phase 7.4 -- Normalization policy consistency across build paths and query-time ANN

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

### Phase 7.5 -- LanceDB ANN correctness and resilience

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
  - [ ] Add a candidate-set test that exercises the "pushdown disabled" path and asserts `topN` is still achieved.
- [ ] Add a focused unit test (or harness test) that ensures concurrent queries do not open multiple LanceDB connections.

---

### Phase 7.6 -- HNSW ANN correctness, compatibility, and failure observability

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

### Phase 7.7 -- ANN backend policy and parity (selection, availability, explicit tests)

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

### Phase 7.8 -- Backend storage resilience required by embeddings/ANN workflows

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
  - Build both modes and rebuild one mode; verify the other mode's ANN data remains intact.
- [ ] Add `tests/embeddings/cache-preflight-metadata.test.js`
  - Ensure preflight uses metadata without scanning when the meta file exists, and remains correct.
- [ ] Unskip phase-tagged LMDB tests once Phase 7/8 deliverables land:
  - Remove `DelayedUntilPhase7_8` from `tests/run.config.jsonc`.
  - Ensure these tests pass: `lmdb-backend`, `lmdb-corruption`, `lmdb-report-artifacts`.

---

## Added detail (Phase 7 task mapping)

### 7.1 Build-scoped embeddings jobs + best-effort enqueue
- Task: Bind embedding jobs to explicit build output target
  - Files to change/create:
    - `src/index/build/indexer/pipeline.js` (enqueueEmbeddingJob call at ~323 already passes indexRoot; extend with configHash/repoProvenance)
    - `src/index/build/indexer/embedding-queue.js` (payload fields at ~8-33)
    - `tools/service/queue.js` (job schema validation if any)
  - Call sites/line refs:
    - `src/index/build/indexer/pipeline.js:323`
    - `src/index/build/indexer/embedding-queue.js:8-33`
  - Gaps/conflicts:
    - embedding job payload currently lacks configHash/repo provenance; Phase 7 requires it for determinism.
- Task: Best-effort enqueue when embeddingService is enabled
  - Files to change/create:
    - `src/index/build/indexer/embedding-queue.js` (wrap ensureQueueDir/enqueueJob, set pending state on failure)
    - `src/index/build/indexer/steps/write.js` (index_state.embeddings fields at ~52-98)
  - Call sites/line refs:
    - `src/index/build/indexer/embedding-queue.js:8-46`
    - `src/index/build/indexer/steps/write.js:52-98`
- Task: Worker honors build scoping
  - Files to change/create:
    - `tools/indexer-service.js` (runBuildEmbeddings uses --repo only at ~260-284; add --index-root/indexDir)
    - `tools/build-embeddings/cli.js` + `tools/build-embeddings/args.js` (ensure --index-root is parsed)
  - Call sites/line refs:
    - `tools/indexer-service.js:260-284`
    - `tools/build-embeddings/cli.js` (args wiring)

### 7.2 Embeddings artifact contract + capability signaling
- Task: Manifest + artifact discovery
  - Files to change/create:
    - `tools/build-embeddings/manifest.js` (embeddingPieces list at ~52-70; currently filtered by ARTIFACT_SCHEMA_DEFS)
    - `src/index/build/artifacts.js` (dense_vectors pieces at ~255-300)
  - Call sites/line refs:
    - `tools/build-embeddings/manifest.js:52-90`
    - `src/index/build/artifacts.js:255-300`
  - Gaps/conflicts:
    - `tools/build-embeddings/manifest.js` drops entries whose name is not in ARTIFACT_SCHEMA_DEFS
      - dense_vectors_hnsw.bin and lancedb dirs are silently omitted 
      - Reconcile with "discoverable" requirement.
- Task: Emit embedding identity + backend availability in index_state
  - Files to change/create:
    - `src/index/build/indexer/steps/write.js` (index_state.embeddings at ~52-90)
    - `tools/build-embeddings/runner.js` (index_state updates at ~175-191 and ~692-704)
    - `src/retrieval/cli-index.js` (embeddingsState read at ~101-107)
  - Call sites/line refs:
    - `src/index/build/indexer/steps/write.js:52-90`
    - `tools/build-embeddings/runner.js:175-191, 692-704`
    - `src/retrieval/cli-index.js:101-107`
- Task: Harden validation for embeddings presence/consistency
  - Files to change/create:
    - `src/index/validate.js` (dense vector validation at ~413-491)
  - Call sites/line refs:
    - `src/index/validate.js:413-491`
- Task: Missing-vector reporting + gating
  - Files to change/create:
    - `tools/build-embeddings/embed.js` (fillMissingVectors at ~120-150; add missing counters)
    - `tools/build-embeddings/runner.js` (propagate missing stats into index_state)
    - `src/index/build/file-processor/embeddings.js` (inline embeddings path)
  - Call sites/line refs:
    - `tools/build-embeddings/embed.js:108-145`

### 7.3 Quantization invariants
- Task: Clamp levels to [2,256] everywhere
  - Files to change/create:
    - `src/storage/sqlite/vector.js` (resolveQuantizationParams at ~10-20)
    - `src/shared/embedding-utils.js` (quantizeEmbeddingVector at ~56-74)
    - `src/index/embedding.js` (quantizeVec export at ~8-12)
    - `src/storage/sqlite/build/incremental-update.js` (quantize/pack paths at ~15-40)
  - Call sites/line refs:
    - `src/storage/sqlite/vector.js:10-20`
    - `src/shared/embedding-utils.js:56-86`
    - `src/index/embedding.js:8-12`
    - `src/storage/sqlite/build/incremental-update.js:15-40`
- Task: Safe dequantization + param propagation
  - Files to change/create:
    - `src/storage/sqlite/vector.js` (dequantizeUint8ToFloat32 at ~22-40)
    - `tools/build-embeddings/lancedb.js` (buildBatch uses dequantize with defaults at ~28-45)
  - Call sites/line refs:
    - `src/storage/sqlite/vector.js:22-40`
    - `tools/build-embeddings/lancedb.js:28-45`
- Task: MergeEmbeddingVectors regression guard
  - Files to change/create:
    - `src/shared/embedding-utils.js` (mergeEmbeddingVectors at ~6-32)

### 7.4 Normalization policy consistency
- Task: Centralize normalization policy
  - Files to change/create:
    - `src/shared/embedding-utils.js` (normalizeEmbeddingVector* at ~36-55) or new policy module
    - `tools/build-embeddings/embed.js` (normalizeEmbeddingVector call at ~4-10, ~108-121)
    - `src/index/build/file-processor/embeddings.js` (normalizeVec calls at ~238-240)
    - src/retrieval/embedding.js (query-time embeddings)
  - Call sites/line refs:
    - `tools/build-embeddings/embed.js:1-15, 108-121`
    - `src/index/build/file-processor/embeddings.js:238-240`

### 7.5 LanceDB ANN correctness
- Task: Promise-cache connections + candidate filtering
  - Files to change/create:
    - `src/retrieval/lancedb.js` (connection caching and candidate filtering paths)
  - Call sites/line refs:
    - `src/retrieval/lancedb.js` (connection map + rankLanceDb usage)
- Task: idColumn handling + warning policy
  - Files to change/create:
    - `src/retrieval/lancedb.js` (filter construction and warnOnce)
  - Gaps/conflicts:
    - `tools/build-embeddings/lancedb.js` meta lacks quantization params; add for later verification.

### 7.6 HNSW ANN correctness
- Task: Load signature compatibility + similarity mapping
  - Files to change/create:
    - `src/shared/hnsw.js` (loadHnswIndex + rankHnswIndex at ~40-120)
  - Call sites/line refs:
    - `src/shared/hnsw.js:40-120`
- Task: Insertion failure observability
  - Files to change/create:
    - `tools/build-embeddings/hnsw.js` (writeIndex at ~52-110)
  - Call sites/line refs:
    - `tools/build-embeddings/hnsw.js:52-110`

### 7.7 ANN backend policy + parity
- Task: Canonical ann-backend selection
  - Files to change/create:
    - `src/retrieval/cli/normalize-options.js` (backend choice)
    - `src/retrieval/ann/index.js` (provider selection)
    - `src/retrieval/ann/providers/*.js` (availability rules)
  - Call sites/line refs:
    - `src/retrieval/ann/providers/hnsw.js:9-22`
    - `src/retrieval/ann/providers/lancedb.js:9-27`
    - `src/retrieval/ann/providers/sqlite-vec.js:8-23`
- Task: Record backend availability in state
  - Files to change/create:
    - `src/index/build/indexer/steps/write.js` (index_state.features detail)
    - `src/retrieval/cli/run-search-session.js` (annBackendUsed at ~483-487)
  - Call sites/line refs:
    - `src/retrieval/cli/run-search-session.js:483-487`

### 7.8 Backend storage resilience
- Task: LMDB map size planning
  - Files to change/create:
    - `tools/build-lmdb-index.js` (lmdb open config; currently no map size config)
  - Call sites/line refs:
    - `tools/build-lmdb-index.js:1-90` (open import and options)
- Task: SQLite dense cross-mode safety
  - Files to change/create:
    - `tools/build-embeddings/sqlite-dense.js` (deleteDense/deleteAnn at ~130-150; uses global table name)
  - Call sites/line refs:
    - `tools/build-embeddings/sqlite-dense.js:118-150`
- Task: Embedding cache preflight metadata
  - Files to change/create:
    - `tools/build-embeddings/run.js` (preflight; see runner invocation)
    - tools/build-embeddings/cache.js (cache scan logic)
  - Gaps/conflicts:
    - Current `run.js` is minimal; cache scanning appears in `runner.js`; add metadata file to avoid full directory scan.

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
  - `tests/embeddings/job-payload-includes-buildroot.test.js` (test:integration)
  - `tests/embeddings/optional-no-service.test.js` (test:integration)
  - `tests/embeddings/worker-refuses-mismatched-buildroot.test.js` (test:integration)

### 7.1 Edge cases and fallback behavior

- Unwritable queue dir in service mode: 
  - log warning
  - set embeddings.pending=true
  - continue build
- Missing buildRoot/indexDir in job: 
  - Refuse job
  - Do NOT write artifacts

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
- `tests/unit/quantization-levels-clamp.test.js` (test:unit)
- `tests/unit/dequantize-levels-safe.test.js` (test:unit)
- `tests/regression/incremental-update-quantize-no-wrap.test.js` (test:integration)

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
- `tests/unit/normalization-policy-consistency.test.js` (test:unit)
- `tests/integration/hnsw-rebuild-idempotent.test.js` (test:integration)

### 7.4 Edge cases and fallback behavior
- Policy mismatch detected between build/query: mark ANN unavailable and fall back to lexical search.

### 7.5 Dependencies and order of operations

- Dependencies:
  - 7.3 quantization invariants
  - 7.4 normalization before LanceDB query fixes.
- Order of operations:
  1) Promise-cache LanceDB connections.
  2) Fix candidate filtering to honor topN.
  3) Escape identifiers and sanitize filters.
  4) Replace warnOnce suppression with rate-limited warnings.

### 7.5 Acceptance criteria + tests (lane)
- `tests/lancedb-ann.js` (test:services, skip 77 if missing deps)
- `tests/unit/lancedb-connection-caching.test.js` (test:unit)

### 7.5 Edge cases and fallback behavior

- LanceDB missing: 
  - Skip backend
  - Mark availability false
  - Cntinue with other backends.
- Candidate set too small:
  - Return fewer results
  - Log cap hit
  - Never crash.

### 7.6 Dependencies and order of operations

- Dependencies:
  - 7.3 quantization invariants before HNSW build.
- Order of operations:
  1) Fix load signature.
  2) Verify similarity mapping (ip/cosine).
  3) Capture insertion failures with summary.

### 7.6 Acceptance criteria + tests (lane)

- `tests/unit/hnsw-signature-compat.test.js` (test:unit)
- `tests/unit/hnsw-similarity-mapping.test.js` (test:unit)
- `tests/integration/hnsw-insert-failure-reporting.test.js` (test:integration)

### 7.6 Edge cases and fallback behavior

- Insert failure: 
  - Fail build with error summary
  - Do not write partial index.
- Missing HNSW index: 
  - Mark availability false 
  - Fall back to other backends.

### 7.7 Dependencies and order of operations

- Dependencies:
  - 7.5 & 7.6 must land before backend selection parity.
- Order of operations:
  1) Enumerate backend availability in index_state.
  2) Apply selection policy (config + availability).
  3) Add explicit backend tests with skip semantics.

### 7.7 Acceptance criteria + tests (lane)

- `tests/services/ann-backend-selection.test.js` (test:services)
- `tests/services/ann-backend-availability-reporting.test.js` (test:services)

### 7.7 Edge cases and fallback behavior

- Preferred backend unavailable: 
  - Select next available backend
  - Record reason in state.

### 7.8 Dependencies and order of operations

- Dependencies:
  - Storage backend guardrails must land before embeddings/ANN rely on them.
- Order of operations:
  1) Harden storage open/create paths.
  2) Add explicit error reporting (no silent partial writes).
  3) Add resilience tests.

### 7.8 Acceptance criteria + tests (lane)
- `tests/storage/embeddings-backend-resilience.test.js` (test:storage)

### 7.8 Edge cases and fallback behavior
- Partial storage failure: mark embeddings unavailable, do not expose ANN indexes.

## Fixtures list (Phase 7)

- `tests/fixtures/embeddings/basic-repo`
- `tests/fixtures/embeddings/missing-vectors`
- `tests/fixtures/embeddings/quantization-caps`

## Compat/migration checklist (Phase 7)

- Keep existing `dense_vectors_* filenames`
  - Do not rename artifacts.
- Accept legacy embedding jobs with a warning or explicit refusal (no silent mutation).
- Preserve current zero-fill behavior for missing vectors but record missing counts/gating.
- Keep ANN backends optional
  - Missing deps must skip, not fail builds.

## Artifacts contract appendix (Phase 7)

- `dense_vectors_uint8.json` (and `dense_vectors_doc_uint8.json`, `dense_vectors_code_uint8.json`)
  - Required keys: 
    - Dims
    - Vectors
  - Optional keys: 
    - Model 
    - Scale
  - Caps: `Dims >= 1` 
  - Vectors `length == chunk count`; 
  - Values in `[0,255]`
- `dense_vectors_hnsw.meta.json`
  - Required keys: 
    - Dims
    - Count 
    - Space
    - M 
    - EfConstruction 
    - EfSearch
  - Optional keys: 
    - Version 
    - GeneratedAt 
    - Model
- `dense_vectors_lancedb.meta.json`
  - Required keys: 
    - Dims 
    - Count
    - Metric
    - Table
    - EmbeddingColumn
    - IdColumn
  - Optional keys: 
    - Version 
    - GeneratedAt 
    - Model
- `pieces/manifest.json` entries for embeddings
  - Required keys: 
    - Type="embeddings" 
    - Name
    - Format 
    - Path
  - Recommended keys: 
    - Count 
    - Dims
    - Checksum 
    - Bytes

---

# Phase 9 -- Symbol identity (collision-safe IDs) + cross-file linking 

## Objective

Eliminate correctness hazards caused by non-unique, name-based joins (notably `file::name` and legacy `chunkId` usage) and replace them with a collision-safe identity layer. Use that identity to produce:

1) **Stable, segment-aware node identity** (`chunkUid`, `segmentUid`, `virtualPath`) that survives minor line shifts and prevents collisions across:
   - same-name declarations in different files,
   - same-name declarations inside different segments of the same container file,
   - repeated definitions (overloads, nested scopes, generated code patterns).

2) **A canonical symbol identity and reference contract** (`symbolKey`, `signatureKey`, `scopedId`, `symbolId`, `SymbolRef`) that:
   - is deterministic,
   - is language-agnostic at the storage boundary,
   - preserves ambiguity instead of forcing wrong links.

3) **Cross-file resolution that is import-aware and ambiguity-preserving**, using bounded heuristics and explicit `state` / `confidence` fields.

4) **First-class symbol graph artifacts** (`symbols`, `symbol_occurrences`, `symbol_edges`) that enable downstream graph analytics and product features without re-parsing code.

5) **Fail-closed identity and symbol joins:** no `file::name` fallback in strict mode; ambiguous resolutions are preserved, not guessed.

---
# Phase 9 -- Symbol identity (collision-safe IDs) + cross-file linking (detailed execution plan)

## Phase 9 objective (what "done" means)

Eliminate all correctness hazards caused by non-unique, name-based joins (notably `file::name` and legacy `chunkId` usage) and replace them with a collision-safe, stability-oriented identity layer. Use that identity to produce:

1) **Stable, segment-aware node identity** (`chunkUid`, `segmentUid`, `virtualPath`) that survives minor line shifts and prevents collisions across:
   - same-name declarations in different files,
   - same-name declarations inside different segments of the same container file,
   - repeated definitions (overloads, nested scopes, generated code patterns).

2) **A canonical symbol identity and reference contract** (`symbolKey`, `signatureKey`, `scopedId`, `symbolId`, `SymbolRef`) that:
   - is deterministic,
   - is language-agnostic at the storage boundary,
   - preserves ambiguity instead of forcing wrong links.

3) **Cross-file resolution that is import-aware and ambiguity-preserving**, using bounded heuristics and explicit confidence/status fields.

4) **First-class symbol graph artifacts** (`symbols.jsonl`, `symbol_occurrences.jsonl`, `symbol_edges.jsonl`) that enable downstream graph analytics and product features without re-parsing code.

5) **Fail-closed identity and symbol joins:** no file::name fallback in strict mode; ambiguous resolutions are preserved, not guessed.

This phase directly targets the Phase 9 intent in the roadmap ("Symbol identity (collision-safe IDs) + cross-file linking") and depends on the canonical `chunkUid` contract delivered in Phase 8. In particular, the `chunkUid` construction approach and "fail closed" requirement are consistent with the canonical identity contract described in the planning materials.

---

## Phase 9 non-goals (explicitly out of scope for Phase 9 acceptance)

These may be separate follow-on phases or optional extensions:

- Full **SCIP/LSIF/ctags hybrid symbol source registry** (runtime selection/merging) beyond ensuring the contracts can represent those IDs.
- Full module-resolution parity with Node/TS (tsconfig paths, package exports/imports, Yarn PnP, etc). Phase 9 supports **relative import resolution** only.
- Whole-program correctness for dynamic languages; Phase 9 focuses on **correctness under ambiguity** (never wrong-link) rather than "resolve everything".
- Cross-repo symbol federation.

---

## Phase 9 key decisions (locked)

These choices remove ambiguity and prevent future "forks" in implementation.

### D1) Graph node identity uses `chunkUid`, not `file::name`, not legacy `chunkId`

- **Chosen:** `chunkUid` is the canonical node identifier for graphs and cross-file joins.
- **Why:** `file::name` is not unique; `chunkId` is range-based and churns with line shifts. The roadmap's canonical identity guidance explicitly calls for a `chunkUid` that is stable under line shifts and includes segment disambiguation.

### D2) Symbol identity is a two-layer model: `symbolKey` (human/debug) + `symbolId` (portable token)

- **Chosen:** Persist both.
- **Why:** `symbolKey` is explainable and supports deterministic "rebuild equivalence" reasoning. `symbolId` is compact and future-proofs external sources (SCIP/LSIF) without schema churn.

### D3) Cross-file resolution is ambiguity-preserving

- **Chosen:** When multiple plausible targets exist, record candidates and mark the ref **ambiguous**; do not pick arbitrarily.
- **Why:** Wrong links destroy trust and cascade into graph features, risk flows, and context packs. Ambiguity can be resolved later by better signals.

### D4) Artifact emission is streaming-first and deterministically ordered

- **Chosen:** JSONL for symbol artifacts; deterministic sharding and sorting.
- **Why:** Large repos must not require in-memory materialization of symbol graphs; deterministic ordering is required for reproducible builds and regression testing.

---

## Phase 9 contracts (normative, implementation-ready)

> These contracts must be implemented exactly as specified to avoid drift.

### 9.C1 Identity contract (v1)

#### 9.C1.1 `segmentUid` (string | null)

- **Definition:** A stable identifier for a segment inside a container file (Vue SFC blocks, fenced Markdown blocks, etc).
- **Scope:** Unique within the repo (i.e., global uniqueness is acceptable and preferred).
- **Stability:** Must remain stable under *minor line shifts* outside the segment content.

**Algorithm (v1):**

```
segmentUid = "seg1:" + xxhash64(
  containerRelPath + "\0"
  + segmentType + "\0"
  + effectiveLanguageId + "\0"
  + normalizeText(segmentText)
  + "\0"
  + (parentSegmentUid ?? "")
)
```

- `normalizeText`:
  - normalize line endings to `\n`
  - preserve all non-whitespace characters
  - do not strip trailing whitespace by default (correctness-first)

#### 9.C1.2 `virtualPath` (string)

A deterministic "as-if file path" that disambiguates segments:

- If no segment: `virtualPath = fileRelPath`
- If segment: `virtualPath = fileRelPath + "#seg:" + segmentUid`

#### 9.C1.3 `chunkUid` (string)

- **Definition:** Stable-ish identifier for a chunk, used for graphs and join keys.
- **Stability:** Must remain stable when only lines outside the chunk's span shift (i.e., chunk text unchanged).
- **Collision handling:** If a collision is detected within `{virtualPath, segmentUid}`, deterministically disambiguate and record `collisionOf`.

**Algorithm (v1) -- consistent with the canonical contract described in the planning docs:**

```
span = normalizeForUid(chunkText)
pre  = normalizeForUid(text.slice(max(0, start-128), start))
post = normalizeForUid(text.slice(end, min(len, end+128)))

spanHash = xxhash64("span\0" + span)
preHash  = xxhash64("pre\0" + pre)   (only if pre.length > 0)
postHash = xxhash64("post\0" + post) (only if post.length > 0)

base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + spanHash
if (segment.languageId) base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + segment.languageId + ":" + spanHash
if (preHash)  base += ":" + preHash
if (postHash) base += ":" + postHash

chunkUid = base
```

This follows the canonical identity contract exactly (see `docs/specs/identity-contract.md` §4).

**Collision disambiguation (required):**

If `chunkUid` already exists for a different chunk under the same `virtualPath` scope:

- set `collisionOf = originalChunkUid`
- follow the canonical disambiguation steps: escalate context windows once, then assign deterministic ordinals and append `:ord<index>`.

> Note: the ordinal must be deterministic across runs given identical inputs.

#### 9.C1.4 metaV2 additions

`metaV2` MUST include:

- `chunkUid: string`
- `segmentUid: string | null`
- `virtualPath: string`

And SHOULD include (for diagnostics and future hardening):

- `identity: { v: 1, spanHash: string, preHash: string, postHash: string, collisionOf?: string }`

### 9.C2 Symbol identity contract (v1)

#### 9.C2.1 `kindGroup`

Normalize "kind" strings into a stable group set:

- `function`, `arrow_function`, `generator` → `function`
- `class` → `class`
- `method`, `constructor` → `method`
- `interface`, `type`, `enum` → `type`
- `variable`, `const`, `let` → `value`
- `module`, `namespace`, `file` → `module`
- unknown/other → `other`

#### 9.C2.2 `symbolKey`

```
symbolKey = virtualPath + "::" + qualifiedName + "::" + kindGroup
```

- `qualifiedName` defaults to `chunk.name`.
- When available, prefer container-aware names like `Class.method`.

#### 9.C2.3 `signatureKey` (optional)

```
signatureKey = qualifiedName + "::" + normalizeSignature(signature)
```

`normalizeSignature` must:
- collapse runs of whitespace to a single space
- preserve punctuation, generics, and parameter ordering

#### 9.C2.4 `scopedId`

```
scopedId = kindGroup + "|" + symbolKey + "|" + (signatureKey ?? "") + "|" + chunkUid
```

#### 9.C2.5 `symbolId`

- Deterministic, compact token:
- `symbolId = schemePrefix + sha1(scopedId)`

Where `schemePrefix` depends on source:

- Native/chunk-based: `sym1:heur:` (heuristic/native)
- SCIP: `sym1:scip:`
- LSIF: `sym1:lsif:`
- CTAGS: `sym1:ctags:`

> Phase 9 implements only `heur` generation but must preserve the scheme field in schemas.

#### 9.C2.6 `SymbolRef` (reference envelope)

A reference to a symbol, which may be resolved, ambiguous, or unresolved.

```
SymbolRefV1 = {
  v: 1,
  targetName: string,          // observed identifier, e.g. "foo" or "Foo.bar"
  kindHint: string | null,      // optional hint, e.g. "function"
  importHint: {
    moduleSpecifier: string | null,
    resolvedFile: string | null
  } | null,
  candidates: Array<{
    symbolId: string,
    chunkUid: string,
    symbolKey: string,
    signatureKey: string | null,
    kindGroup: string
  }>,
  status: "resolved" | "ambiguous" | "unresolved",
  resolved: {
    symbolId: string,
    chunkUid: string
  } | null
}
```

- `candidates` MUST be capped (see resolver caps in Phase 9.4).
- `resolved` is non-null only when `status === "resolved"`.

### 9.C3 Symbol graph artifacts (v1)

All symbol artifacts are emitted in `index-code/`:

- `symbols.jsonl`
- `symbol_occurrences.jsonl`
- `symbol_edges.jsonl`

Each line is one JSON object. Deterministic order and deterministic sharding are required.

#### 9.C3.1 `symbols.jsonl`

One record per symbol definition (i.e., per chunk with `metaV2.symbol`):

```
{
  "v": 1,
  "symbolId": "...",
  "scopedId": "...",
  "scheme": "heur",
  "symbolKey": "...",
  "signatureKey": null | "...",
  "chunkUid": "...",
  "virtualPath": "...",
  "segmentUid": null | "...",
  "file": "...",
  "lang": "...",
  "kind": "...",
  "kindGroup": "...",
  "name": "...",
  "qualifiedName": "...",
  "signature": null | "..."
}
```

#### 9.C3.2 `symbol_occurrences.jsonl`

One record per observed reference occurrence (calls, usages). At minimum:

```
{
  "v": 1,
  "fromChunkUid": "...",
  "fromFile": "...",
  "fromVirtualPath": "...",
  "occurrenceKind": "call" | "usage",
  "targetName": "...",
  "range": { "start": number, "end": number } | null,
  "ref": SymbolRefV1
}
```

#### 9.C3.3 `symbol_edges.jsonl`

One record per reference edge (call, usage) emitted from chunk relations:

```
{
  "v": 1,
  "edgeKind": "call" | "usage",
  "fromChunkUid": "...",
  "fromSymbolId": null | "...",
  "to": SymbolRefV1,
  "confidence": number,         // 0..1
  "evidence": {
    "importNarrowed": boolean,
    "matchedExport": boolean,
    "matchedSignature": boolean
  }
}
```

### 9.C4 Graph relations artifact migration (v2)

`graph_relations.json` MUST be updated such that:

- Node `id` is `chunkUid` (not legacy chunkId and not `file::name`)
- Node `attrs` include:
  - `chunkUid`, `chunkId` (legacy), `legacyKey` (for diagnostics only)
  - `symbolId` (when available)
- Edges are emitted **only** for resolved symbol edges (status=resolved)

---

## Phase 9 implementation plan (phases/subphases/tasks/tests)

### 9.1 Verify identity primitives (`segmentUid`, `chunkUid`, `virtualPath`) -- delivered in Phase 8

> If any identity primitive is missing or diverges from the canonical spec, stop Phase 9 and complete the work in Phase 8 before continuing.

**Verification checklist (no new algorithm changes in Phase 9)**
- Code presence:
  - `src/index/identity/*` helpers exist and match `docs/specs/identity-contract.md`.
  - `segmentUid`, `virtualPath`, and `chunkUid` are populated in `metaV2` for every code chunk.
- Behavior:
  - `segmentUid` stable under line shifts outside the segment.
  - `chunkUid` stable under line shifts outside the chunk span; changes when span text changes.
  - Collision handling uses canonical escalation + `:ord<N>` suffixes.
- Fail-closed identity rules:
  - Strict validation rejects any chunk missing `chunkUid`/`segmentUid`/`virtualPath`.
  - No file::name fallback for joins in strict mode.
- Tests (already required in Phase 8; rerun only if identity code changes):
  - tests/unit/segment-uid-stability.test.js (test:unit)
  - tests/unit/chunk-uid-stability.test.js (test:unit)
  - tests/validate/chunk-uid-required.test.js (test:services)
  - tests/graph-chunk-id.js (updated to chunkUid)

---

### 9.2 Implement symbol identity (`metaV2.symbol`, `SymbolRef`) and helpers

**Primary touchpoints**
- `src/index/metadata-v2.js`
- New: `src/index/identity/symbol.js`
- Update callsites: graph builder, cross-file resolver, map builder

#### 9.2.1 Implement symbol identity builder

- [ ] **Add `src/index/identity/kind-group.js`**
  - [ ] Implement `toKindGroup(kind: string | null): string`

- [ ] **Add `src/index/identity/symbol.js`**
  - [ ] `buildSymbolIdentity({ metaV2 }): { scheme, kindGroup, qualifiedName, symbolKey, signatureKey, scopedId, symbolId } | null`
  - [ ] Return null when chunk is not a "definition chunk" (policy below).

**Definition chunk policy (v1):**

- A chunk is a definition chunk if:
  - `chunk.name` is truthy AND not equal to `"(module)"` unless kindGroup is `module`, AND
  - `chunk.kind` is truthy OR `chunk.name === "(module)"`, AND
  - `metaV2.lang` is truthy (code mode).

> This policy is intentionally permissive; it can be tightened later, but Phase 9 prioritizes completeness with ambiguity-safe linking.

#### 9.2.2 Populate `metaV2.symbol`

- [ ] **Modify `src/index/metadata-v2.js`**
  - [ ] After identity fields are set, compute `metaV2.symbol` via `buildSymbolIdentity`.
  - [ ] Ensure `symbolKey` is based on `virtualPath`, not `file`.
  - [ ] Ensure `symbolId` is deterministic.

#### 9.2.3 Tests for symbol identity

- [ ] **Add `tests/identity/symbol-identity.test.js`**
  - Given a fake `metaV2` with chunkUid/virtualPath/kind/name/signature:
    - assert `symbolKey`, `signatureKey`, `scopedId` are correct.
    - assert `symbolId` is stable across runs.
    - assert `kindGroup` normalization.

---

### 9.3 Implement import-aware cross-file resolution (ambiguity-preserving)

**Primary touchpoints**
- `src/index/type-inference-crossfile/pipeline.js`
- New: `src/index/type-inference-crossfile/resolver.js`
- Update language relations to supply import bindings:
  - `src/lang/javascript/relations.js` (and optionally TS)

#### 9.3.1 Extend language relations to capture import bindings (JS/TS)

- [ ] **Modify `src/lang/javascript/relations.js`**
  - [ ] During AST walk, build `importBindings`:
    - `import { foo as bar } from "./x"` ⇒ `bar -> { imported: "foo", module: "./x" }`
    - `import foo from "./x"` ⇒ `foo -> { imported: "default", module: "./x" }`
    - `import * as ns from "./x"` ⇒ `ns -> { imported: "*", module: "./x" }`
  - [ ] Store in the returned relations object as `importBindings`.

- [ ] **Modify `src/index/build/file-processor/relations.js`**
  - [ ] Include `importBindings` in fileRelations entries.

- [ ] **Update file_relations schema** (`src/shared/artifact-schemas.js`)
  - [ ] Allow optional `importBindings` field.

#### 9.3.2 Add relative import resolver helper

- [ ] **Add `src/index/type-inference-crossfile/resolve-relative-import.js`**
  - [ ] Implement `resolveRelativeImport(importerFile: string, spec: string, fileSet: Set<string>): string | null`
  - [ ] Constraints:
    - only handle `./` and `../` specifiers
    - resolve with extension probing:
      - `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
      - directory index: `spec + "/index" + ext`
    - normalize to repo-relative POSIX paths (match existing `chunk.file` conventions)

#### 9.3.3 Implement resolver (SymbolRef builder)

- [ ] **Add `src/index/type-inference-crossfile/resolver.js`**
  - [ ] Build a `NativeSymbolIndex` from `chunks`:
    - `byVirtualPath: Map<string, { byExportName: Map<string, SymbolDef[]> }>`
    - `byNameGlobal: Map<string, SymbolDef[]>`
    - index both full qualifiedName and leaf name (`foo.bar` ⇒ also index `bar`) but record `matchKind`.
  - [ ] Implement `resolveRef({ fromChunk, targetName, kindHint, fileRelations, fileSet }): SymbolRefV1`
    - Bounded candidate collection + scoring (see caps below)
    - Import narrowing:
      - If `importBindings` provides a binding for the target's root identifier, resolve that module to a file.
      - Restrict candidate search to those files; then apply export filtering:
        - if imported name is known, prefer matching exports.
    - If exactly one best candidate above threshold ⇒ `status=resolved`
    - Else if >=2 candidates above threshold ⇒ `status=ambiguous` with top-K candidates
    - Else ⇒ `status=unresolved` with empty candidates

**Caps / guardrails (must be implemented):**

- `MAX_CANDIDATES_PER_REF = 25`
- `MAX_CANDIDATES_GLOBAL_SCAN = 200` (if exceeded, downgrade to ambiguous with "too many" signal)
- Deterministic sorting of candidates:
  - primary: score desc
  - secondary: `symbolKey` asc

#### 9.3.4 Resolver tests

- [ ] **Add `tests/crossfile/resolve-relative-import.test.js`**
  - table-driven tests for extension probing and index resolution.

- [ ] **Add `tests/crossfile/symbolref-resolution.test.js`**
  - Build synthetic chunks with metaV2.symbol identities across:
    - two files exporting same name `foo` ⇒ ambiguous
    - importer with `import { foo } from "./a"` ⇒ resolved to `a`
    - alias import `import { foo as bar }` and call `bar()` ⇒ resolved
    - unresolved case: no exports match

---

### 9.4 Update cross-file inference pipeline to emit SymbolRef-based links

**Primary touchpoints**
- `src/index/type-inference-crossfile/pipeline.js`
- `src/index/type-inference-crossfile/symbols.js` (deprecate or repurpose)
- Tooling providers that key by `file::name`

#### 9.4.1 Replace `file::name` joins with chunkUid/symbol identity joins

- [ ] **Modify `src/index/type-inference-crossfile/pipeline.js`**
  - [ ] Replace `chunkByKey` (`file::name`) map with:
    - `chunkByUid: Map<chunkUid, chunk>`
    - `defsBySymbolId: Map<symbolId, chunkUid>` (for quick reverse lookup)
  - [ ] Replace legacy `calleeKey = file::target` logic with resolved SymbolRef:
    - call summary includes `resolvedCalleeChunkUid` when available.

#### 9.4.2 Emit new-format `callLinks` and `usageLinks`

- [ ] In pipeline, for each call relation:
  - [ ] Build `SymbolRefV1` via resolver.
  - [ ] Append `codeRelations.callLinks` entry in **new format**:
    ```
    {
      v: 1,
      edgeKind: "call",
      fromChunkUid: <caller chunkUid>,
      to: <SymbolRefV1>,
      confidence: <0..1>,
      evidence: {...}
    }
    ```
  - [ ] Preserve legacy fields only if necessary for backward compatibility:
    - if retained, ensure they are explicitly marked `legacy: true` and never used for joins.

- [ ] Same for `usageLinks` with `edgeKind: "usage"`.

#### 9.4.3 Keep `callSummaries` but add chunkUid resolution

- [ ] Extend each `callSummaries[]` record to include:
  - `calleeRef: SymbolRefV1`
  - `resolvedCalleeChunkUid: string | null`
  - Keep `target/file/kind` for display backward compatibility.

#### 9.4.4 Update tooling providers to key by chunkUid (no silent overwrites)

These providers currently map results by `file::name`:

- `src/index/tooling/clangd-provider.js`
- `src/index/tooling/pyright-provider.js`
- `src/index/tooling/sourcekit-provider.js`
- `src/index/tooling/typescript-provider.js`

- [ ] For each provider:
  - [ ] Replace Maps keyed by `file::name` with Maps keyed by `chunkUid`.
  - [ ] Where tool outputs are only name-addressable (TS map), apply the resolved entry to all matching chunks but do not overwrite unrelated chunks.
  - [ ] Add defensive warnings if multiple chunks match same name within a file (for diagnostics only; do not pick arbitrarily).

#### 9.4.5 Pipeline tests

- [ ] Update / add tests under `tests/type-inference-crossfile/*`:
  - Assert pipeline outputs `callLinks[].to.status` values are correct for fixtures.
  - Assert callSummaries contains `calleeRef` and `resolvedCalleeChunkUid` when resolvable.
  - Assert no `Map` join uses `file::name` in the pipeline (lint-like test via grep in CI is acceptable).

---

### 9.5 Emit symbol artifacts (`symbols`, `symbol_occurrences`, `symbol_edges`)

**Primary touchpoints**
- `src/index/build/artifacts.js`
- New writer modules in `src/index/build/artifacts/writers/`
- `src/shared/artifact-io.js`
- `src/shared/artifact-schemas.js`
- `src/index/validate.js`

#### 9.5.1 Add writer modules

- [ ] **Add `src/index/build/artifacts/writers/symbols.js`**
  - [ ] Iterator over `state.chunks` yielding `symbols.jsonl` records.
  - [ ] Deterministic order: sort by `symbolId` (or by `(virtualPath, qualifiedName, kindGroup, chunkUid)` if streaming constraints require per-shard sort).
  - [ ] Use JSONL sharding logic similar to `file-relations.js`.

- [ ] **Add `src/index/build/artifacts/writers/symbol-occurrences.js`**
  - [ ] Iterate chunks; for each call/usage relation occurrence emit occurrence record with `ref` included.

- [ ] **Add `src/index/build/artifacts/writers/symbol-edges.js`**
  - [ ] Iterate chunks; for each callLinks/usageLinks edge emit edge record.
  - [ ] Emit unresolved/ambiguous edges as well (they're valuable for metrics and later resolution).

#### 9.5.2 Integrate into artifact build

- [ ] **Modify `src/index/build/artifacts.js`**
  - [ ] Write the three symbol artifacts into `index-code/`.
  - [ ] Ensure pieces manifest includes them.

- [ ] **Modify `src/shared/artifact-io.js`**
  - [ ] Add JSONL required keys entries for:
    - `symbols` (e.g., require `v`, `symbolId`, `chunkUid`)
    - `symbol_edges` (require `v`, `edgeKind`, `fromChunkUid`, `to`)
    - `symbol_occurrences` (require `v`, `fromChunkUid`, `occurrenceKind`)

- [ ] **Modify `src/shared/artifact-schemas.js`**
  - [ ] Add schemas for the new artifacts.

#### 9.5.3 Add validation and metrics hooks

- [ ] **Modify `src/index/validate.js`**
  - [ ] When symbol artifacts are present:
    - [ ] validate schema
    - [ ] cross-check referential integrity:
      - every `symbols.chunkUid` exists in chunk_meta
      - every resolved edge `to.resolved.chunkUid` exists
  - [ ] Compute and print metrics (non-fatal unless strict flag is enabled):
    - `resolvedRate`, `ambiguousRate`, `unresolvedRate`

#### 9.5.4 Tests for artifacts

- [ ] Add `tests/artifacts/symbol-artifacts-smoke.test.js`
  - Build a small in-memory "fake state" with 2 chunks and resolved/ambiguous links.
  - Run iterators and ensure JSONL output lines validate and include required keys.

---

### 9.6 Migrate relation graphs to use `chunkUid` and resolved edges only

**Primary touchpoints**
- `src/index/build/graphs.js`
- `tests/graph-chunk-id.js`
- `src/map/build-map.js` (consumes graph_relations)

#### 9.6.1 Update graph builder

- [ ] **Modify `src/index/build/graphs.js`**
  - [ ] Node identity:
    - `nodeId = chunk.metaV2.chunkUid`
    - Store legacy fields as attributes only.
  - [ ] Edges:
    - For each `callLinks`/`usageLinks` edge record:
      - if `to.status !== "resolved"` ⇒ skip for graph_relations edges
      - else edge target is `to.resolved.chunkUid`
  - [ ] Remove `chunkIdByKey` (`file::name`) join logic entirely.
  - [ ] Keep guardrails and sampling; update samples to include `chunkUid`.

#### 9.6.2 Graph schema/version bump

- [ ] Bump `graph_relations.version` to `2`
- [ ] Ensure consumers handle version 1 and 2:
  - v1: id may be chunkId or legacyKey
  - v2: id is chunkUid
  - Map builder should accept both (backward compatibility).

#### 9.6.3 Tests

- [ ] Update `tests/graph-chunk-id.js`
  - Ensure:
    - nodes keyed by chunkUid
    - collision scenario produces distinct node ids
    - legacyKey remains in attrs for diagnostics
  - Add regression: ambiguous edges are not included in graph edges.

---

### 9.7 Update map build to use new identities (and avoid collisions)

**Primary touchpoints**
- `src/map/build-map.js`
- `src/map/isometric/client/map-data.js` (only if assumptions change)

#### 9.7.1 Update symbol keying inside map build

- [ ] **Modify `src/map/build-map.js`**
  - Replace `buildSymbolId(file::name)` with:
    - prefer `chunk.metaV2.symbol.symbolId`
    - else use `chunk.metaV2.chunkUid`
  - Maintain a mapping:
    - `memberId -> chunkUid`
  - Use graph_relations v2 node ids (`chunkUid`) to join to chunk_meta.

#### 9.7.2 Backward compatibility

- [ ] If graph_relations.version === 1:
  - maintain existing behavior (best-effort)
- [ ] If version === 2:
  - require chunkUid mapping; fail with explicit error if missing (do not silently mis-join).

#### 9.7.3 Map tests

- [ ] Add `tests/map/map-build-symbol-identity.test.js`
  - Build minimal graph_relations v2 + chunk_meta fixture.
  - Assert map members are distinct for same-name collisions.

---

### 9.8 Performance, determinism, and regression guardrails

#### 9.8.1 Determinism requirements

- [ ] `chunkUid` deterministic for identical inputs.
- [ ] Symbol artifacts emitted in deterministic line order.
- [ ] Graph builder output deterministic ordering (`serializeGraph` already sorts).

Add tests:

- [ ] `tests/determinism/symbol-artifact-order.test.js`
  - Run iterator twice and assert identical output.

#### 9.8.2 Throughput requirements

- [ ] Avoid O(N^2) scans over all symbols per reference:
  - use name-indexed maps and import-narrowing.
- [ ] Avoid per-reference filesystem operations:
  - precompute `fileSet` in resolver.

Add tests/benchmarks (optional but recommended):

- [ ] `tools/bench/symbol-resolution-bench.js`
  - synthetic repo with 100k symbols and 200k refs; ensure runtime is bounded.

---

## Phase 9 exit criteria (must all be true)

- [ ] No graph or cross-file linking code performs `Map.set()` keyed solely by `file::name` in a way that can silently overwrite distinct entities.
- [ ] `metaV2.chunkUid` is present and non-empty for every code chunk ("fail closed").
- [ ] `graph_relations.version === 2` and node ids are `chunkUid`.
- [ ] Pipeline emits SymbolRef-based call/usage links; ambiguous/unresolved are preserved explicitly.
- [ ] Symbol artifacts are written and validate successfully on the small fixture suite.
- [ ] New tests for chunkUid stability and resolver correctness are green.

---

## Appendix A -- Concrete file-by-file change list (for Codex)

This appendix is purely to reduce "search time" during implementation. Each file lists the exact intent.

### A.1 New files to add

- `src/index/identity/normalize.js`
- `src/index/identity/virtual-path.js`
- `src/index/identity/segment-uid.js`
- `src/index/identity/chunk-uid.js`
- `src/index/identity/kind-group.js`
- `src/index/identity/symbol.js`
- `src/index/type-inference-crossfile/resolve-relative-import.js`
- `src/index/type-inference-crossfile/resolver.js`
- `src/index/build/artifacts/writers/symbols.js`
- `src/index/build/artifacts/writers/symbol-occurrences.js`
- `src/index/build/artifacts/writers/symbol-edges.js`
- Tests:
  - `tests/identity/chunk-uid-stability.test.js`
  - `tests/identity/segment-uid-stability.test.js`
  - `tests/identity/symbol-identity.test.js`
  - `tests/crossfile/resolve-relative-import.test.js`
  - `tests/crossfile/symbolref-resolution.test.js`
  - `tests/artifacts/symbol-artifacts-smoke.test.js`
  - `tests/map/map-build-symbol-identity.test.js`
  - `tests/determinism/symbol-artifact-order.test.js`

### A.2 Existing files to modify

- `src/index/segments.js` -- compute and propagate `segmentUid`
- `src/index/build/file-processor.js` -- compute `chunkUid`
- `src/index/build/file-processor/assemble.js` -- pass through chunkUid fields
- `src/index/metadata-v2.js` -- include identity + symbol identity
- `src/lang/javascript/relations.js` -- emit `importBindings`
- `src/index/build/file-processor/relations.js` -- include importBindings
- `src/shared/artifact-schemas.js` -- add schemas, extend file_relations
- `src/shared/artifact-io.js` -- required keys for new JSONL artifacts
- `src/index/type-inference-crossfile/pipeline.js` -- emit SymbolRef edges and avoid file::name joins
- `src/index/tooling/{typescript,pyright,clangd,sourcekit}-provider.js` -- key by chunkUid
- `src/index/build/artifacts.js` -- write symbol artifacts
- `src/index/validate.js` -- validate symbol artifacts (optional strict)
- `src/index/build/graphs.js` -- graph_relations v2 using chunkUid
- `src/map/build-map.js` -- join graph nodes to chunk meta via chunkUid
- `tests/graph-chunk-id.js` -- update

---

## Appendix B -- Metrics to report (recommended)

- `symbol_resolution.resolved_rate`
- `symbol_resolution.ambiguous_rate`
- `symbol_resolution.unresolved_rate`
- `symbol_resolution.max_candidates_hit_rate`
- `symbol_resolution.import_narrowed_rate`

In strict CI mode, optionally enforce:

- `wrong_link_rate == 0` on fixtures with gold truth
- `resolved_rate >= threshold` on fixtures (threshold set per fixture)

---

## Added detail (Phase 9 task mapping)

### 9.1 Identity primitives (segmentUid, chunkUid, virtualPath)
- Files to change/create:
  - New: src/index/identity/normalize.js, virtual-path.js, segment-uid.js, chunk-uid.js
  - Existing: src/index/segments.js (assignSegmentUids / buildSegmentUid at ~17-50)
  - Existing: src/index/build/file-processor/assemble.js (buildChunkPayload at ~52-105)
  - Existing: src/index/metadata-v2.js (buildMetaV2 uses chunk/meta fields at ~214-260)
  - Existing: src/index/chunk-id.js (legacy chunkId; used by resolveChunkId)
- Call sites/line refs:
  - src/index/segments.js:17-50 (buildSegmentUid, assignSegmentUids)
  - src/index/build/file-processor/assemble.js:52-105
  - src/index/chunk-id.js:1-18
- Gaps/conflicts:
  - Resolved: docs/phases/phase-9/identity-contracts.md now matches docs/specs/identity-contract.md for chunkUid (span/pre/post hashes + virtualPath + segmentUid).
  - Phase 8 spec updated to align; Phase 9 remains the implementation target.

### 9.2 Symbol identity (metaV2.symbol + SymbolRef)
- Files to change/create:
  - New: src/index/identity/kind-group.js, src/index/identity/symbol.js
  - Existing: src/index/metadata-v2.js (add symbol object after identity fields)
  - Existing: src/index/type-inference-crossfile/symbols.js (leafName/isTypeDeclaration; may be replaced by identity helpers)
- Call sites/line refs:
  - src/index/metadata-v2.js:214-260 (current metaV2 fields)
  - src/index/type-inference-crossfile/symbols.js:1-30
- Gaps/conflicts:
  - Resolved: symbolKey inputs now use `virtualPath` (segmentUid-based), not segmentId.

### 9.3 Import-aware cross-file resolver
- Files to change/create:
  - New: src/index/type-inference-crossfile/resolve-relative-import.js, resolver.js
  - Existing: src/lang/javascript/relations.js (add importBindings during AST walk; call site around 360-420)
  - Existing: src/index/build/file-processor/relations.js (persist importBindings into fileRelations)
  - Existing: src/contracts/schemas/artifacts.js (extend file_relations schema)
- Call sites/line refs:
  - src/lang/javascript/relations.js:360-418 (AST traversal + callDetails)
  - src/index/build/file-processor/relations.js:27-50
  - src/contracts/schemas/artifacts.js:318-334

### 9.4 Pipeline emits SymbolRef-based links
- Files to change/create:
  - src/index/type-inference-crossfile/pipeline.js (replace chunkByKey `${file}::${name}` at ~58-70; update callLinks at ~201-280)
  - src/index/type-inference-crossfile/symbols.js (or new resolver helpers)
  - src/index/tooling/* providers (clangd/pyright/sourcekit/typescript) keyed by file::name
- Call sites/line refs:
  - src/index/type-inference-crossfile/pipeline.js:58-70, 201-280, 286, 340
  - src/index/tooling/typescript-provider.js:308
  - src/index/tooling/clangd-provider.js:230
  - src/index/tooling/pyright-provider.js:281, 328
  - src/index/tooling/sourcekit-provider.js:198
- Gaps/conflicts:
  - Multiple providers split names by /::|\./ (see src/index/type-inference-crossfile/symbols.js:4-9); switching to SymbolRef requires consistent qualifiedName handling.

### 9.5 Symbol artifacts (symbols, symbol_occurrences, symbol_edges)
- Files to change/create:
  - New writers: src/index/build/artifacts/writers/symbols.js, symbol-occurrences.js, symbol-edges.js
  - src/index/build/artifacts.js (enqueue writers near file_relations at ~380)
  - src/shared/artifact-io/jsonl.js (required keys list)
  - src/contracts/schemas/artifacts.js (add schemas)
  - src/index/validate.js (strict validation + referential checks)
- Call sites/line refs:
  - src/index/build/artifacts.js:380-401
  - src/shared/artifact-io/jsonl.js:11-17
  - src/index/validate.js:76-95, 301-347

### 9.6 Graph relations migrate to chunkUid
- Files to change/create:
  - src/index/build/graphs.js (legacyKey + resolveChunkId at ~9-149)
  - tests/graph-chunk-id.js (update expectations)
- Call sites/line refs:
  - src/index/build/graphs.js:9, 91-149
- Gaps/conflicts:
  - resolveChunkId currently uses chunkId fallback; Phase 8 must ensure metaV2.chunkUid is populated to avoid legacyKey reuse.

### 9.7 Map build identity updates
- Files to change/create:
  - src/map/build-map.js (consume chunkUid + symbolId)
  - src/map/build-map/symbols.js (buildSymbolId uses file::name at ~11-16)
  - src/map/build-map/edges.js (edge member keys at ~104)
  - src/map/build-map/filters.js (file::name parsing at ~30-31, 115-116, 189-192, 216-217)
- Call sites/line refs:
  - src/map/build-map/symbols.js:11-16
  - src/map/build-map/edges.js:104
  - src/map/build-map/filters.js:30-31, 115-116, 189-192, 216-217

### 9.8 Performance + determinism guardrails
- Files to change/create:
  - src/index/build/graphs.js (serializeGraph already sorts; keep stable ordering)
  - new tests under tests/determinism/ and tools/bench/
- Call sites/line refs:
  - src/index/build/graphs.js:45-68 (serializeGraph ordering)

### Associated specs reviewed (Phase 9)
- docs/phases/phase-9/identity-contracts.md
- docs/phases/phase-9/symbol-artifacts-and-pipeline.md
- docs/phases/phase-9/migration-and-backcompat.md
- docs/specs/identity-contract.md
- docs/specs/symbol-identity-and-symbolref.md
- docs/specs/symbol-artifacts.md

## Phase 9 addendum: dependencies, ordering, artifacts, tests, edge cases

### Cross-phase ordering (Phase 8 ↔ Phase 9)
- Identity primitives (`segmentUid`, `virtualPath`, `chunkUid`) **must already be complete from Phase 8** before any Phase 9 symbol/graph work starts.
- Phase 9.1 is verification-only: if identity primitives are missing or drifted, stop Phase 9 and complete Phase 8 identity tasks first.
- Identity tests (segmentUid/chunkUid/strict validation) must already be green from Phase 8; rerun only if identity code changes.

### 9.1 Dependencies and order of operations
- Dependencies:
  - segmentUid algorithm must land before chunkUid (needs segment text).
  - virtualPath and chunkUid helpers must exist before any graph/tooling joins.
- Order of operations:
  1) Compute segmentUid during segmentation (container text available).
  2) Build virtualPath and chunkUid during chunk assembly.
  3) Persist into metaV2 + chunk payload.
  4) Add strict validation for missing chunkUid.

### 9.1 Acceptance criteria + tests (lane)
- Identity tests run in Phase 8 (see Phase 8 addendum). Rerun only if identity code changes.

### 9.1 Edge cases and fallback behavior
- Missing segment text in cache hydrate: treat as cache miss and reprocess file.
- chunkUid collision: escalate context once, then append :ord<N> deterministically.
- Fail-closed: strict mode rejects any chunk missing chunkUid/segmentUid/virtualPath (no file::name fallback).

### 9.2 Dependencies and order of operations
- Dependencies:
  - 9.1 identity helpers must land before symbol identity helpers.
- Order of operations:
  1) Implement kindGroup normalization.
  2) Implement symbolKey/signatureKey/scopedId builders.
  3) Add SymbolRef envelope helpers.

### 9.2 Acceptance criteria + tests (lane)
- tests/unit/identity-symbolkey-scopedid.test.js (test:unit)
- tests/unit/symbolref-envelope.test.js (test:unit)

### 9.2 Edge cases and fallback behavior
- Missing qualifiedName: fall back to chunk.name; mark symbolKey as low confidence.
- Duplicate scopedId: deterministic ordinal suffix or strict-mode error (choose and document).

### 9.3 Dependencies and order of operations
- Dependencies:
  - import bindings must be extracted before resolver runs.
- Order of operations:
  1) Collect import bindings in relations extraction.
  2) Resolve relative imports to candidate files.
  3) Emit SymbolRef candidates with status=ambiguous when >1.

### 9.3 Acceptance criteria + tests (lane)
- tests/integration/import-resolver-relative.test.js (test:integration)
- tests/services/symbol-edges-ambiguous.test.js (test:services)

### 9.3 Edge cases and fallback behavior
- Unresolved import: emit unresolved SymbolRef with candidates empty; keep edge.
- Multiple matches: status=ambiguous; do not pick winner.
- Fail-closed: if resolver cannot map to chunkUid candidates, mark unresolved; do not guess by name.

### 9.4 Dependencies and order of operations
- Dependencies:
  - 9.1 chunkUid and 9.2 symbol helpers must be present.
- Order of operations:
  1) Build chunkUid map.
  2) Replace file::name joins with chunkUid joins.
  3) Attach SymbolRef info to call/usage links.

### 9.4 Acceptance criteria + tests (lane)
- tests/integration/file-name-collision-no-wrong-join.test.js (test:integration)
- tests/services/symbol-links-by-chunkuid.test.js (test:services)

### 9.4 Edge cases and fallback behavior
- Missing chunkUid: strict mode fails; non-strict logs and skips the link.
- Multiple candidates: preserve ambiguity in SymbolRef.
- Fail-closed: never backfill chunkUid joins from file::name; emit ambiguous/unresolved instead.

### 9.5 Artifact row fields (symbols.jsonl, symbol_occurrences.jsonl, symbol_edges.jsonl)
- symbols.jsonl required keys (SymbolRecordV1):
  - v, symbolKey, scopedId, symbolId, qualifiedName, kindGroup, file, virtualPath, chunkUid
  - optional: signatureKey, languageId, chunkId, containerName, source
- symbol_occurrences.jsonl required keys (SymbolOccurrenceV1):
  - v, host.file, host.chunkUid, role, ref (SymbolRefV1)
  - optional: meta.callerScopedId, meta.argMap
- symbol_edges.jsonl required keys (SymbolEdgeV1):
  - v, type, from.file, from.chunkUid, to (SymbolRefV1)
  - optional: confidence, reason, call.argMap
- Caps (set explicit defaults in schema/tests):
  - maxCandidates in SymbolRef (recommended: 25)
  - maxEvidence/snippet size (no raw snippets; use hashes)
  - maxRowBytes (recommended: 32768)

### 9.5 Acceptance criteria + tests (lane)
- tests/services/symbol-artifacts-emission.test.js (test:services)
- tests/validate/symbol-integrity-strict.test.js (test:services)
- tests/services/symbol-edges-ambiguous.test.js (test:services)

### 9.5 Edge cases and fallback behavior
- Duplicate scopedId: strict validation fails; non-strict appends deterministic ordinal.
- SymbolRef resolved but missing chunkUid: treat as unresolved and log.
- Fail-closed: if SymbolRef is resolved but missing chunkUid/scopedId, drop edge in strict mode.

### 9.6 Dependencies and order of operations
- Dependencies:
  - 9.1 chunkUid must land before graph_relations v2.
- Order of operations:
  1) Update graph node ids to chunkUid.
  2) Update edge targets to resolved chunkUid only.
  3) Keep legacyKey for diagnostics only.

### 9.6 Acceptance criteria + tests (lane)
- tests/integration/graph-relations-v2-chunkuid.test.js (test:integration)

### 9.6 Edge cases and fallback behavior
- Missing chunkUid in chunk_meta: strict mode fails; non-strict skips node.

### 9.7 Dependencies and order of operations
- Dependencies:
  - Graph relations v2 must be complete before map build joins.
- Order of operations:
  1) Join map entries by chunkUid.
  2) Fallback to chunkId only for diagnostics.

### 9.7 Acceptance criteria + tests (lane)
- tests/integration/map-chunkuid-join.test.js (test:integration)

### 9.7 Edge cases and fallback behavior
- Multiple map entries for same chunkUid: keep deterministic ordering, dedupe by chunkUid.

### 9.8 Dependencies and order of operations
- Dependencies:
  - Determinism checks after all artifact emission.
- Order of operations:
  1) Run determinism tests (two builds).
  2) Verify collision handling is stable.

### 9.8 Acceptance criteria + tests (lane)
- tests/integration/chunkuid-determinism.test.js (test:integration)
- tests/integration/symbol-artifact-determinism.test.js (test:integration)

### 9.8 Edge cases and fallback behavior
- Large repos: enforce sharded emission; fail if memory cap exceeded.

## Fixtures list (Phase 9)

- tests/fixtures/identity/chunkuid-collision
- tests/fixtures/symbols/ambiguous-defs
- tests/fixtures/imports/relative-ambiguous
- tests/fixtures/graph/chunkuid-join

## Compat/migration checklist (Phase 9)

- Keep chunkId and segmentId in metaV2 for debug/back-compat only.
- Emit graph_relations v2 with chunkUid node ids; keep legacyKey for diagnostics only.
- Symbol artifacts are additive; do not remove legacy repo_map outputs.

## Artifacts contract appendix (Phase 9)

- symbols.jsonl
  - required keys: v, symbolKey, scopedId, symbolId, qualifiedName, kindGroup, file, virtualPath, chunkUid
  - optional keys: signatureKey, languageId, chunkId, containerName, source
  - caps: maxRowBytes 32768
- symbol_occurrences.jsonl
  - required keys: v, host.file, host.chunkUid, role, ref (SymbolRefV1)
  - optional keys: meta.callerScopedId, meta.argMap
- symbol_edges.jsonl
  - required keys: v, type, from.file, from.chunkUid, to (SymbolRefV1)
  - optional keys: confidence, reason, call.argMap
- graph_relations.json (v2)
  - required node ids: chunkUid
  - legacyKey allowed for diagnostics only

---

## Phase 10 -- Interprocedural Risk Flows (taint summaries + propagation)

- There are new or additional versions of specs referenced in this work at `docs\new_docs`
  - Please carefully review each one
  - Underneath this list, make a checkbox list items for each document this phase mentions that has relevant new_docs
  - Underneath each actual document, list the new documents as sub items
  - Once you have gathered them all, comprehensively merge any useful improvements or changes they offer into our documents
  - If there are conflicting choices, make the best choice. Document the chocies made in the list. We want to leave no ambiguity

- Phase 10 introduces a non-artifact interface (`state.riskInterprocedural`) that is not fully specified in the existing Phase 10 docs.
  - Draft spec: `spec_risk-interprocedural-state-and-pipeline_DRAFT.md` (**needs another pass after first implementation**)

### Canonical specs to implement

Use these specs as the normative contracts:

- Config: `docs/specs/risk-interprocedural-config.md`
- Summaries: `docs/specs/risk-summaries.md` 
- Flows: `docs/specs/risk-flows-and-call-sites.md`
- CallSiteId + stats: `docs/specs/risk-callsite-id-and-stats.md`

---

## Global decisions (apply everywhere)

### D1. Use `chunkUid` as the canonical identity
The repo already treats `chunkUid` as the stable chunk identifier (`metaV2.chunkUid` and `chunk.chunkUid`).
- **All new maps/keys must be keyed by `chunkUid`**.
- `chunkId` (range-derived) may be emitted only as an optional debugging field.

### D2. `call_sites.jsonl` is a shared artifact with an existing contract
The repo already writes `call_sites.jsonl` via:
- Writer: `src/index/build/artifacts/writers/call-sites.js`
- Schema: `src/contracts/schemas/artifacts.js` (`callSiteEntry`)
- Required keys: `src/shared/artifact-io/jsonl.js` (`call_sites`)

Phase 10 must **not** introduce a divergent call-sites schema. Instead:
- Ensure prerequisites (location/offsets) for all languages.
- Optionally add deterministic sampling/filtering **without removing required fields**.

### D3. Respect `analysisPolicy` overrides
Runtime config is not the only authority: per-chunk and cross-file behavior can be overridden by `analysisPolicy`.
Phase 10 gating must treat `analysisPolicy.risk.enabled === false` as disabling interprocedural work.

---

## 10.1 Config wiring + runtime gating

### Files 
- `src/index/build/runtime/runtime.js` — runtime config parsing and feature flags.
- `src/index/build/indexer/steps/relations.js` — cross-file inference gating.
- `src/index/build/indexer/steps/write.js` — `index_state.json` feature recording.
- `src/index/build/indexer/signatures.js` — incremental signature payload 

### New Files
- `src/index/risk-interprocedural/config.js` — normalization per spec.

### Anchors 
- `runtime.js`:
  - `createBuildRuntime()` begins at **L38**.
  - `const riskAnalysisEnabled = …` at **L163**.
  - main return object begins at **L592** (`return { … }`).
- `relations.js`:
  - `runCrossFileInference()` begins at **L133**.
  - `const crossFileEnabled = …` at **L139**.
- `write.js`:
  - `writeIndexArtifactsForMode()` begins at **L41**.
  - `const indexState = { … }` at **L52**.
- `signatures.js`:
  - `buildIncrementalSignaturePayload()` begins at **L13**.

### Tasks
- [ ] Implement config normalization in `src/index/risk-interprocedural/config.js`.
  - Output: `{ enabled, strictness, summaryOnly, emitArtifacts, sanitizerPolicy, maxDepth, maxFlows, maxCallSitesPerEdge, maxWorkMs, maxNodesVisited, maxEvidencePerChunk, maxSignalsPerChunk, maxArgsPerCallSite, maxSnippetBytesPerEvidence }`
  - Must follow defaults and validation rules in `risk-interprocedural-config.md`.

- [ ] Wire normalized config into runtime.
  - File: `src/index/build/runtime/runtime.js`
  - Change point: after `riskConfig` normalization (~L166) and before the return object (L592+).
  - Add:
    - `runtime.riskInterproceduralConfig` (normalized)
    - `runtime.riskInterproceduralEnabled` (gated)
    - `runtime.riskInterproceduralEffectiveEmit` (resolved emit policy)
  - **Gating rule:** if resolved risk is disabled (`analysisPolicy.risk.enabled === false`) OR `runtime.mode !== "code"` => disable.

- [ ] Ensure cross-file inference runs when interprocedural risk is enabled.
  - File: `src/index/build/indexer/steps/relations.js`
  - Change point: `crossFileEnabled` at L139.
  - Update to include `runtime.riskInterproceduralEnabled`.
  - Ensure `applyCrossFileInference()` is invoked with:
    - `enableTypeInference = runtime.typeInferenceCrossFileEnabled`
    - `enableRiskCorrelation = runtime.riskAnalysisCrossFileEnabled`
    - **Do not implicitly enable either** just because interprocedural risk is on.

- [ ] Record feature enablement into the build signature.
  - File: `src/index/build/indexer/signatures.js`
  - Change point: `features` object at L47.
  - Add booleans/config summary fields so incremental builds don’t reuse an incompatible signature.

- [ ] Record feature enablement into `index_state.json`.
  - File: `src/index/build/indexer/steps/write.js`
  - Change point: `indexState.features` around L86.
  - Add `riskInterprocedural: <boolean>`.
  - If you need to persist a config summary, use `indexState.extensions.riskInterprocedural` (schema-safe) rather than adding a new top-level property.

### Tests to add/adjust
- [ ] Unit: config normalization (defaults + invalid values).
- [ ] Unit: runtime gating respects `analysisPolicy.risk.enabled`.
- [ ] Unit: build signature changes when feature toggled.

---

## 10.2 Prerequisites: stable params + call-site locations

### Files
- JS:
  - `src/lang/javascript/relations.js` (function param extraction; callDetails)
  - `src/lang/javascript/docmeta.js` (docmeta param population)
- Python:
  - `src/lang/python/ast-script.js` (call_details payload)
- Cross-file type inference:
  - `src/index/type-inference-crossfile/extract.js` (return-type extraction)
  - `src/index/metadata-v2.js` (declared return typing)

### Anchors
- JS params:
  - `collectParamMeta()` at `src/lang/javascript/relations.js` **L193-L243**.
  - `extractDocMeta()` at `src/lang/javascript/docmeta.js` **L9+**.
- JS call details:
  - `resolveCallLocation()` at `src/lang/javascript/relations.js` **L344-L399**.
  - call details push loop at **L481-L520**.
- Python call details:
  - `call_details.append({...})` at `src/lang/python/ast-script.js` **~L435**.

### Tasks
- [ ] Enforce deterministic param naming for destructured params (JS).
  - Problem: current `collectPatternNames()` explodes destructuring into many names.
  - Fix: for each parameter index `i`, emit a single positional name (`arg0`, `arg1`, …) when the param is not an Identifier.
  - Optional: separately capture destructured binding names into a non-signature field (do not feed into `docmeta.params`).

- [ ] Ensure `docmeta.params` uses the stable signature param list.
  - File: `src/lang/javascript/docmeta.js`
  - Change point: where it prefers `astMeta.functionMeta.params`.

- [ ] Ensure callDetails include **line+col and offsets** for all languages.
  - JS already provides offsets/loc; make `resolveCallLocation()` tolerant (if needed) rather than dropping location.
  - Python must add:
    - `startLine`, `startCol`, `endLine`, `endCol`
    - `start`, `end` (character offsets) **because the repo’s `call_sites` schema requires them**.
    - Suggestion: compute offsets from the `source` string via a `lineStartOffsets[]` table.

- [ ] (Verify-only) return types never emit boolean values.
  - `collectDeclaredReturnTypes()` already ignores non-string/object return types.
  - Add regression tests to prevent future reintroduction.

### Tests to add
- [ ] JS: destructured params produce `argN` signature params (no exploded names).
- [ ] Python: call details now include location+offsets, enabling `call_sites.jsonl` rows.
- [ ] Cross-file: declared returns never include boolean-derived strings.

---

## 10.3 Local risk summaries

### Files (new)
- `src/index/risk-interprocedural/summaries.js`

### Files (existing, integration)
- `src/index/build/indexer/steps/relations.js` (run summaries before propagation)
- `src/index/metadata-v2.js` (already rebuilds metaV2 late; ensure summary attached before write)

### Anchors
- `relations.js`: insert after `applyCrossFileInference()` (around L170) and before the step returns.
- `write.js`: `finalizeMetaV2()` is already called before writing artifacts (L35+).

### Tasks
- [ ] Implement `buildRiskSummaries(chunks, runtime, riskRules)`.
  - Outputs:
    - `summariesByChunkUid: Map<chunkUid, RiskSummaryRow>`
    - `compactByChunkUid: Map<chunkUid, RiskCompactSummary>`
    - `statsDelta` (for Phase 10 stats)
  - Ordering + capping must follow `spec_risk-summaries_IMPROVED.md`.

- [ ] Attach `docmeta.risk.summary` for chunks with local risk.
  - Store the compact summary on `chunk.docmeta.risk.summary` so `metaV2` includes it.

- [ ] Persist results in `state.riskInterprocedural` for later artifact writing.
  - Structure per `spec_risk-interprocedural-state-and-pipeline_DRAFT.md`.

### Tests to add
- [ ] Determinism: summary JSON lines stable across runs.
- [ ] Caps: evidence and signals capped per spec; stats reflect truncations.

---

## 10.4 Call-site evidence for propagation paths

**Important:** The repo already has a call-sites writer. Phase 10 should extend it rather than invent a second `call_sites.jsonl`.

### Files (existing)
- `src/index/build/artifacts/writers/call-sites.js`
- `src/shared/artifact-io/jsonl.js` (required keys already include `call_sites`)
- `src/contracts/schemas/artifacts.js` (call site schema)

### Anchors
- `call-sites.js`:
  - `createCallSites()` begins around **L151**.
  - `createCallSiteId()` around **L43**.

### Tasks
- [ ] Make call-sites selection bounded and deterministic.
  - Minimum: cap **per edge** at `maxCallSitesPerEdge`.
  - Deterministic strategy: group by edge, sort by `callSiteId`, take first N.

- [ ] Ensure referential integrity for `risk_flows.callSiteIdsByStep`.
  - If Phase 10 chooses to emit only call-sites “used by flows”, add an optional filter input (`allowedCallSiteIds` or `allowedEdges`) to the writer.
  - If Phase 10 keeps emitting broader call-sites, ensure `explain-risk` can stream-filter.

### Tests to add
- [ ] Deterministic sampling per edge.
- [ ] Writer honors caps and still produces schema-valid rows.

---

## 10.5 Interprocedural propagation

### Files (new)
- `src/index/risk-interprocedural/engine.js`
- `src/index/risk-interprocedural/propagate.js`

### Files (existing)
- `src/index/build/indexer/steps/relations.js` (invoke propagation)
- `src/index/type-inference-crossfile/pipeline.js` (callLinks contain `targetChunkUid`)

### Anchors
- `pipeline.js`: resolved call links include `targetChunkUid` (see `linksFromDocs()` around **L249+**).

### Tasks
- [ ] Propagate using `chunkUid` edges only.
  - Build a graph from `chunk.codeRelations.callLinks` where each link includes `targetChunkUid`.
  - Ignore unresolved edges (no `targetChunkUid`).

- [ ] Implement strictness modes per config.
  - `conservative`: treat any argument flow as tainted.
  - `argAware`: respect argument index, parameter mapping, and sanitizers.

- [ ] Determinism + guardrails.
  - `maxWorkMs`, `maxNodesVisited`, `maxDepth`, `maxFlows`.
  - Stable ordering of queue operations.

- [ ] Produce `risk_flows` rows per `spec_risk-flows-and-call-sites_RECONCILED.md`.
  - Use `callSiteIdsByStep` to reference sampled call-sites.

### Tests to add
- [ ] Multi-hop propagation across JS/Python fixtures.
- [ ] Strictness mode differences.
- [ ] Guardrail-triggered `timed_out` / `truncated` statuses.

---

## 10.6 Artifact writing + validation

### Files (existing)
- `src/index/build/artifacts.js` (enqueue artifacts)
- `src/shared/artifact-io/jsonl.js` (required keys for new JSONL artifacts)
- `src/contracts/schemas/artifacts.js` (schemas)
- `src/index/validate.js` (validator)

### Files (new)
- `src/index/build/artifacts/writers/risk-interprocedural.js` writes:
  - `risk_summaries.jsonl`
  - `risk_flows.jsonl`
  - `risk_interprocedural_stats.json`)

### Anchors
- `build/artifacts.js`: add new enqueue near other JSONL writers.
- `validate.js`: add loaders and referential-integrity checks.

### Tasks
- [ ] Add artifact schemas to contracts.
  - `risk_summaries` and `risk_flows` JSONL rows.
  - `risk_interprocedural_stats` JSON.

- [ ] Add JSONL required-key lists.
  - File: `src/shared/artifact-io/jsonl.js`
  - Add keys for `risk_summaries` + `risk_flows`.

- [ ] Add validator coverage.
  - Structural schema validation.
  - Referential integrity:
    - every `risk_flows.callSiteId` referenced must exist in `call_sites`.

### Tests to add
- [ ] Schema/required-key enforcement.
- [ ] Referential-integrity failures produce actionable errors.

---

## 10.7 CLI: explain-risk

### Files (new)
- `tools/explain-risk.js`

### Files (existing)
- `bin/pairofcleats.js` (wire command)
- `src/shared/artifact-io/*` (read JSONL / sharded JSONL)

### Tasks
- [ ] Implement CLI that can:
  - Filter by `--chunk-uid`, `--rule-id`, `--flow-id`.
  - Print local risk summary and the interprocedural flows that originate from a chunk.

- [ ] Ensure it is memory-safe for large JSONL.
  - Prefer streaming iteration over loading entire arrays.

### Tests to add
- [ ] Golden output tests with small fixtures.

---

## 10.8 End-to-end tests

### Tests to add
- [ ] Small repo fixture with:
  - source → helper → sink (multi-hop)
  - sanitizer on one path
  - both JS + Python call edges

- [ ] Validate artifacts:
  - `risk_summaries.jsonl` present when enabled
  - `risk_flows.jsonl` present when `summaryOnly=false`
  - `call_sites.jsonl` contains all referenced callSiteIds
  - `risk_interprocedural_stats.json` status reflects guardrails

---

## Phase 11 — Graph-powered product features (context packs, impact, explainability, ranking)

### Objective
Turn graph and identity primitives into **safe, bounded, deterministic** product surfaces: graph context packs, impact analysis, explainable graph-aware ranking (opt-in), and structured outputs suitable for both CLI use and future API/MCP consumers.

- Assumes canonical identities exist (e.g., chunkUid/SymbolId and a canonical reference envelope for unresolved/ambiguous links).
- Any graph expansion MUST be bounded and MUST return truncation metadata when caps trigger (depth/fanout/paths/nodes/edges/time).
- The default search contract must remain stable: graph features can change ordering when enabled, but must not change membership/correctness.

---

### 11.1 Graph context packs (bounded neighborhood extraction) + retrieval context-expansion hardening

- [ ] Define a graph context pack contract (JSON-first; Markdown render optional).
  - Output shape (minimum):
    - `seed` (canonical id + type)
    - `nodes[]` (bounded; stable ordering)
    - `edges[]` (bounded; stable ordering; include direction and edge type)
    - `paths[]` (optional; bounded witness paths when requested)
    - `truncation[]` (one or more truncation records; absent only when no caps trigger)
    - `warnings[]` (e.g., missing artifacts, partial/unresolved edges)
  - Link safety:
    - Any edge endpoint that fails to resolve MUST use a reference envelope (resolved/ambiguous/unresolved + candidates + reason + confidence).
  - Cap surface (configurable):
    - `maxDepth`, `maxFanoutPerNode`, `maxNodes`, `maxEdges`, `maxPaths`, `maxWallClockMs`.

- [ ] Implement deterministic neighborhood extraction for a seed id (k-hop).
  - Prefer graph source artifacts when present:
    - `graph_relations` for call/usage/import graphs (baseline).
    - `symbol_edges` / callsite artifacts (when available) for evidence and SymbolId identity.
  - Deterministic traversal:
    - Stable adjacency ordering (lexicographic by canonical id, then edge type).
    - Deterministic tie-breaking when budgets are hit (e.g., keep lowest id first, or keep highest confidence first, but make it explicit and stable).
  - Strict bounding:
    - Enforce caps during traversal (no “collect everything then slice”).
    - Record truncation metadata with which cap triggered and how much was omitted.

- [ ] Refactor `src/retrieval/context-expansion.js` so it is safe to reuse as the neighborhood engine (or provide a thin wrapper).
  - Touchpoints:
    - `src/retrieval/context-expansion.js`
    - `src/shared/artifact-io.js` (artifact presence checks via manifest)
  - [ ] Eliminate eager `{id, reason}` candidate explosion.
    - Convert candidate generation to a streaming/short-circuit loop that stops as soon as `maxPerHit` / `maxTotal` is satisfied.
    - Add per-source caps (e.g., max call edges examined, max import links examined) so worst-case repos cannot allocate unbounded candidate sets.
  - [ ] Remove duplicate scanning and make reason selection intentional.
    - Track candidates in a `Map<id, { bestReason, bestPriority, reasons? }>` rather than pushing duplicates into arrays.
    - Define a fixed reason priority order (example: call > usage > export > import > nameFallback) and document it.
    - When `--explain` is enabled, optionally retain the top-N reasons per id (bounded).
  - [ ] Stop assuming `chunkMeta[id]` is a valid dereference forever.
    - Build a `byDocId` (and/or `byChunkUid`) lookup once and use it for dereferencing.
    - If a dense array invariant is still desired for performance, validate it explicitly and fall back to map deref when violated.
  - [ ] Prefer identity-first joins.
    - When graph artifacts exist, resolve neighbors via canonical ids rather than `byName` joins.
    - Keep name-based joins only as an explicit fallback mode with low-confidence markers.

#### Tests
- [ ] `tests/graph/context-pack-basic.test.js`
  - Build a small fixture graph; request a context pack for a known seed; assert expected caller/callee/import/usage neighbors are present.
- [ ] `tests/graph/context-pack-caps.test.js`
  - Use a large synthetic graph fixture; assert truncation metadata is present and stable when caps trigger.
- [ ] `tests/retrieval/context-expansion-no-candidate-explosion.test.js`
  - Stress fixture with many relations; assert expansion completes within a time/memory budget and does not allocate unbounded candidate arrays.
- [ ] `tests/retrieval/context-expansion-reason-precedence.test.js`
  - A chunk reachable via multiple relation types records the highest-priority reason deterministically.
- [ ] `tests/retrieval/context-expansion-shuffled-chunkmeta.test.js`
  - Provide a shuffled `chunkMeta` where array index != docId; assert expansion still resolves correct chunks via a map-based dereference.

Touchpoints (consolidated):
- `src/retrieval/context-expansion.js` (refactor to become the bounded neighborhood engine)
- `src/shared/artifact-io.js` (manifest/presence checks)
- `src/graph/neighborhood.js` (new; deterministic bounded traversal)
- `src/graph/context-pack.js` (new; pack construction + truncation metadata)
- `src/retrieval/pipeline.js` (wire expansion hooks)
- `src/retrieval/output/context.js` (render context packs; harden sanitization)
- `src/retrieval/cli/options.js` + `src/retrieval/cli/normalize-options.js` (CLI flags)
- `bin/pairofcleats.js` (CLI wiring: `search --graph-context/--context-pack`)
- `docs/contracts/search-cli.md` (document CLI + JSON output contract)



---

### 11.2 Impact analysis (callers/callees + k-hop impact radius) with witness paths

- [ ] Implement bounded impact analysis on top of the same neighborhood extraction primitives.
  - Provide `impactAnalysis(seed, { direction, depth, caps, edgeFilters })` returning:
    - impacted nodes (bounded; stable ordering)
    - at least one witness path per impacted node when available (bounded; do not enumerate all paths)
    - explicit unresolved/partial path markers when edges cannot be resolved.
  - Deterministic ordering:
    - stable sort by `(distance, confidence desc, name/id asc)` (or equivalent stable rule), and document it.

- [ ] CLI surface (API-ready internal design).
  - Add `pairofcleats impact --repo … --seed <id> --direction upstream|downstream --depth 2 --format json|md`.
  - Ensure the implementation is factored so an API/MCP handler can call the same core function with the same caps and output schema.

- [ ] Optional “changed-set” impact mode (non-blocking in this phase).
  - Accept `--changed <file>` repeated (or a file containing paths) and compute:
    - impacted symbols in and around changed files, then traverse upstream/downstream bounded.
  - If SCM integration is unavailable, degrade gracefully (explicit warning; still supports explicit `--changed` lists).

#### Tests
- [ ] `tests/graph/impact-analysis-downstream.test.js`
  - Seed a function; assert downstream impacted nodes include an expected callee and a witness path is returned.
- [ ] `tests/graph/impact-analysis-upstream.test.js`
  - Seed a function; assert upstream impacted nodes include an expected caller and a witness path is returned.
- [ ] `tests/graph/impact-analysis-caps-and-truncation.test.js`
  - Trigger caps deterministically; assert truncation metadata identifies which cap fired and results remain stable.

Touchpoints (consolidated):
- `src/graph/impact.js` (new; bounded impact analysis)
- `src/graph/witness-paths.js` (new; witness path reconstruction)
- `src/graph/neighborhood.js` (shared traversal primitives)
- `src/retrieval/cli/impact.js` (new; CLI command implementation)
- `src/retrieval/output/impact.js` (new; stable human + JSON renderers)
- `bin/pairofcleats.js` (CLI wiring: `impact`, `impact:explain`)
- `docs/contracts/search-cli.md` (document new surfaces + JSON schema)



---

### 11.3 Context pack assembly for tooling/LLM (chunk text + graph + types + risk) + explainability rendering

- [ ] Implement a “context pack assembler” that composes multiple bounded slices into a single package.
  - Inputs:
    - `seed` (chunkUid/SymbolId)
    - budgets (`maxTokens` and/or `maxBytes`, plus graph caps)
    - toggles (includeTypes, includeRisk, includeImports, includeUsages, includeCallersCallees)
  - Output (recommended minimum):
    - `primary` (chunk excerpt + stable identifiers + file/segment provenance)
    - `graph` (from 11.1; bounded neighborhood)
    - `types` (bounded: referenced/declared/inferred/tooling-backed summaries when available)
    - `risk` (bounded: top-N flows/summaries crossing the seed, with callsite evidence when present)
    - `truncation[]` (aggregate truncation across slices)
    - `warnings[]` (missing artifacts, partial resolution, disabled features)
  - Notes:
    - Do not embed large raw code blobs; prefer bounded excerpts and (when needed) snippet hashes + location coordinates.
    - Use stable ordering inside each slice so context packs are deterministic across runs.

- [ ] Add CLI surface:
  - `pairofcleats context-pack --repo … --seed <id> --hops 2 --maxTokens 4000 --format json|md`
  - For Markdown output, use consistent sections and a deterministic ordering (primary first, then callers/callees, then imports/usages, then risk).

- [ ] Add explain-risk rendering for flows when risk artifacts exist.
  - Provide an output mode (flag or subcommand) that prints:
    - the path of symbols/chunks
    - file/line evidence (callsites) when present
    - rule ids/categories and confidence
    - bounded snippets or snippet hashes (never unbounded)
  - Ensure output is stable, capped, and does not assume optional color helpers exist.

- [ ] Harden retrieval output helpers used by these features (integrate known bugs in touched files).
  - Touchpoints:
    - `src/retrieval/output/context.js`
    - `src/retrieval/output/explain.js`
  - [ ] `cleanContext()` must remove fence lines that include language tags.
    - Treat any line whose trimmed form starts with ``` as a fence line.
  - [ ] `cleanContext()` must not throw on non-string items.
    - Guard/coerce before calling `.trim()`.
  - [ ] Explain formatting must not assume `color.gray()` exists.
    - Provide a no-color fallback when `color?.gray` is not a function.

#### Tests
- [ ] `tests/graph-features/context-pack-assembly.test.js`
  - Build fixture; assemble a context pack; assert it contains primary + at least one neighbor + deterministic truncation structure.
- [ ] `tests/graph-features/risk-explain-render.test.js`
  - Use a risk-flow fixture; assert output includes a call path and evidence coordinates and remains bounded.
- [ ] `tests/output/clean-context-fences.test.js`
  - Ensure ```ts / ```json fences are removed (not just bare ```).
- [ ] `tests/output/clean-context-nonstring-guard.test.js`
  - Feed non-string items; assert no crash and only string lines survive.
- [ ] `tests/output/explain-color-fallback.test.js`
  - Provide a partial color impl; assert explain rendering does not throw.

Touchpoints (consolidated):
- `src/retrieval/output/context.js` (hardening: fence stripping, type guards, truncation reporting)
- `src/retrieval/output/explain.js` (null-safe + color fallback; stable explain schema)
- `src/retrieval/output/format.js` (structured output plumbing; context-pack JSON integration)
- `src/retrieval/cli/render-output.js` + `src/retrieval/cli/render.js` (output modes + JSON formatting)
- `src/retrieval/cli/options.js` (flags: `--context-pack`, `--explain-json`, etc.)
- `bin/pairofcleats.js` (CLI wiring for new output modes)
- `docs/contracts/search-cli.md` (update contract + examples)



---

### 11.4 Graph-aware ranking hooks (opt-in) + explainability

- [ ] Introduce optional graph-aware ranking features that can be enabled without changing result membership.
  - Candidate feature families (bounded, deterministic):
    - node degree / in-degree / out-degree (prefer precomputed analytics artifacts when available)
    - proximity to the query-hit seed within the graph neighborhood (bounded k-hop)
    - proximity to risk hotspots (if risk summaries/flows exist)
    - same-cluster bonus (if clustering artifacts exist; deterministic cluster id remapping is assumed)
  - Guardrails:
    - Never compute expensive global graph metrics per query unless explicitly cached and bounded.
    - Default behavior remains unchanged unless explicitly enabled.

- [ ] Integrate into retrieval ranking with an explicit feature-hook layer.
  - Touchpoints (expected):
    - `src/retrieval/pipeline.js` (scoring assembly + explain output)
    - `src/retrieval/cli/run-search-session.js` / options normalization (flag plumbing)
  - Configuration:
    - `retrieval.graphRanking.enabled` (default false)
    - `retrieval.graphRanking.weights` (explicit; versioned defaults)
    - `retrieval.graphRanking.maxGraphWorkMs` (time budget)
  - Explainability:
    - When `--explain` (or a dedicated `--explain-ranking`) is enabled, include a `graph` section in the score breakdown:
      - feature contributions and the final blended delta.

#### Tests
- [ ] `tests/retrieval/graph-ranking-toggle.test.js`
  - Run the same query with graph ranking off/on; assert result sets are identical but ordering may differ.
- [ ] `tests/retrieval/graph-ranking-explain.test.js`
  - With explain enabled, assert output includes named graph feature contributions.
- [ ] `tests/retrieval/graph-ranking-determinism.test.js`
  - Re-run the same query twice with graph ranking enabled; assert ordering and explain payload are stable.

---

### 11.5 Graph expansion caps as a config surface + calibration harness (language × size tier)

- [ ] Make graph expansion caps first-class, shared configuration rather than hard-coded constants.
  - Touchpoints (expected):
    - `src/index/build/graphs.js` (replace `GRAPH_MAX_NODES/EDGES` constants with config-driven caps; record which cap triggered)
      - Also enforce identity-first graph node IDs for new writes (no `file::name` fallbacks); legacy keys, if still needed, are read-compat only and must not overwrite collisions.
    - `src/retrieval/context-expansion.js` (use the same cap vocabulary; always emit truncation metadata when caps trigger)
    - `docs/perf/graph-caps.md` (document defaults and tuning)
  - Required behavior:
    - Every expansion returns truncation metadata when it truncates.
    - Truncation metadata must indicate which cap fired and provide counts (omitted nodes/edges/paths) when measurable.

- [ ] Implement a metrics-harvesting harness to justify default caps.
  - Inputs:
    - Use/extend `benchmarks/repos.json` to define repos.
    - Normalize into tiers: small / typical / large / huge / problematic(massive).
  - For each repo/tier (outside CI for huge/problematic):
    - run indexing with graphs enabled
    - compute graph distributions (node/edge counts, degree stats, SCC size)
    - run bounded neighborhood expansions for representative seeds (random, top-degree, entrypoints)
    - record timing and output sizes
  - Outputs:
    - versioned bundle under `benchmarks/results/<date>/graph-caps/`
    - machine-readable defaults: `defaults/graph-caps.json` keyed by language (and optionally tier)
    - documentation: `docs/perf/graph-caps.md` (p95 behavior for typical tier + presets for huge/problematic)

#### Tests
- [ ] `tests/graphs/caps-enforced-and-reported.test.js`
  - Build a small fixture; request deep expansion; assert caps trigger deterministically and truncation metadata is present.
- [ ] `tests/bench/graph-caps-harness-smoke.test.js`
  - Run the harness on a tiny in-tree fixture; assert it writes a results JSON file with required fields and deterministic ordering.

---

### 11.6 Cross-file API contracts (report + optional artifact)

- [ ] Provide an API-contract extraction/report surface based on existing artifacts (do not require new parsing).
  - For each exported symbol (as available via symbol artifacts):
    - canonical signature (declared + tooling-backed when available)
    - observed call signatures (from bounded callsite evidence / callDetails summaries)
    - compatibility warnings (arity mismatches, incompatible argument kinds, unresolved targets)
  - Output formats:
    - JSON (machine; versioned schema)
    - Markdown (human; deterministic ordering)
  - Strict caps:
    - max symbols analyzed per run
    - max calls sampled per symbol
    - max warnings emitted (with truncation metadata)

- [ ] CLI surface:
  - `pairofcleats api-contracts --repo … [--only-exports] [--fail-on-warn] --format json|md`

- [ ] Optional: enable an artifact emitter for downstream automation.
  - `api_contracts.jsonl` (one record per symbol) with strict schema validation and caps.

#### Tests
- [ ] `tests/contracts/api-contracts-basic.test.js`
  - Fixture with an exported function called with multiple shapes; assert contract report includes observed calls and a mismatch warning.
- [ ] `tests/contracts/api-contracts-caps.test.js`
  - Trigger caps; assert truncation metadata is present and stable.

---

### 11.7 Architecture slicing and boundary enforcement (rules + CI-friendly output)

- [ ] Add a rules format for architectural constraints over graphs.
  - Rule types (minimum viable):
    - forbidden edges by path glob/module group (importGraph)
    - forbidden call edges by symbol tags or file globs (callGraph)
    - layering rules (optional; best-effort) that detect edges going “up-layer”
  - Outputs:
    - bounded report with counts, top offending edges, and a deterministic ordering
    - CI-friendly JSON (versioned schema)

- [ ] CLI surface:
  - `pairofcleats architecture-check --repo … --rules <path> --format json|md [--fail-on-violation]`

#### Tests
- [ ] `tests/architecture/forbidden-import-edge.test.js`
  - Fixture with a forbidden import; assert violation is reported deterministically.
- [ ] `tests/architecture/report-is-bounded.test.js`
  - Large fixture triggers caps; assert truncation metadata exists and report remains parseable.

---

### 11.8 Test selection heuristics (suggest tests impacted by a change set)

- [ ] Implement a bounded, deterministic test suggestion tool that uses graphs when available.
  - Identify tests using path conventions and language-aware patterns:
    - `*.test.*`, `*_test.*`, `/tests/`, `__tests__/`, etc.
  - Given a changed set (`--changed <file>` repeated or a file list):
    - map changed files/symbols to seed nodes
    - traverse upstream/downstream within caps
    - rank candidate tests based on witness paths, proximity, and (optional) centrality
  - Output:
    - top-K suggested tests + brief rationale (witness path summary), bounded and deterministic

- [ ] CLI surface:
  - `pairofcleats suggest-tests --repo … --changed <...> --max 50 --format json|md`

#### Tests
- [ ] `tests/tests-selection/suggest-tests-basic.test.js`
  - Fixture where a changed function is called by a test; assert the test is suggested.
- [ ] `tests/tests-selection/suggest-tests-bounded.test.js`
  - Trigger caps; assert truncation metadata is present and ordering is stable.

Touchpoints (consolidated):
- `src/retrieval/rankers.js` (add graph-aware ranker; keep it opt-in)
- `src/retrieval/pipeline.js` (ranker selection + scoring integration)
- `src/retrieval/query-intent.js` (intent signals used by ranker)
- `src/graph/*` (re-use context pack + neighborhood metadata for ranking features)
- `src/retrieval/cli/options.js` + `bin/pairofcleats.js` (flags: `--rank graph`, `--rank-default <...>`)
- `src/retrieval/output/explain.js` (surface ranker contributions in explain)
- `docs/contracts/search-cli.md` (document ranker options + explain additions)

---

## Phase 12 — MCP Migration + API/Tooling Contract Formalization

### Objective
Modernize and stabilize PairOfCleats’ integration surface by (1) migrating MCP serving to the **official MCP SDK** (with a safe compatibility window), (2) formalizing MCP tool schemas, version negotiation, and error codes across legacy and SDK transports, and (3) hardening cancellation/timeouts so MCP requests cannot leak work or hang.

- Current grounding: MCP entrypoint is `tools/mcp-server.js` (custom JSON-RPC framing via `tools/mcp/transport.js`), with tool defs in `src/integrations/mcp/defs.js` and protocol helpers in `src/integrations/mcp/protocol.js`.
- This phase must keep existing tools functioning while adding SDK mode, and it must not silently accept inputs that do nothing.

---

### 12.1 Dependency strategy and capability gating for the official MCP SDK

- [ ] Decide how the MCP SDK is provided and make the decision explicit in code + docs.
  - Options:
    - [ ] Dependency (always installed)
    - [ ] Optional dependency (install attempted; failures tolerated)
    - [ ] External optional peer (default; capability-probed)
  - [ ] Implement the chosen strategy consistently:
    - [ ] `package.json` (if dependency/optionalDependency is chosen)
    - [ ] `src/shared/capabilities.js` (probe `@modelcontextprotocol/sdk` and report clearly)
    - [ ] `src/shared/optional-deps.js` (ensure `tryImport()` handles ESM correctly for the SDK)

- [ ] Ensure MCP server mode selection is observable and capability-gated.
  - Touchpoints:
    - [ ] `tools/mcp-server.js` — entrypoint dispatch
    - [ ] `tools/config-dump.js` (or MCP status tool) — report effective MCP mode + SDK availability

#### Tests / Verification

- [ ] Unit: capabilities probe reports `mcp.sdk=true/false` deterministically.
- [ ] CI verification: when SDK is absent, SDK-mode tests are skipped cleanly with a structured reason.

---

### 12.2 SDK-backed MCP server (parallel mode with explicit cutover flag)

- [ ] Implement an SDK-backed server alongside the legacy transport.
  - Touchpoints:
    - [ ] `tools/mcp-server-sdk.js` (new) — SDK-backed server implementation
    - [ ] `tools/mcp-server.js` — dispatch `--mcp-mode legacy|sdk` (or env var), defaulting to legacy until parity is proven
  - [ ] Requirements for SDK server:
    - [ ] Register tools from `src/integrations/mcp/defs.js` as the source of truth.
    - [ ] Route tool calls to the existing implementations in `tools/mcp/tools.js` (no behavior fork).
    - [ ] Support stdio transport as the baseline.
    - [ ] Emit a capabilities payload that allows clients to adapt (e.g., doc extraction disabled, SDK missing, etc.).

- [ ] Add a deprecation window for the legacy transport.
  - [ ] Document the cutover plan and timeline in `docs/mcp.md`.
  - [ ] Keep legacy transport only until SDK parity tests are green, then remove or hard-deprecate with warnings.

#### Tests / Verification

- [ ] Services: `tests/services/mcp/sdk-mode.services.js` (new)
  - Skip if SDK is not installed.
  - Start `tools/mcp-server-sdk.js` and run at least:
    - `tools/list`
    - one representative `tools/call` (e.g., `index_status`)
  - Assert: response shape is valid, errors have stable codes, and server exits cleanly.

---

### 12.3 Tool schema versioning, conformance, and drift guards

- [ ] Make tool schemas explicitly versioned and enforce bump discipline.
  - Touchpoints:
    - [ ] `src/integrations/mcp/defs.js` — add `schemaVersion` (semver or monotonic integer) and `toolingVersion`
    - [ ] `docs/mcp.md` — document compatibility rules for schema changes

- [ ] Consolidate MCP argument → execution mapping to one audited path.
  - Touchpoints:
    - [ ] `tools/mcp/tools.js` (search/build tools)
    - [ ] `src/integrations/core/index.js` (shared arg builder, if used)
  - [ ] Create a single mapping function per tool (or a shared builder) so schema additions cannot be “accepted but ignored”.

- [ ] Conformance requirement for the `search` tool:
  - [ ] Every field in the MCP `search` schema must either:
    - [ ] affect emitted CLI args / search execution, or
    - [ ] be removed from schema, or
    - [ ] be explicitly marked “reserved” and rejected if set.
  - [ ] Avoid duplicative builders (do not maintain two separate lists of flags).

- [ ] Fix known MCP tool wiring correctness hazards in modified files:
  - [x] In `tools/mcp/tools.js`, remove variable shadowing that breaks cancellation/AbortSignal handling (numeric arg is now `contextLines`; `context` remains the `{ signal }` object).

#### Tests / Verification

- [ ] Unit: `tests/unit/mcp-schema-version.unit.js` (new)
  - Assert `schemaVersion` exists.
  - Assert changes to tool defs require bumping `schemaVersion` (enforced by snapshot contract or explicit check).

- [ ] Unit: `tests/unit/mcp-search-arg-mapping.unit.js` (new)
  - For each supported schema field, assert mapping produces the expected CLI flag(s).
  - Include a negative test: unknown fields are rejected (or ignored only if policy says so, with an explicit warning).

- [ ] Update existing: `tests/mcp-schema.js`
  - Keep snapshotting tool property sets.
  - Add schemaVersion presence check.

---

### 12.4 Error codes, protocol negotiation, and response-shape consistency

- [ ] Standardize tool error payloads and map internal errors to stable MCP error codes.
  - Touchpoints:
    - [ ] `src/integrations/mcp/protocol.js` — legacy transport formatting helpers
    - [ ] `tools/mcp/transport.js` — legacy transport handler
    - [ ] `tools/mcp-server-sdk.js` — SDK error mapping
    - [ ] `src/shared/error-codes.js` — canonical internal codes
  - [ ] Define stable, client-facing codes (examples):
    - [ ] invalid args
    - [ ] index missing
    - [ ] tool timeout
    - [ ] not supported / capability missing
    - [ ] cancelled
  - [ ] Ensure both transports emit the same logical error payload shape (even if wrapper envelopes differ).

- [ ] Implement protocol/version negotiation and expose capabilities.
  - [ ] On `initialize`, echo supported protocol versions, the tool schema version, and effective capabilities.

#### Tests / Verification

- [ ] Unit: protocol negotiation returns consistent `protocolVersion` + `schemaVersion`.
- [ ] Regression: error payload includes stable `code` and `message` across both transports for representative failures.

---

### 12.5 Cancellation, timeouts, and process hygiene (no leaked work)

- [ ] Ensure cancellation/timeout terminates underlying work within a bounded time.
  - Touchpoints:
    - [ ] `tools/mcp/transport.js`
    - [ ] `tools/mcp/runner.js`
    - [ ] `tools/mcp/tools.js`
  - [ ] Cancellation correctness:
    - [ ] Canonicalize JSON-RPC IDs for in-flight tracking (`String(id)`), so numeric vs string IDs do not break cancellation.
    - [ ] Ensure `$/cancelRequest` cancels the correct in-flight request and that cancellation is observable (result marked cancelled, no “success” payload).
  - [ ] Timeout correctness:
    - [ ] Extend `runNodeAsync()` to accept an `AbortSignal` and kill the child process (and its process tree) on abort/timeout.
    - [ ] Thread AbortSignal through `runToolWithProgress()` and any spawned-node tool helpers.
    - [ ] Ensure `withTimeout()` triggers abort and does not merely reject while leaving work running.
  - [ ] Progress notification hygiene:
    - [x] Throttle/coalesce progress notifications (max ~1 per 250ms per tool call, coalesced) to avoid overwhelming clients.

- [ ] Tighten MCP test process cleanup.
  - [ ] After sending `shutdown`/`exit`, explicitly await server process termination (bounded deadline, then kill) to prevent leaked subprocesses during tests.

#### Tests / Verification

- [ ] Update existing: `tests/mcp-robustness.js`
  - Add “wait for exit” after `exit` (bounded).
  - Add cancellation test:
    - Start a long-ish operation, send `$/cancelRequest`, assert the tool response is cancelled and that work stops (no continuing progress after cancellation).
  - Add progress-throttle assertion (if practical): bursty progress is coalesced.

- [ ] Unit: `tests/unit/mcp-runner-abort-kills-child.unit.js` (new)
  - Spawn a child that would otherwise run long; abort; assert child exit occurs quickly and no orphan remains.

---

### 12.6 Documentation and migration notes

- [ ] Add `docs/mcp.md` (new) describing:
  - [ ] how to run legacy vs SDK server modes
  - [ ] how to install/enable the SDK (per the chosen dependency strategy)
  - [ ] tool schemas and `schemaVersion` policy
  - [ ] stable error codes and cancellation/timeout semantics
  - [ ] capability reporting and expected client behaviors

**Mapping (source docs, minimal):** `GIGAMAP_FINAL_UPDATED.md` (M12), `GIGAMAP_ULTRA_2026-01-22_FULL_COVERAGE_v3.md` (M12 overlap notes), `CODEBASE_STATIC_REVIEW.md` (MCP schema mapping), `GIGASWEEP.md` (MCP timeout/cancellation/progress/test cleanup)


---

## Phase 13 — SCM Provider Abstraction (Git Migration) + JJ Provider

### Objective

Make SCM integration **pluggable and explicit** so indexing and incremental workflows can run against:

- Git repos (current default)
- Jujutsu (`jj`) repos (Phase 13 deliverable)
- Non-SCM directories (filesystem-only; reduced provenance but still indexable)

This phase introduces an **SCM provider interface**, migrates all Git behavior onto that interface, then implements a JJ provider using the same contract. The result is a single, coherent place to reason about: tracked file discovery, repo provenance, per-file metadata (churn / blame), and “changed files” queries used by incremental reuse.

Authoritative specs to align with (existing in repo):
- `docs/specs/scm-provider-config-and-state-schema.md`
- `docs/specs/jj-provider-commands-and-parsing.md`

---

### Exit criteria (must all be true)

- [ ] There is a single SCM provider interface used everywhere (no direct `git`/`jj` shelling from random modules).
- [ ] `indexing.scm.provider` is supported: `auto | git | jj | none` (default: `auto`).
- [ ] Git provider is fully migrated onto the interface and remains the default when `.git/` exists.
- [ ] JJ provider supports (at minimum): repo detection, tracked-file enumeration, and repo “head” provenance recorded in `build_state.json`.
- [ ] When no SCM is present (or `provider=none`), indexing still works using filesystem discovery, but provenance fields are explicitly `null` / unavailable (no silent lies).
- [ ] Build signatures and cache keys include SCM provenance in a **stable** and **portable** way (no locale-dependent sorting).
- [ ] Tests cover provider selection + the most failure-prone parsing paths; CI can run without `jj` installed.

---

### Phase 13.1 — Introduce `ScmProvider` interface + registry + config/state schema wiring

- [ ] Create a new module boundary for SCM operations:
  - [ ] `src/index/scm/types.js` (new) — shared types and normalized shapes
  - [ ] `src/index/scm/provider.js` (new) — interface contract + docs-in-code
  - [ ] `src/index/scm/registry.js` (new) — provider selection (`auto|git|jj|none`)
  - [ ] `src/index/scm/providers/none.js` (new) — filesystem-only provider (no provenance; uses existing fdir fallback)
  - [ ] `src/index/scm/providers/git.js` (new) — migrated in 13.2
  - [ ] `src/index/scm/providers/jj.js` (new) — implemented in 13.3

- [ ] Define the **canonical provider contract** (minimal required surface):
  - [ ] `detect({ startPath }) -> { ok:true, repoRoot, provider } | { ok:false }`
  - [ ] `listTrackedFiles({ repoRoot, subdir? }) -> { filesPosix: string[] }`
  - [ ] `getRepoProvenance({ repoRoot }) -> { provider, root, head, dirty, branch/bookmarks?, detectedBy? }`
  - [ ] `getChangedFiles({ repoRoot, fromRef, toRef, subdir? }) -> { filesPosix: string[] }` (may be “not supported” for `none`)
  - [ ] `getFileMeta({ repoRoot, filePosix }) -> { churn?, lastCommitId?, lastAuthor?, lastModifiedAt? }` (best-effort; may be disabled)
  - [ ] Optional (capability-gated): `annotate({ repoRoot, filePosix, timeoutMs }) -> { lines:[{ line, author, commitId, ... }] }`

- [ ] Config keys (align to `docs/specs/scm-provider-config-and-state-schema.md`):
  - [ ] `indexing.scm.provider: auto|git|jj|none`
  - [ ] `indexing.scm.timeoutMs`, `indexing.scm.maxConcurrentProcesses`
  - [ ] `indexing.scm.annotate.enabled`, `maxFileSizeBytes`, `timeoutMs`
  - [ ] `indexing.scm.jj.snapshotWorkingCopy` safety default (read-only by default)

- [ ] Build-state schema updates:
  - [ ] Extend `build_state.json` `repo` field to include:
    - [ ] `repo.provider`
    - [ ] normalized `repo.head` object (provider-specific fields nested, but stable keys)
    - [ ] `repo.dirty` boolean (best-effort)
  - [ ] Keep Git back-compat fields where feasible (`repo.commit`, `repo.branch`) but treat `repo.provider` + `repo.head.*` as authoritative.

Touchpoints:
- `docs/specs/scm-provider-config-and-state-schema.md` (align / correct examples if needed)
- `src/index/build/build-state.js` (repo provenance shape)
- `src/index/build/indexer/signatures.js` (include SCM provenance in build signatures)
- `src/index/build/runtime/runtime.js` (thread config into runtime)
- `docs/config/schema.json` (document `indexing.scm.*` keys)

#### Tests / verification
- [ ] `tests/unit/scm-provider-selection.unit.js` (new)
  - [ ] `auto` selects `git` when `.git/` exists and git is runnable.
  - [ ] `auto` selects `jj` when `.jj/` exists and `jj` is runnable.
  - [ ] `auto` falls back to `none` when neither exists (or binaries missing).
- [ ] `tests/unit/build-state-repo-provenance.unit.js` (new)
  - [ ] `build_state.json` includes `repo.provider` and normalized `repo.head`.

---

### Phase 13.2 — Migrate Git onto the provider interface

- [ ] Implement `GitProvider` by **wrapping and consolidating** existing Git logic:
  - [ ] Move/merge logic from:
    - [ ] `src/index/git.js` (provenance + meta helpers)
    - [ ] `src/index/build/discover.js` (`git ls-files` discovery)
  - [ ] Ensure there is exactly one “source of truth” for:
    - [ ] repo root resolution
    - [ ] tracked file enumeration (`git ls-files -z`)
    - [ ] dirty check
    - [ ] head SHA + branch name

- [ ] Remove direct Git shelling from non-provider modules:
  - [ ] `src/index/build/discover.js` should call `ScmProvider.listTrackedFiles()` when an SCM provider is active, else use filesystem crawl (current behavior).
  - [ ] Any provenance used for metrics/signatures must route through `ScmProvider.getRepoProvenance()`.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/git.js` (migrate or reduce to GitProvider internals)
- `src/index/scm/providers/git.js` (new)
- `src/index/scm/registry.js`

#### Tests / verification
- [ ] `tests/services/index-build-git-provider.services.js` (new)
  - [ ] Build index inside a git repo and assert:
    - [ ] `build_state.json.repo.provider === "git"`
    - [ ] tracked file discovery returns only git-tracked files (plus explicit records-dir behavior if enabled)

---

### Phase 13.3 — Implement JJ provider (read-only default, robust parsing)

- [ ] Implement `JjProvider` using `jj` CLI (no library dependency):
  - [ ] Detection:
    - [ ] find `.jj/` root
    - [ ] validate `jj --version` runnable (capability gating)
  - [ ] Tracked files:
    - [ ] `jj file list --tracked -0` (prefer NUL delim where available)
  - [ ] Repo provenance:
    - [ ] resolve a stable head reference (commitId + changeId where available)
    - [ ] record bookmarks (best-effort)
    - [ ] `dirty` best-effort (explicitly document semantics)

- [ ] Safety default: read-only by default
  - [ ] When `indexing.scm.jj.snapshotWorkingCopy=false`:
    - [ ] run JJ commands with `--ignore-working-copy` and `--at-op=@` (per spec)
  - [ ] If enabled:
    - [ ] allow exactly one controlled snapshot at start (and pin subsequent commands to that op)
    - [ ] record the pinned op id in build state (so provenance is reproducible)

- [ ] Implement changed-files support (for incremental reuse):
  - [ ] Provide `getChangedFiles()` based on the spec in `docs/specs/jj-provider-commands-and-parsing.md`.
  - [ ] Normalize to **repo-root-relative POSIX paths**.

Touchpoints:
- `docs/specs/jj-provider-commands-and-parsing.md` (align with implementation)
- `src/index/scm/providers/jj.js` (new)
- `src/index/scm/providers/jj-parse.js` (new: isolated parsing helpers)
- `src/index/build/indexer/signatures.js` (include JJ head/changeId + op pin when used)

#### Tests / verification
- [ ] Unit: parsing helpers
  - [ ] `tests/unit/jj-changed-files-parse.unit.js`
  - [ ] `tests/unit/jj-head-parse.unit.js`
- [ ] CI behavior:
  - [ ] if `jj` missing, JJ tests skip (exit code 77) with a clear message.

---

### Phase 13.4 — CLI + tooling visibility (make SCM selection obvious)

- [ ] CLI flags (override config, optional but recommended):
  - [ ] `pairofcleats index build --scm-provider <auto|git|jj|none>`
  - [ ] `pairofcleats index build --scm-annotate / --no-scm-annotate`

- [ ] Surface effective provider + provenance in diagnostics:
  - [ ] `pairofcleats tooling doctor --json` should include:
    - provider selected
    - repo root
    - head id(s)
    - whether annotate is enabled

Touchpoints:
- `bin/pairofcleats.js` (flag plumbing)
- `src/shared/cli-options.js` (new flags)
- `tools/tooling-doctor.js` (report SCM provider)

---

### Phase 13.5 — Non-repo environments (explicitly supported)

- [ ] Make filesystem-only behavior first-class:
  - [ ] If `provider=none` (or auto selects none):
    - [ ] file discovery uses filesystem crawl (current fallback)
    - [ ] build state records `repo.provider="none"` and `repo.head=null`
    - [ ] incremental reuse features that require SCM provenance must be disabled with an explicit reason (no silent partial behavior)
  - [ ] Document this mode as “try it anywhere” for non-code/non-repo folders.

Touchpoints:
- `src/index/scm/providers/none.js` (new)
- `docs/` (add a short section in `docs/indexing.md` or `docs/scm.md`)

#### Tests / verification
- [ ] `tests/services/index-build-no-scm.services.js` (new)
  - [ ] Build index in a temp folder without `.git/` and assert build succeeds and provenance is explicitly null.

## Phase 14 — Incremental Diffing & Snapshots (Time Travel, Regression Debugging)

### Objective

Introduce **first-class snapshot and diff artifacts** so we can:

- Query indexes **“as-of” a prior build** (time-travel).
- Generate deterministic **“what changed”** artifacts between two index states.
- Support regression debugging, release auditing, and safe incremental reuse.

This phase establishes:

> **Authoritative spec**: the on-disk layout, ID conventions, and resolution rules for this phase are already refined in:
> - `docs/phases/phase-14/index-refs-and-snapshots.md` (snapshot registry + IndexRef)
> - `docs/phases/phase-14/index-diffs.md` (diff schemas + deterministic event stream)
>
> This roadmap section must stay aligned with those specs (notably: snapshot IDs are `snap-*` and diff IDs are `diff_*`).

- **Pointer snapshots** (cheap metadata references to validated builds).
- **Frozen snapshots** (immutable, self-contained archival copies).
- **Diff artifacts** (bounded, deterministic change sets + summaries).


### 14.1 Snapshot & diff artifact surface (contracts, retention, safety)

- [ ] Define the on-disk **public artifact surface** under each repo cache root:
  - [ ] `snapshots/manifest.json` — snapshot registry (authoritative index of snapshots)
  - [ ] `snapshots/<snapshotId>/snapshot.json` — immutable per-snapshot metadata record (optional but recommended)
  - [ ] `snapshots/<snapshotId>/frozen/index-<mode>/...` — frozen snapshot index roots (immutable copies)
  - [ ] `diffs/manifest.json` — diff registry (authoritative index of diffs)
  - [ ] `diffs/<diffId>/summary.json` — bounded diff summary (always present)
  - [ ] `diffs/<diffId>/index_diff.jsonl` — optional, bounded event stream (may be truncated)

- [ ] Standardize **ID + naming rules**:
  - [ ] Snapshot IDs: `snap-YYYYMMDD-HHMMSS-<shortid>` (default) plus optional user `label`
  - [ ] Diff IDs: `diff_<sha256><shortid>` (default)
  - [ ] Ensure IDs are filesystem-safe.
  - [ ] Ensure deterministic ordering for registry output (sort by `createdAt`, then `id`).

- [ ] Define snapshot registry entry schema (minimum fields):
  - [ ] `id`, `type` (`pointer` | `frozen`), `createdAt`
  - [ ] `label` (nullable), `tags` (string[])
  - [ ] `buildId` (from `build_state.json`), `configHash`, `toolVersion`
  - [ ] `buildRoot` (repo-cache-relative path), plus `modeBuildRoots` map (`mode -> repo-cache-relative index root`)
  - [ ] `repoProvenance` (best-effort: SCM provider + revision/branch if available)
  - [ ] `integritySummary` (best-effort counts + size estimates + `validatedAt` timestamp)
  - [ ] Optional future-proof fields (schema allows but does not require): `workspaceId`, `namespaceKey`
    - Defer multi-repo/workspace orchestration to **Phase 15 — Federation & Multi-Repo**.

- [ ] Define diff registry entry schema (minimum fields):
  - [ ] `id`, `createdAt`, `from` + `to` refs (snapshotId/buildId/indexRootRef), `modes`
  - [ ] `summaryPath` and optional `eventsPath`
  - [ ] `truncated` flag + truncation metadata (`maxEvents`, `maxBytes`)
  - [ ] `compat` block capturing `from.configHash` vs `to.configHash` and `toolVersion` mismatches.

- [ ] Make registries **atomic and crash-safe**:
  - [ ] Use atomic write (temp + rename) and stable JSON output.
  - [ ] Avoid partial registry writes leaving corrupt JSON (registry must always be readable or rolled back).
  - [ ] If using per-snapshot `snapshots/<id>/snapshot.json`, write it first, then append to `snapshots/manifest.json`.

- [ ] Add **retention policy knobs** (defaults tuned for safety):
  - [ ] `indexing.snapshots.maxPointerSnapshots` (default: 25)
  - [ ] `indexing.snapshots.maxFrozenSnapshots` (default: 10)
  - [ ] `indexing.snapshots.retainDays` (default: 30)
  - [ ] `indexing.diffs.maxDiffs` (default: 50)
  - [ ] `indexing.diffs.retainDays` (default: 30)
  - [ ] `indexing.diffs.maxEvents` / `indexing.diffs.maxBytes` (bounded output)
  - [ ] Retention must respect tags (e.g., `release` is never deleted automatically).

- [ ] Enforce **path safety** for all snapshot/diff paths:
  - [ ] Treat all registry paths as repo-cache-relative.
  - [ ] Refuse any `buildRoot` / `modeBuildRoots` values that escape the repo cache root (no `..`, no absolute paths).
  - [ ] Refuse snapshot/diff output dirs if they escape the repo cache root.

- [ ] Integrate **validation gating semantics** into the contract:
  - [ ] Pointer snapshots may only reference builds that passed index validation (see Phase 14.2).
  - [ ] Frozen snapshots must be self-contained and re-validatable.

Touchpoints:
- `src/index/snapshots/**` (new)
- `src/index/diffs/**` (new)
- `src/shared/artifact-schemas.js` (add AJV validators for `snapshots/manifest.json`, `diffs/manifest.json`, `diffs/*/summary.json`)
- `docs/` (new: `docs/snapshots-and-diffs.md`; update public artifact surface docs if present)

#### Tests
- [ ] `tests/unit/snapshots-registry.unit.js`
  - [ ] Registry schema validation (valid/invalid cases)
  - [ ] Atomic update behavior (simulate interrupted write; registry remains readable)
  - [ ] Path safety (reject absolute paths and `..` traversal)
- [ ] `tests/unit/diffs-registry.unit.js`
  - [ ] Schema validation + bounded/truncation metadata correctness


### 14.2 Pointer snapshots (creation, validation gating, CLI/API)

- [ ] Implement pointer snapshot creation:
  - [ ] Resolve repo cache root and current build roots from `builds/current.json`.
  - [ ] Load `build_state.json` from the current build root (for `buildId`, `configHash`, `toolVersion`, and provenance).
  - [ ] Require a successful artifact validation signal before snapshotting:
    - [ ] Preferred: consume a persisted validation report if present.
    - [ ] Otherwise: run validation on-demand against each mode index root.
  - [ ] Refuse snapshot creation when builds are incomplete:
    - [ ] If an index mode is missing required artifacts, fail.
    - [ ] If embeddings/risk passes are still pending for a mode, fail unless explicitly overridden (`--allow-incomplete`, default false).
  - [ ] Materialize snapshot entry with:
    - [ ] `buildRoot` + `modeBuildRoots` captured as **repo-cache-relative** paths.
    - [ ] `integritySummary` populated from validation output + minimal artifact counts.
  - [ ] Write immutable per-snapshot metadata (optional but recommended):
    - [ ] `snapshots/<snapshotId>/snapshot.json` (write atomically).
    - [ ] Keep the registry entry minimal and link to the per-snapshot record if desired.
  - [ ] Append entry to `snapshots/manifest.json` atomically.
  - [ ] Apply retention after creation (delete oldest pointer snapshots unless tagged).

- [ ] Add CLI surface:
  - [ ] `pairofcleats index snapshot create [--label <label>] [--tags <csv>] [--modes <csv>] [--allow-incomplete]`
  - [ ] `pairofcleats index snapshot list [--json]`
  - [ ] `pairofcleats index snapshot show <snapshotId> [--json]`
  - [ ] `pairofcleats index snapshot rm <snapshotId> [--force]`

- [ ] Add API surface (optional but recommended for UI/MCP parity):
  - [ ] `GET /index/snapshots` (list)
  - [ ] `GET /index/snapshots/:id` (show)
  - [ ] `POST /index/snapshots` (create)
  - [ ] Ensure endpoints never expose absolute filesystem paths.

- [ ] Sweep-driven hardening for snapshot creation:
  - [ ] When reading `builds/current.json`, treat any buildRoot that escapes repo cache root as **invalid** and refuse snapshotting.
  - [ ] Ensure snapshot manifest writes are atomic and do not corrupt on crash.

Touchpoints:
- `bin/pairofcleats.js` (new subcommands)
- `tools/index-snapshot.js` (new CLI implementation)
- `src/index/snapshots/registry.js` (new)
- `src/index/snapshots/validate-source.js` (new: shared logic to validate a build root before snapshotting)
- `tools/api/**` (if API endpoints added)

#### Tests
- [ ] `tests/services/snapshot-create.services.js`
  - [ ] Build an index; create a pointer snapshot; assert registry entry exists and references current build.
  - [ ] Fail creation when artifacts are missing or validation fails.
  - [ ] `--modes` subset only snapshots those modes.
  - [ ] Retention deletes oldest untagged pointer snapshots.


### 14.3 Frozen snapshots (immutable copies + integrity verification)

- [ ] Implement snapshot freeze operation:
  - [ ] `pairofcleats index snapshot freeze <snapshotId>`
  - [ ] Preconditions:
    - [ ] Snapshot exists and is `pointer` (or already `frozen` → no-op / error depending on flags).
    - [ ] Referenced build roots exist and are readable.
  - [ ] Copy the snapshot’s index artifacts into:
    - [ ] `snapshots/<snapshotId>/frozen/index-<mode>/...`
  - [ ] Copy strategy:
    - [ ] Use `pieces/manifest.json` from each mode’s index root as the authoritative list of files to copy.
    - [ ] Prefer hardlinking (same filesystem) when safe; otherwise copy bytes.
    - [ ] Always copy metadata (`index_state.json`, `pieces/manifest.json`, and any required build metadata files).
  - [ ] Integrity verification:
    - [ ] Verify copied pieces against `pieces/manifest.json` checksums.
    - [ ] Re-run index validation against the frozen index roots.
  - [ ] Atomicity:
    - [ ] Freeze into a temp directory and rename into place only after verification.
  - [ ] Update `snapshots/manifest.json`:
    - [ ] Flip `type` to `frozen`.
    - [ ] Update `buildRoot` / `modeBuildRoots` to point at the frozen roots.
    - [ ] Preserve the original `buildId` / provenance; record `frozenFromBuildId` if useful.

- [ ] Add supporting maintenance commands:
  - [ ] `pairofcleats index snapshot gc [--dry-run]` (enforce retention; never delete `release`-tagged snapshots)

Touchpoints:
- `tools/index-snapshot.js` (freeze + gc)
- `src/index/snapshots/freeze.js` (new)
- `src/index/snapshots/copy-pieces.js` (new; copy/hardlink logic)

#### Tests
- [ ] `tests/services/snapshot-freeze.services.js`
  - [ ] Create pointer snapshot → freeze → validate frozen index roots succeed.
  - [ ] Ensure freeze is atomic (simulate failure mid-copy → no partial frozen dir is considered valid).
  - [ ] Ensure frozen snapshot remains usable after deleting the original build root.


### 14.4 Deterministic diff computation (bounded, machine-readable)

- [ ] Implement diff computation between two index states:
  - [ ] CLI: `pairofcleats index diff --from <snapshotId|buildId|path> --to <snapshotId|buildId|path> [--modes <csv>]`
  - [ ] Resolve `from` and `to` to per-mode index roots (snapshot pointer, snapshot frozen, or explicit indexRoot).
  - [ ] Refuse or annotate mismatches:
    - [ ] If `configHash` differs, require `--allow-mismatch` or mark output as “non-comparable”.
    - [ ] If `toolVersion` differs, annotate (diff still possible but less trustworthy).

- [ ] Define diff output formats:
  - [ ] Always write `diffs/<diffId>/summary.json` (bounded):
    - [ ] counts of adds/removes/changes by category
    - [ ] `truncated` boolean + reason
    - [ ] `from`/`to` metadata (snapshot IDs, build IDs, createdAt)
  - [ ] Optionally write `diffs/<diffId>/index_diff.jsonl` (bounded stream):
    - [ ] `file_added | file_removed | file_changed` (path + old/new hash)
    - [ ] `chunk_added | chunk_removed | chunk_changed`:
      - [ ] stable `chunkId` from `metaV2.chunkId`
      - [ ] minimal before/after summary (`file`, `segment`, `kind`, `name`, `start/end`), plus optional `semanticSig` (hash of normalized docmeta/metaV2 subset)
    - [ ] `graph_edge_added | graph_edge_removed` (graph name + from/to node IDs)
    - [ ] Allow future event types (symbols/contracts/risk) without breaking old readers.

- [ ] Implement deterministic diffing rules:
  - [ ] Stable identity:
    - [ ] Files keyed by repo-relative path.
    - [ ] Chunks keyed by `metaV2.chunkId` (do **not** rely on numeric `chunk_meta.id`).
    - [ ] Graph edges keyed by `(graph, fromId, toId)`.
  - [ ] Stable ordering:
    - [ ] Sort events by `(type, key)` so repeated runs produce byte-identical outputs.
  - [ ] Boundedness:
    - [ ] Enforce `indexing.diffs.maxEvents` and `indexing.diffs.maxBytes`.
    - [ ] If exceeded, stop emitting events and mark summary as truncated; include category counts.

- [ ] Integrate diff generation into incremental build (optional but recommended):
  - [ ] After a successful build+promotion, compute a diff vs the previous “latest” snapshot/build.
  - [ ] Use incremental state (manifest) to compute file-level changes in O(changed) where possible.
  - [ ] Emit diffs only after strict validation passes (so diffs don’t encode broken builds).
  - [ ] Store the diff under `diffs/<diffId>/...` and append to `diffs/manifest.json` (do **not** mix diffs into buildRoot without a strong reason).

- [ ] Sweep-driven hardening for incremental reuse/diff correctness (because this phase touches incremental state):
  - [ ] Before reusing an “unchanged” incremental build, verify required artifacts exist (use `pieces/manifest.json` as the authoritative inventory).
    - [ ] If any required piece is missing/corrupt, disable reuse and force rebuild.
  - [ ] Ensure incremental cache invalidation is tied to a complete signature:
    - [ ] Include artifact schema hash + tool version + key feature flags in the incremental signature.
    - [ ] Include diff/snapshot emission toggles so changing these settings invalidates reuse.

Touchpoints:
- `tools/index-diff.js` (new CLI implementation)
- `src/index/diffs/compute.js` (new)
- `src/index/diffs/events.js` (new; event schema helpers + deterministic ordering)
- `src/index/diffs/registry.js` (new)
- `src/index/build/incremental.js` (reuse validation + signature binding improvements)
- `src/index/build/indexer/steps/incremental.js` (optional: emit diffs post-build)

#### Tests
- [ ] `tests/services/index-diff.services.js`
  - [ ] Build snapshot A; modify repo; build snapshot B; compute diff A→B.
  - [ ] Assert file_changed appears for modified file.
  - [ ] Assert chunk changes use `metaV2.chunkId` and are stable across runs.
  - [ ] Assert ordering is deterministic (byte-identical `index_diff.jsonl`).
  - [ ] Assert truncation behavior when `maxEvents` is set low.
- [ ] `tests/storage/sqlite/incremental/index-reuse-validation.services.js`
  - [ ] Corrupt/remove a required artifact and verify incremental reuse is refused.


### 14.5 Retrieval + tooling integration: “as-of” snapshots and “what changed” surfaces

- [ ] Add snapshot targeting to retrieval/search:
  - [ ] Extend search CLI args with `--snapshot <snapshotId>` / `--as-of <snapshotId>`.
  - [ ] Resolve snapshot → per-mode index roots via `snapshots/manifest.json`.
  - [ ] Ensure `--snapshot` never leaks absolute paths (logs + JSON output must stay repo-relative).

- [ ] Add diff surfacing commands for humans and tools:
  - [ ] `pairofcleats index diff list [--json]`
  - [ ] `pairofcleats index diff show <diffId> [--format summary|jsonl]`
  - [ ] `pairofcleats index diff explain <diffId>` (human-oriented summary + top changed files)

- [ ] Extend “secondary index builders” to support snapshots:
  - [ ] SQLite build: accept `--snapshot <snapshotId>` / `--as-of <snapshotId>` and resolve it to `--index-root`.
    - [ ] Ensure the SQLite build can target frozen snapshots as well as pointer snapshots (as long as artifacts still exist).
  - [ ] Validate tool: document `pairofcleats index validate --index-root <frozenSnapshotIndexRoot>` workflow (no new code required if `--index-root` already supported).

- [ ] Add API surface (optional but recommended):
  - [ ] `GET /index/diffs` (list)
  - [ ] `GET /index/diffs/:id` (summary)
  - [ ] `GET /index/diffs/:id/events` (JSONL stream; bounded)
  - [ ] `GET /search?snapshotId=...` (search “as-of” a snapshot)

- [ ] Sweep-driven hardening for retrieval caching (because this phase touches retrieval index selection):
  - [ ] Ensure query cache keys include the snapshotId (or resolved buildId) so results cannot bleed across snapshots.
  - [ ] Fix retrieval index signature calculation to account for sharded artifacts (see tests below).

Touchpoints:
- `src/retrieval/cli-args.js` (add `--snapshot/--as-of`)
- `src/retrieval/cli.js` (thread snapshot option through)
- `src/retrieval/cli-index.js` (resolve index dir via snapshot; update query cache signature)
- `src/shared/artifact-io.js` (add signature helpers for sharded artifacts)
- `bin/pairofcleats.js` (CLI wiring)
- `tools/build-sqlite-index/cli.js` + `tools/build-sqlite-index/run.js` (add `--snapshot/--as-of`)
- `tools/api/**` (if API endpoints added)

#### Tests
- [ ] `tests/services/snapshot-query.services.js`
  - [ ] Build snapshot A; modify repo; build snapshot B.
  - [ ] Run the same query against `--snapshot A` and `--snapshot B`; assert results differ as expected.
  - [ ] Assert “latest” continues to resolve to the current build when no snapshot is provided.
- [ ] `tests/unit/retrieval-index-signature-shards.unit.js`
  - [ ] Create a fake index dir with `chunk_meta.meta.json` + `chunk_meta.parts/*`.
  - [ ] Assert the index signature changes when any shard changes.
- [ ] `tests/services/sqlite-build-snapshot.services.js`
  - [ ] Build snapshot A.
  - [ ] Run `pairofcleats lmdb build` / `pairofcleats sqlite build` equivalents with `--snapshot A`.
  - [ ] Assert output DB is produced and corresponds to that snapshot’s artifacts.


### Phase 14 — Source mapping (minimal)

- `PAIR_OF_CLEATS_ROADMAP_PH01_TO_PH19_MASTER_UPDATED.md` — PH-11 tasks T01–T05 (snapshot registry, pointer snapshots, freeze, deterministic diffs, retrieval integration).
- `PAIR_OF_CLEATS_FUN_EXTRA_IDEAS_MASTER_UPDATED.md` — concrete `index_diff.jsonl` and `diff_summary.json` format + CLI/API examples.
- `MULTIREPO_FED.md` — snapshot/diff/time-travel as a core primitive; workspace-aware future-proof fields (deferred orchestration).
- `GIGAMAP_FINAL_UPDATED.md` — milestone M10 snapshotting/diffing file touchpoints (incremental integration, loader `--snapshot`, snapshot selection for secondary builders like SQLite).
- `GIGASWEEP.md` — required hardening when touching incremental reuse + retrieval query-cache signatures (sharded `chunk_meta` coverage, reuse validation).


---

## Phase 15 — Federation & Multi-Repo (Workspaces, Catalog, Federated Search)

### Objective

Enable first-class *workspace* workflows: index and query across **multiple repositories** in a single operation (CLI/API/MCP), with correct cache keying, compatibility gating, deterministic result merging, and shared cache reuse. The system must be explicit about repo identity and index compatibility so multi-repo results are reproducible, debuggable, and safe by default.

### 15.1 Workspace configuration, repo identity, and repo-set IDs

> **Authoritative spec**: Workspace config format is already defined in `docs/specs/workspace-config.md` (file name: `.pairofcleats-workspace.jsonc`, `schemaVersion: 1`, strict keys, and normalization rules).  
> This roadmap section is aligned to that spec; if the spec changes, update this phase doc (not the other way around).

- [ ] Define a **workspace configuration file** (JSONC-first) that enumerates repos (selection + labels) and is strict/portable. Per-repo build overrides are **explicitly out of scope** for `schemaVersion: 1` (defer to a future schemaVersion).
  - [ ] Recommended default name/location: `.pairofcleats-workspace.jsonc` at a chosen “workspace root” (not necessarily a repo root).
  - [ ] Include minimally:
    - [ ] `schemaVersion`
    - [ ] `name` (human-friendly)
    - [ ] `repos: [{ root, alias?, tags?, enabled?, priority? }]`
    - [ ] Optional: `cacheRoot` (shared cache root override)
    - [ ] Optional: `defaults` (applied to all repos unless overridden)
  - [ ] Document that **repo roots** may be specified as:
    - [ ] absolute paths
    - [ ] paths relative to the workspace file directory
    - [ ] (optional) known repo IDs / aliases (resolved via registry/catalog)

- [ ] Implement a workspace loader/validator that resolves workspace config into a canonical runtime structure.
  - [ ] Canonicalize each repo entry:
    - [ ] Resolve `root` to a **repo root** (not a subdirectory), using existing repo-root detection (`resolveRepoRoot` behavior) even when the user points at a subdir.
    - [ ] Canonicalize to **realpath** (symlink-resolved) where possible; normalize Windows casing consistently.
    - [ ] Compute `repoId` using the canonicalized root (and keep `repoRoot` as canonical path).
  - [ ] Enforce deterministic ordering for all “identity-bearing” operations:
    - [ ] Sort by `repoId` for hashing and cache keys.
    - [ ] Preserve `alias` (and original list position) only for display ordering when desired.

- [ ] Introduce a stable **repo-set identity** (`repoSetId`) for federation.
  - [ ] Compute as a stable hash over:
    - [ ] normalized workspace config (minus non-semantic fields like `name`)
    - [ ] sorted list of `{ repoId, repoRoot }`
  - [ ] Use stable JSON serialization (no non-deterministic key ordering).
  - [ ] Store `repoSetId` in:
    - [ ] the workspace manifest (see 15.2)
    - [ ] federated query cache keys (see 15.4)
    - [ ] any “workspace-level” directory naming under cacheRoot.

- [ ] Harden repo identity helpers so multi-repo identity is stable across callers.
  - [ ] Ensure `repoId` generation uses **canonical root semantics** consistently across:
    - API server routing (`tools/api/router.js`)
    - MCP repo resolution (`tools/mcp/repo.js`)
    - CLI build/search entrypoints
  - [ ] Ensure the repo cache root naming stays stable even when users provide different-but-equivalent paths.

**Touchpoints:**
- `tools/dict-utils.js` (repo root resolution, `getRepoId`, cacheRoot overrides)
- `src/shared/stable-json.js` (stable serialization for hashing)
- New: `src/workspace/config.js` (or `src/retrieval/federation/workspace.js`) — loader + validator + `repoSetId`

#### Tests

- [ ] Workspace config parsing accepts absolute and relative repo roots and produces canonical `repoRoot`.
- [ ] `repoSetId` is deterministic:
  - [ ] independent of repo list order in the workspace file
  - [ ] stable across runs/platforms for the same canonical set (Windows casing normalized)
- [ ] Canonicalization prevents duplicate repo entries that differ only by symlink/subdir pathing.

---

### 15.2 Workspace index catalog, discovery, and manifest

- [ ] Implement an **index catalog** that can discover “what is indexed” across a cacheRoot.
  - [ ] Scan `<cacheRoot>/repos/*/builds/current.json` (and/or current build pointers) to enumerate:
    - [ ] repoId
    - [ ] current buildId
    - [ ] available modes (code/prose/extracted-prose/records)
    - [ ] index directories and SQLite artifact paths
    - [ ] (when available) index compatibility metadata (compatibilityKey; see 15.3)
  - [ ] Treat invalid or unreadable `current.json` as **missing pointer**, not “keep stale state”.

- [ ] Define and generate a **workspace manifest** (`workspace_manifest.json`).
  - [ ] Write under `<cacheRoot>/federation/<repoSetId>/workspace_manifest.json` (or equivalent) so all federation artifacts are colocated.
  - [ ] Include:
    - [ ] `schemaVersion`, `generatedAt`, `repoSetId`
    - [ ] `repos[]` with `repoId`, `repoRoot`, `alias?`, `tags?`
    - [ ] For each repo: `buildId`, per-mode `indexDir`, per-mode `indexSignature` (or a compact signature hash), `sqlitePaths`, and `compatibilityKey`
    - [ ] Diagnostics: missing indexes, excluded modes, policy overrides applied
  - [ ] Ensure manifest generation is deterministic (stable ordering, stable serialization).

- [ ] Add workspace-aware build orchestration (multi-repo indexing) that can produce/refresh the workspace manifest.
  - [ ] Add `--workspace <path>` support to the build entrypoint (or add a dedicated `workspace build` command):
    - [ ] Build indexes per repo independently.
    - [ ] Ensure per-repo configs apply (each repo’s own `.pairofcleats.jsonc`), but workspace config v1 does **not** supply per-repo build overrides; mode selection remains a CLI concern.
    - [ ] Concurrency-limited execution (avoid N repos × M threads exploding resource usage).
  - [ ] Ensure workspace build uses a shared cacheRoot when configured, to maximize reuse of:
    - dictionaries/wordlists
    - model downloads
    - tooling assets
    - (future) content-addressed bundles (see 15.5)

**Touchpoints:**
- `tools/dict-utils.js` (cache root resolution, build pointer paths)
- `build_index.js` (add `--workspace` or create `workspace_build.js`)
- New: `src/workspace/catalog.js` (cacheRoot scanning)
- New: `src/workspace/manifest.js` (manifest writer/reader)

#### Tests

- [ ] Catalog discovery returns the same repo list regardless of filesystem directory enumeration order.
- [ ] Workspace manifest generation:
  - [ ] records accurate per-repo buildId and per-mode index paths
  - [ ] records compatibilityKey for each indexed mode (when present)
  - [ ] is stable/deterministic for the same underlying catalog state
- [ ] Invalid `builds/current.json` does not preserve stale build IDs in memory caches (treated as “pointer invalid”).

---

### 15.3 Federated search orchestration (CLI, API server, MCP)

- [ ] Add **federated search** capability that can query multiple repos in a single request.
  - [ ] CLI:
    - [ ] Add `pairofcleats search --workspace <path>` to query all repos in a workspace.
    - [ ] Support repeated `--repo <id|alias|path>` to target a subset.
    - [ ] Support `--repo-filter <glob|regex>` and/or `--tag <tag>` to select repos by metadata.
  - [ ] API server:
    - [ ] Add a federated endpoint or extend the existing search endpoint to accept:
      - [ ] `workspace` (workspace file path or logical id)
      - [ ] `repos` selection (ids/aliases/roots)
    - [ ] Apply the same repo-root allowlist enforcement as single-repo mode.
  - [ ] MCP:
    - [ ] Add workspace-aware search inputs (workspace + repo selection).
    - [ ] Ensure MCP search results include repo attribution (see below).

- [ ] Implement a federation coordinator (single orchestration layer) used by CLI/API/MCP.
  - [ ] Input: resolved workspace manifest + normalized search request (query, modes, filters, backend selection, scoring config).
  - [ ] Execution:
    - [ ] Fan out to per-repo search sessions with concurrency limits.
    - [ ] Enforce consistent “per-repo topK” before merging to keep cost bounded.
    - [ ] Collect structured warnings/errors per repo without losing overall response.
  - [ ] Output:
    - [ ] A single merged result list plus per-repo diagnostics.

- [ ] Enforce **multi-repo invariants** in federated output:
  - [ ] Every hit must include:
    - [ ] `repoId`
    - [ ] `repoRoot` (or a stable, display-safe alias)
    - [ ] `repoAlias` (if configured)
  - [ ] When paths collide across repos (same `relPath`), results must remain unambiguous.

- [ ] Define and implement deterministic merge semantics for federated results.
  - [ ] Prefer rank-based merging (RRF) at federation layer to reduce cross-index score comparability risk.
  - [ ] Deterministic tie-breakers (in order):
    - [ ] higher merged score / better rank
    - [ ] stable repo ordering (e.g., workspace display order or repoId order; choose one and document)
    - [ ] stable document identity (e.g., `chunkId` / stable doc key)
  - [ ] Explicitly document the merge policy in the output `meta` (so debugging is possible).

**Touchpoints:**
- `bin/pairofcleats.js` (CLI command surfaces)
- `src/integrations/core/index.js` (add `searchFederated()`; reuse `runSearchCli` per repo)
- `src/retrieval/cli.js`, `src/retrieval/cli-args.js` (workspace/repo selection flags and normalization)
- `tools/api/router.js` (federated endpoint plumbing)
- `tools/mcp/repo.js` / `tools/mcp-server.js` (workspace-aware tool inputs)
- New: `src/retrieval/federation/coordinator.js`
- New: `src/retrieval/federation/merge.js` (RRF + deterministic tie-breakers)

#### Tests

- [ ] Multi-repo fixture (two tiny repos) proves:
  - [ ] federated search returns results from both repos
  - [ ] results include repo attribution fields
  - [ ] collisions in `relPath` do not cause ambiguity
- [ ] Determinism test: same workspace + query yields byte-identical JSON output across repeated runs.
- [ ] Repo selection tests:
  - [ ] repeated `--repo` works
  - [ ] `--repo-filter` / `--tag` selection works and is deterministic

---

### 15.4 Compatibility gating, cohorts, and safe federation defaults

- [ ] Implement an **index compatibility key** (`compatibilityKey`) and surface it end-to-end.
  - [ ] Compute from materially relevant index invariants (examples):
    - [ ] embedding model id + embedding dimensionality
    - [ ] tokenizer/tokenization key + dictionary version/key
    - [ ] retrieval contract version / feature contract version
    - [ ] ANN backend choice when it changes index semantics (where relevant)
  - [ ] Persist the key into index artifacts:
    - [ ] `index_state.json`
    - [ ] index manifest metadata (where applicable)

- [ ] Teach federation to **partition indexes into cohorts** by `compatibilityKey`.
  - [ ] Default behavior:
    - [ ] Search only within a single cohort (or return per-cohort result sets explicitly).
    - [ ] If multiple cohorts exist, return a warning explaining the mismatch and how to resolve (rebuild or select a cohort).
  - [ ] Provide an explicit override (CLI/API) to allow “unsafe mixing” if ever required, but keep it opt-in and loud.

- [ ] Ensure compatibility gating also applies at the single-repo boundary when multiple modes/backends are requested.
  - [ ] Avoid mixing incompatible code/prose/records indexes when the query expects unified ranking.

**Touchpoints:**
- New: `src/contracts/compat/index-compat.js` (key builder + comparator)
- `src/index/build/indexer/signatures.js` (source of some inputs; do not duplicate logic)
- `src/retrieval/cli-index.js` (read compatibilityKey from index_state / manifest)
- `src/workspace/manifest.js` (persist compatibilityKey per repo/mode)
- `src/retrieval/federation/coordinator.js` (cohort partitioning)

#### Tests

- [ ] CompatibilityKey is stable for the same index inputs and changes when any compatibility input changes.
- [ ] Federated search with two repos in different cohorts:
  - [ ] returns warning + does not silently mix results by default
  - [ ] succeeds when restricted to a cohort explicitly
- [ ] Cohort partition ordering is deterministic (no “random cohort chosen”).

---

### 15.5 Federation caching, cache-key correctness, and multi-repo bug fixes

- [ ] Introduce a federated query cache location and policy.
  - [ ] Store at `<cacheRoot>/federation/<repoSetId>/queryCache.json`.
  - [ ] Add TTL and size controls (evict old entries deterministically).
  - [ ] Ensure the cache is safe to share across tools (CLI/API/MCP) by using the same keying rules.

- [ ] Make federated query cache keys **complete** and **stable**.
  - [ ] Must include at least:
    - [ ] `repoSetId`
    - [ ] per-repo (or per-cohort) `indexSignature` (or a combined signature hash)
    - [ ] query string + search type (tokens/regex/import/author/etc)
    - [ ] all relevant filters (path/file/ext/lang/meta filters)
    - [ ] retrieval knobs that change ranking/results (e.g., fileChargramN, ANN backend, RRF/blend config, BM25 params, sqlite thresholds, context window settings)
  - [ ] Use stable JSON serialization to avoid key drift from object insertion order.

- [ ] Fix query-cache invalidation correctness for sharded/variant artifact formats.
  - [ ] Ensure index signatures reflect changes to:
    - [ ] `chunk_meta.json` *and* sharded variants (`chunk_meta.jsonl` + `chunk_meta.meta.json` + shard parts)
    - [ ] token postings / file relations / embeddings artifacts when present
  - [ ] Avoid “partial signature” logic that misses sharded formats.

- [ ] Normalize repo-path based caches to canonical repo roots everywhere federation will touch.
  - [ ] API server repo cache keys must use canonical repo root (realpath + repo root), not caller-provided path strings.
  - [ ] MCP repo cache keys must use canonical repo root even when the caller provides a subdirectory.
  - [ ] Fix MCP build pointer parse behavior: if `builds/current.json` is invalid JSON, clear build id and caches rather than keeping stale state.

**Touchpoints:**
- `src/retrieval/cli-index.js` (index signature computation; sharded meta awareness)
- `src/retrieval/cli/run-search-session.js` (query cache key builder must include all ranking knobs like `fileChargramN`)
- `src/retrieval/index-cache.js` and `src/shared/artifact-io.js` (canonical signature logic; avoid duplicating parsers)
- `src/retrieval/query-cache.js` (federation namespace support and eviction policy if implemented here)
- `tools/api/router.js` (repo cache key normalization; federation cache integration)
- `tools/mcp/repo.js` (repo root canonicalization; build pointer parse error handling)
- `tools/dict-utils.js` (repoId generation stability across realpath/subdir)

#### Tests

- [ ] Federated query cache key changes when:
  - [ ] any repo’s indexSignature changes
  - [ ] `fileChargramN` (or other ranking knobs) changes
  - [ ] repo selection changes (subset vs full workspace)
- [ ] Sharded chunk_meta invalidation test:
  - [ ] updating a shard or `chunk_meta.meta.json` invalidates cached queries
- [ ] MCP repo path canonicalization test:
  - [ ] passing a subdirectory path resolves to repo root and shares the same caches as passing the repo root
- [ ] Build-pointer parse failure test:
  - [ ] invalid `builds/current.json` clears buildId and closes/clears caches (no stale serving)

---

### 15.6 Shared caches, centralized caching, and scale-out ergonomics

- [ ] Make cache layers explicit and shareable across repos/workspaces.
  - [ ] Identify and document which caches are:
    - [ ] global (models, tooling assets, dictionaries/wordlists)
    - [ ] repo-scoped (index builds, sqlite artifacts)
    - [ ] workspace-scoped (federation query caches, workspace manifests)
  - [ ] Ensure cache keys include all required invariants (repoId/buildId/indexSignature/compatibilityKey) to prevent stale reuse.

- [ ] Introduce (or extend) a content-addressed store for expensive derived artifacts to maximize reuse across repos.
  - [ ] Candidates:
    - [ ] cached bundles from file processing
    - [ ] extracted prose artifacts (where applicable)
    - [ ] tool outputs that are content-addressable
  - [ ] Add a cache GC command (`pairofcleats cache gc`) driven by manifests/snapshots.

- [ ] Scale-out and throughput controls for workspace operations.
  - [ ] Concurrency limits for:
    - [ ] multi-repo indexing
    - [ ] federated search fan-out
  - [ ] Memory caps remain bounded under “N repos × large query” workloads.
  - [ ] Optional future: a centralized cache service mode (daemon) for eviction/orchestration.
    - Defer the daemon itself to a follow-on phase if it would delay shipping first federated search.

- [ ] Wordlists + dictionary strategy improvements to support multi-repo consistency.
  - [ ] Auto-download wordlists when missing.
  - [ ] Allow better lists and document how to pin versions for reproducibility.
  - [ ] Evaluate repo-specific dictionaries without breaking workspace determinism (pin by dictionary key/version).

**Touchpoints:**
- `tools/dict-utils.js` (global cache dirs: models/tooling/dictionaries; cacheRoot override)
- `src/shared/cache.js` (cache stats, eviction, size tracking; potential reuse)
- `src/index/build/file-processor/cached-bundle.js` (bundle caching)
- `src/index/build/file-processor/embeddings.js` (embedding caching/service integration)
- New: `src/shared/cas.js` (content-addressed storage helpers) and `tools/cache-gc.js`

#### Tests

- [ ] Two-repo workspace build proves global caches are reused (no duplicate downloads; stable cache paths).
- [ ] CAS reuse test: identical input across repos yields identical object keys and avoids recomputation.
- [ ] GC test: removes unreferenced objects while preserving those referenced by workspace/snapshot manifests.
- [ ] Concurrency test: workspace indexing/search honors configured limits (does not exceed).

---

## Phase 16 — Prose ingestion + retrieval routing correctness (PDF/DOCX + FTS policy)

### Objective

Deliver first-class document ingestion (PDF + DOCX) and prose retrieval correctness:

- PDF/DOCX can be ingested (when optional deps exist) into deterministic, segment-aware prose chunks.
- When deps are missing or extraction fails, the index build remains green and reports explicit, per-file skip reasons.
- Prose/extracted-prose routes deterministically to SQLite FTS with safe, explainable query compilation; code routes to sparse/postings.
- Retrieval helpers are hardened so constraints (`allowedIds`), weighting, and table availability cannot silently produce wrong or under-filled results.

Note: vector-only indexing profile work is handled in **Phase 17 — Vector-Only Index Profile (Embeddings-First)**.

### 16.1 Optional-dependency document extractors (PDF/DOCX) with deterministic structured output

- [ ] Add extractor modules that return structured units (do not pre-join into one giant string):
  - [ ] `src/index/extractors/pdf.js` (new)
    - [ ] `extractPdf({ filePath, buffer }) -> { ok:true, pages:[{ pageNumber, text }], warnings:[] } | { ok:false, reason, warnings:[] }`
  - [ ] `src/index/extractors/docx.js` (new)
    - [ ] `extractDocx({ filePath, buffer }) -> { ok:true, paragraphs:[{ index, text, style? }], warnings:[] } | { ok:false, reason, warnings:[] }`
  - [ ] Normalize extracted text units:
    - [ ] normalize newlines to `\n`
    - [ ] collapse excessive whitespace but preserve paragraph boundaries
    - [ ] preserve deterministic ordering (page order, paragraph order)

- [ ] Implement optional-dep loading via `tryImport` (preferred) with conservative fallbacks:
  - [ ] PDF: try `pdfjs-dist/legacy/build/pdf.js|pdf.mjs`, then `pdfjs-dist/build/pdf.js`, then `pdfjs-dist`.
  - [ ] DOCX: `mammoth` preferred, `docx` as a documented fallback.

- [ ] Capability gating must match real loadability:
  - [ ] Extend `src/shared/capabilities.js` so `capabilities.extractors.pdf/docx` reflects whether the extractor modules can successfully load a working implementation (including ESM/subpath cases).
  - [ ] Ensure capability checks do not treat “package installed but unusable entrypoint” as available.

- [ ] Failure behavior must be per-file and non-fatal:
  - [ ] Extractor failures must be caught and converted into a typed `{ ok:false, reason }` result.
  - [ ] Record per-file extraction failures into build state (see 16.3) with actionable messaging.

Touchpoints:
- `src/index/extractors/pdf.js` (new)
- `src/index/extractors/docx.js` (new)
- `src/shared/capabilities.js`
- Refactor/reuse logic from `tools/bench/micro/extractors.js` into the runtime extractors (bench remains a consumer).

#### Tests
- [ ] `tests/extractors/pdf-missing-dep-skips.test.js`
  - [ ] When PDF capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/extractors/docx-missing-dep-skips.test.js`
  - [ ] When DOCX capability is false, extraction path is skipped cleanly and build remains green.
- [ ] `tests/extractors/pdf-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture PDF and assert known phrase is present.
- [ ] `tests/extractors/docx-smoke.test.js` (conditional; only when deps available)
  - [ ] Extract a fixture DOCX and assert known phrase is present.

### 16.2 Deterministic doc chunking (page/paragraph aware) + doc-mode limits that scale to large files

- [ ] Add deterministic chunkers for extracted documents:
  - [ ] `src/index/chunking/formats/pdf.js` (new)
    - [ ] Default: one chunk per page.
    - [ ] If a page is tiny, allow deterministic grouping (e.g., group adjacent pages up to a budget).
    - [ ] Each chunk carries provenance: `{ type:'pdf', pageStart, pageEnd, anchor }`.
  - [ ] `src/index/chunking/formats/docx.js` (new)
    - [ ] Group paragraphs into chunks by max character/token budget.
    - [ ] Preserve heading boundaries when style information is available.
    - [ ] Each chunk carries provenance: `{ type:'docx', paragraphStart, paragraphEnd, headingPath?, anchor }`.

- [ ] Support adaptive splitting for “hot” or unexpectedly large segments without breaking stability:
  - [ ] If a page/section/window exceeds caps, split into deterministic subsegments with stable sub-anchors (no run-to-run drift).

- [ ] Sweep-driven performance hardening for chunking limits (because PDF/DOCX can create very large blobs):
  - [ ] Update `src/index/chunking/limits.js` so byte-boundary resolution is not quadratic on large inputs.
  - [ ] Avoid building full `lineIndex` unless line-based truncation is requested.

Touchpoints:
- `src/index/chunking/formats/pdf.js` (new)
- `src/index/chunking/formats/docx.js` (new)
- `src/index/chunking/limits.js`

#### Tests
- [ ] `tests/prose/pdf-chunking-deterministic.test.js`
  - [ ] Two-page fixture; assert stable chunk count, anchors, and page ranges across repeated runs.
- [ ] `tests/prose/docx-chunking-deterministic.test.js`
  - [ ] Multi-paragraph fixture; assert stable chunk grouping and heading boundary behavior.
- [ ] `tests/perf/chunking-limits-large-input.test.js`
  - [ ] Regression guard: chunking limits on a large string must complete within a bounded time.

### 16.3 Integrate extraction into indexing build (discovery, skip logic, file processing, state)

- [ ] Discovery gating:
  - [ ] Update `src/index/build/discover.js` so `.pdf`/`.docx` are only considered when `indexing.documentExtraction.enabled === true`.
  - [ ] If enabled but deps missing: record explicit “skipped due to capability” diagnostics (do not silently ignore).

- [ ] Binary skip exceptions:
  - [ ] Update `src/index/build/file-processor/skip.js` to treat `.pdf`/`.docx` as extractable binaries when extraction is enabled, routing them to extractors instead of skipping.

- [ ] File processing routing:
  - [ ] Update `src/index/build/file-processor.js` (and `src/index/build/file-processor/assemble.js` as needed) to:
    - [ ] hash on raw bytes (caching correctness even if extraction changes)
    - [ ] extract structured units
    - [ ] build a deterministic joined text representation with a stable offset mapping
    - [ ] chunk via the dedicated pdf/docx chunkers
    - [ ] emit chunks with `segment` provenance and `lang:'prose'` (or a dedicated document language marker)
    - [ ] ensure chunk identity cannot collide with code chunks (segment markers must be part of identity)

- [ ] Record per-file extraction outcomes:
  - [ ] Success: record page/paragraph counts and warnings.
  - [ ] Failure/skip: record reason (`missing_dependency`, `extract_failed`, `oversize`, etc.) and include actionable guidance.

- [ ] Chunking dispatch registration:
  - [ ] Update `src/index/chunking/dispatch.js` to route `.pdf`/`.docx` through the document chunkers under the same gating.

Touchpoints:
- `src/index/build/discover.js`
- `src/index/build/file-processor/skip.js`
- `src/index/build/file-processor.js`
- `src/index/build/file-processor/assemble.js`
- `src/index/chunking/dispatch.js`

#### Tests
- [ ] `tests/indexing/documents-included-when-available.test.js` (conditional; when deps available)
  - [ ] Build fixture containing a sample PDF and DOCX; assert chunks exist with `segment.type:'pdf'|'docx'` and searchable text is present.
- [ ] `tests/indexing/documents-skipped-when-unavailable.test.js`
  - [ ] Force capabilities off; build succeeds; skipped docs are reported deterministically with reasons.
- [ ] `tests/indexing/document-bytes-hash-stable.test.js`
  - [ ] Ensure caching identity remains tied to bytes + extractor version/config.

### 16.4 metaV2 and chunk_meta contract extensions for extracted documents

- [ ] Extend metaV2 for extracted docs in `src/index/metadata-v2.js`:
  - [ ] Add a `document` (or `segment`) block with provenance fields:
    - `sourceType: 'pdf'|'docx'`
    - `pageStart/pageEnd` (PDF)
    - `paragraphStart/paragraphEnd` (DOCX)
    - optional `headingPath`, `windowIndex`, and a stable `anchor` for citation.
- [ ] Ensure `chunk_meta.jsonl` includes these fields and that output is backend-independent (artifact vs SQLite).
- [ ] If metaV2 is versioned, bump schema version (or add one) and provide backward-compatible normalization.

Touchpoints:
- `src/index/metadata-v2.js`
- `src/index/build/file-processor/assemble.js`
- Retrieval loaders that depend on metaV2 (for parity checks)

#### Tests
- [ ] `tests/unit/metaV2-extracted-doc.unit.js`
  - [ ] Verify extracted-doc schema fields are present, typed, and deterministic.
- [ ] `tests/services/sqlite-hydration-metaV2-parity.services.js`
  - [ ] Build an index; load hits via artifact-backed and SQLite-backed paths; assert canonical metaV2 fields match for extracted docs.

### 16.5 Prose retrieval routing defaults + FTS query compilation correctness (explainable, deterministic)

- [ ] Enforce routing defaults:
  - [ ] `prose` / `extracted-prose` → SQLite FTS by default.
  - [ ] `code` → sparse/postings by default.
  - [ ] Overrides select requested providers and are reflected in `--explain` output.

- [ ] Make FTS query compilation AST-driven for prose routes:
  - [ ] Generate the FTS5 `MATCH` string from the raw query (or parsed boolean AST).
  - [ ] Quote/escape terms so punctuation (`-`, `:`, `\"`, `*`) and keywords (`NEAR`, etc.) are not interpreted as operators unintentionally.
  - [ ] Include the final compiled `MATCH` string and provider choice in `--explain`.

- [ ] Provider variants and deterministic selection (conditional and explicit):
  - [ ] Default: `unicode61 remove_diacritics 2` variant.
  - [ ] Conditional: porter variant for Latin-script stemming use-cases.
  - [ ] Conditional: trigram variant for substring/CJK/emoji fallback behind `--fts-trigram` until benchmarks are complete.
  - [ ] Conditional: NFKC-normalized variant when normalization changes the query.
  - [ ] Merge provider result sets deterministically by `chunkUid` with stable tie-breaking.

- [ ] Enforce capability gating at provider boundaries (never throw):
  - [ ] If FTS tables are missing, providers return “unavailable” results and the router selects an alternative or returns a deterministic warning.

Touchpoints:
- `src/retrieval/pipeline.js`
- `src/retrieval/query.js` / `src/retrieval/query-parse.js`
- `src/retrieval/sqlite-helpers.js`
- `src/retrieval/sqlite-cache.js`

#### Tests
- [ ] `tests/retrieval/search-routing-policy.test.js`
  - [ ] Prose defaults to FTS; code defaults to postings; overrides behave deterministically and are explained.
- [ ] `tests/retrieval/sqlite-fts-query-escape.test.js`
  - [ ] Punctuation cannot inject operators; the compiled `MATCH` string is stable and safe.
- [ ] `tests/retrieval/fts-tokenizer-config.test.js`
  - [ ] Assert baseline tokenizer uses diacritic-insensitive configuration; include a diacritic recall fixture.

### 16.6 Sweep-driven correctness fixes in retrieval helpers touched by prose FTS routing

- [ ] Fix `rankSqliteFts()` correctness for `allowedIds`:
  - [ ] When `allowedIds` is too large for a single `IN (...)`, implement adaptive overfetch (or chunked pushdown) until:
    - [ ] `topN` hits remain after filtering, or
    - [ ] a hard cap/time budget is hit.
  - [ ] Ensure results are the true “top-N among allowed IDs” (do not allow disallowed IDs to occupy limited slots).

- [ ] Fix weighting and LIMIT-order correctness in FTS ranking:
  - [ ] If `chunks.weight` is part of ranking, incorporate it into ordering before applying `LIMIT` (or fetch enough rows to make post-weighting safe).
  - [ ] Add stable tie-breaking rules and make them part of the contract.

- [ ] Fix `unpackUint32()` alignment safety:
  - [ ] Avoid constructing a `Uint32Array` view on an unaligned Buffer slice.
  - [ ] When needed, copy to an aligned `ArrayBuffer` (or decode via `DataView`) before reading.

- [ ] Ensure helper-level capability guards are enforced:
  - [ ] If `chunks_fts` is missing, `rankSqliteFts` returns `[]` or a controlled “unavailable” result (not throw).

Touchpoints:
- `src/retrieval/sqlite-helpers.js`

#### Tests
- [ ] `tests/retrieval/rankSqliteFts-allowedIds-correctness.test.js`
- [ ] `tests/retrieval/rankSqliteFts-weight-before-limit.test.js`
- [ ] `tests/retrieval/unpackUint32-buffer-alignment.test.js`

### 16.7 Query intent classification + boolean parsing semantics (route-aware, non-regressing)

- [ ] Fix path-intent misclassification so routing is reliable:
  - [ ] Replace the “any slash/backslash implies path” heuristic with more discriminating signals:
    - [ ] require path-like segments (multiple separators, dot-extensions, `./` / `../`, drive roots), and
    - [ ] treat URLs separately so prose queries containing `https://...` do not get path-biased.
  - [ ] Keep intent scoring explainable and stable.

- [ ] Harden boolean parsing semantics to support FTS compilation and future strict evaluation:
  - [ ] Treat unary `-` as NOT even with whitespace (e.g., `- foo`, `- "phrase"`), or reject standalone `-` with a parse error.
  - [ ] Ensure phrase parsing behavior is explicit (either implement minimal escaping or formally document “no escaping”).
  - [ ] Prevent flattened token inventories from being mistaken for semantic constraints:
    - [ ] rename inventory lists (or attach an explicit `inventoryOnly` marker) so downstream code cannot accidentally erase boolean semantics.

Touchpoints:
- `src/retrieval/query-intent.js`
- `src/retrieval/query.js`

#### Tests
- [ ] `tests/retrieval/query-intent-path-heuristics.test.js`
- [ ] `tests/retrieval/boolean-unary-not-whitespace.test.js`
- [ ] `tests/retrieval/boolean-inventory-vs-semantics.test.js`

### 16.8 Retrieval output shaping: `scoreBreakdown` consistency + explain fidelity, plus harness drift repair

- [ ] Resolve `scoreBreakdown` contract inconsistencies:
  - [ ] Standardize field names and nesting across providers (SQLite FTS, postings, vector) so consumers do not need provider-specific logic.
  - [ ] Ensure verbosity/output size is governed by a single budget policy (max bytes/fields/explain items).

- [ ] Ensure `--explain` is complete and deterministic:
  - [ ] Explain must include:
    - routing decision
    - compiled FTS `MATCH` string for prose routes
    - provider variants used and thresholds
    - capability gating decisions when features are unavailable

- [ ] Repair script-coverage harness drift affecting CI signal quality:
  - [ ] Align `tests/script-coverage/actions.js` `covers` entries with actual `package.json` scripts.
  - [ ] Ensure `tests/script-coverage/report.js` does not fail with `unknownCovers` for legitimate cases.

Touchpoints:
- `src/retrieval/output/*`
- `tests/script-coverage/*`
- `package.json`

#### Tests
- [ ] `tests/retrieval/scoreBreakdown-contract-parity.test.js`
- [ ] `tests/retrieval/explain-output-includes-routing-and-fts-match.test.js`
- [ ] `tests/script-coverage/harness-parity.test.js`



---

## Phase 17 — Vector-Only Profile (Build + Search Without Sparse Postings)

> This is the **canonical merged phase** for the previously overlapping “Phase 17” and “Phase 18” drafts.  
> Goal: a *vector-only* index that can be built and queried **without** sparse/token/postings artifacts.

### Objective

Enable an indexing profile that is:

- **Embeddings-first**: dense vectors are the primary (and optionally only) retrieval substrate.
- **Sparse-free**: skips generation and storage of sparse token postings (and any derived sparse artifacts).
- **Strict and explicit**: search refuses to “pretend” sparse exists; mismatched modes are hard errors with actionable messages.
- **Artifact-consistent**: switching profiles cannot leave stale sparse artifacts that accidentally affect search.

This is especially valuable for:
- huge corpora where sparse artifacts dominate disk/time,
- doc-heavy or mixed corpora where ANN is the primary workflow,
- environments where you want fast/cheap rebuilds and can accept ANN-only recall.

---

### Exit criteria (must all be true)

- [ ] Config supports `indexing.profile: "default" | "vector_only"` (default: `"default"`).
- [ ] `vector_only` builds succeed end-to-end and **do not emit** sparse artifacts (tokens/postings/minhash/etc).
- [ ] Search against a `vector_only` index:
  - [ ] requires an ANN-capable provider (or explicit `--ann`), and
  - [ ] rejects token/sparse-dependent features with a clear error (not silent degradation).
- [ ] `index_state.json` records the profile and a machine-readable “artifact presence” manifest with a schema version.
- [ ] SQLite-backed retrieval cannot crash on missing sparse tables; it either:
  - [ ] uses a vector-only schema, or
  - [ ] detects missing tables and returns a controlled “profile mismatch / artifact missing” error.
- [ ] Tests cover: profile switching cleanup, ANN-only search, and “mismatch is an error” behavior.

---

### Phase 17.1 — Profile contract + build-state / index-state schema

- [ ] Add and normalize config:
  - [ ] `indexing.profile` (string enum): `default | vector_only`
  - [ ] Default behavior: absent ⇒ `default`
  - [ ] Reject unknown values (fail-fast in config normalization)

- [ ] Define the canonical on-disk contract in `index_state.json`:

  - [ ] Add a `profile` block (versioned):
    - [ ] `profile.id: "default" | "vector_only"`
    - [ ] `profile.schemaVersion: 1`
  - [ ] Add an `artifacts` presence block (versioned) so loaders can reason about what exists:
    - [ ] `artifacts.schemaVersion: 1`
    - [ ] `artifacts.present: { [artifactName]: true }` (only list artifacts that exist)
    - [ ] `artifacts.omitted: string[]` (explicit omissions for the selected profile)
    - [ ] `artifacts.requiredForSearch: string[]` (profile-specific minimum set)

  - [ ] Add a build-time invariant:
    - [ ] If `profile.id === "vector_only"`, then `token_postings*`, `token_vocab`, `token_stats`, `minhash*`, and any sparse-only artifacts MUST NOT be present.

- [ ] Ensure build signatures include profile:
  - [ ] signature/caching keys must incorporate `profile.id` so switching profiles forces a rebuild.

Touchpoints:
- `docs/config/schema.json`
- `src/index/build/runtime/runtime.js` (read + normalize `indexing.profile`)
- `src/index/build/indexer/signatures.js` (include profile in signature)
- `src/index/build/state.js` / `src/index/build/artifacts.js` (index_state emission)
- `src/retrieval/cli/index-state.js` (surface profile + artifacts in `index_status`)

#### Tests
- [ ] `tests/index/profile-index-state-contract.test.js`
  - [ ] Build tiny index with each profile and assert `index_state.json.profile` + `index_state.json.artifacts` satisfy schema invariants.

---

### Phase 17.2 — Build pipeline gating (skip sparse generation cleanly)

- [ ] Thread `profile.id` into the indexer pipeline and feature settings:
  - [ ] In `vector_only`, set `featureSettings.tokenize = false` (and ensure all downstream steps respect it)
  - [ ] Ensure embeddings remain enabled/allowed (vector-only without vectors should be rejected at build time unless explicitly configured to “index without vectors”)

- [ ] Skip sparse stages when `vector_only`:
  - [ ] Do not run `buildIndexPostings()` (or make it a no-op) when tokenize=false.
  - [ ] Do not write sparse artifacts in `writeIndexArtifactsForMode()` / `src/index/build/artifacts.js`.

- [ ] Cleanup/consistency when switching profiles:
  - [ ] When building `vector_only`, proactively remove any prior sparse artifacts in the target output dir so stale files cannot be accidentally loaded.
  - [ ] When building `default`, ensure sparse artifacts are emitted normally (and any vector-only-only special casing does not regress).

- [ ] Ensure “missing doc embedding” representation stays stable:
  - [ ] Continue using the existing **zero-length typed array** convention for missing vectors.
  - [ ] Add a regression test so future refactors don’t reintroduce `null`/NaN drift.

Touchpoints:
- `src/index/build/indexer/pipeline.js` (profile → feature gating)
- `src/index/build/indexer/steps/postings.js` (skip when tokenize=false)
- `src/index/build/indexer/steps/write.js` + `src/index/build/artifacts.js` (omit sparse artifacts)
- `src/index/build/file-processor/embeddings.js` (missing-doc marker regression)

#### Tests
- [ ] `tests/index/vector-only-does-not-emit-sparse.test.js`
  - [ ] Assert absence of `token_postings*`, `token_vocab*`, `token_stats*`, `minhash*`.
- [ ] `tests/index/vector-only-switching-cleans-stale-sparse.test.js`
  - [ ] Build default, then vector_only into same outDir; assert sparse artifacts removed.

---

### Phase 17.3 — Search routing + strict profile compatibility

- [ ] Load and enforce `index_state.json.profile` at query time:
  - [ ] If the index is `vector_only`:
    - [ ] default router must choose ANN/vector provider(s)
    - [ ] sparse/postings providers must be disabled/unavailable
  - [ ] If a caller explicitly requests sparse-only behavior against vector_only:
    - [ ] return a controlled error with guidance (“rebuild with indexing.profile=default”)

- [ ] Token-dependent query features must be explicit:
  - [ ] If a query requests phrase/boolean constraints that require token inventory:
    - [ ] either (a) reject with error, or (b) degrade with a warning and set `explain.warnings[]` (pick one policy and make it part of the contract)

- [ ] SQLite helper hardening for profile-aware operation:
  - [ ] Add a lightweight `requireTables(db, names[])` helper used at provider boundaries.
  - [ ] Providers must check required tables for their mode and return an actionable “tables missing” error (not throw).

Touchpoints:
- `src/retrieval/pipeline.js` (router)
- `src/retrieval/index-load.js` (ensure index_state loaded early)
- `src/retrieval/sqlite-helpers.js` (table guards)
- `src/retrieval/providers/*` (respect profile + missing-table outcomes)
- `src/retrieval/output/explain.js` (surface profile + warnings)

#### Tests
- [ ] `tests/retrieval/vector-only-search-requires-ann.test.js`
- [ ] `tests/retrieval/vector-only-rejects-sparse-mode.test.js`
- [ ] `tests/retrieval/sqlite-missing-sparse-tables-is-controlled-error.test.js`

---

### Phase 17.4 — Optional: “analysis policy shortcuts” for vector-only builds (stretch)

This is explicitly optional, but worth considering because it is where most build time goes for code-heavy repos.

- [ ] Add a documented policy switch: when `indexing.profile=vector_only`, default `analysisPolicy` can disable:
  - [ ] type inference
  - [ ] risk analysis
  - [ ] expensive cross-file passes
  - [ ] (optionally) lint/complexity stages
- [ ] Make these *opt-outable* (users can re-enable per setting).

Touchpoints:
- `src/index/build/indexer/pipeline.js` (feature flags)
- `docs/config/` (document defaults and overrides)

## Phase 20 — Distribution & Platform Hardening (Release Matrix, Packaging, and Optional Python)

### Objective
Make PairOfCleats releasable and operable across supported platforms by defining a **release target matrix**, adding a **deterministic release smoke-check**, hardening **cross-platform path handling**, and producing **reproducible editor/plugin packages** (Sublime + VS Code) with CI gates.

This phase also standardizes how Python-dependent tests and tooling behave when Python is missing: they must **skip cleanly** (without producing “false red” CI failures), while still failing when Python is present but the test is genuinely broken.

### Exit Criteria
- A documented release target matrix exists (platform × Node version × optional dependencies policy).
- A deterministic `release-check` smoke run exists and is runnable locally and in CI, and it validates:
  - `pairofcleats --version`
  - `pairofcleats index build` + `index validate`
  - a basic `search` against a fixture repo
  - presence/packaging sanity of editor integrations (when enabled)
- Cross-platform “paths with spaces” (and Windows path semantics) have regression tests, and the audited commands pass.
- Sublime packaging is reproducible and validated by tests (structure + version stamping).
- VS Code extension packaging is reproducible and validated by tests (or explicitly gated as non-blocking if the packaging toolchain is absent).
- Python-dependent tests pass on machines without Python (skipped) and still enforce Python syntax correctness when Python is present.

---

### Phase 20.1 — Release target matrix + deterministic release smoke-check
- [ ] Define and publish the **release target matrix** and optional-dependency policy.
  - Primary output:
    - `docs/release-matrix.md` (or `docs/release/targets.md`)
  - Include:
    - Supported OSes and runners (Linux/macOS/Windows) and architectures (x64/arm64 where supported).
    - Supported Node versions (minimum + tested versions).
    - Optional dependency behavior policy (required vs optional features), including:
      - Python (for Sublime lint/compile tests)
      - Editor integrations (Sublime + VS Code)
      - Any “bring-your-own” optional deps used elsewhere (e.g., extraction/SDK/tooling)
    - “Fail vs degrade” posture for each optional capability (what is allowed to skip, and what must hard-fail).
- [ ] Expand the existing `tools/release-check.js` from “changelog-only” into a **deterministic release smoke-check runner**.
  - Touchpoints:
    - `tools/release-check.js` (extend; keep it dependency-light)
    - `bin/pairofcleats.js` (invoked by the smoke check; no behavioral changes expected here)
  - Requirements:
    - Must not depend on shell string concatenation; use spawn with args arrays.
    - Must set explicit `cwd` and avoid fragile `process.cwd()` assumptions (derive repo root from `import.meta.url` or accept `--repo-root`).
    - Must support bounded timeouts and produce actionable failures (which step failed, stdout/stderr excerpt).
    - Should support `--json` output with a stable envelope for CI automation (step list + pass/fail + durations).
  - Smoke steps (minimum):
    - Verify Node version compatibility (per the target matrix).
    - Run `pairofcleats --version`.
    - Run `pairofcleats index build` on a small fixture repo into a temp cacheRoot.
    - Run `pairofcleats index validate --strict` against the produced build.
    - Run a basic `pairofcleats search` against the build and assert non-empty or expected shape.
    - Verify editor integration assets exist when present:
      - Sublime: `sublime/PairOfCleats/**`
      - VS Code: `extensions/vscode/**`
- [ ] Add CI wiring for the smoke check.
  - Touchpoints:
    - `.github/workflows/ci.yml`
    - `package.json` scripts (optional, if CI should call a stable npm script)
  - Requirements:
    - Add a release-gate lane that runs `npm run release-check` plus the new smoke steps.
    - Add OS coverage beyond Linux (at minimum: Windows already exists; add macOS for the smoke check).
    - Align CI Node version(s) with the release target matrix, and ensure the matrix is explicitly documented.

#### Tests / Verification
- [ ] `tests/release/release-check-smoke.test.js`
  - Runs `node tools/release-check.js` in a temp environment and asserts it succeeds on a healthy checkout.
- [ ] `tests/release/release-check-json.test.js`
  - Runs `release-check --json` and asserts stable JSON envelope fields (schemaVersion, steps[], status).
- [ ] CI verification:
  - [ ] Add a job that runs the smoke check on at least Linux/macOS/Windows with pinned Node versions per the matrix.

---

### Phase 20.2 — Cross-platform path safety audit + regression tests (including spaces)
- [ ] Audit filesystem path construction and CLI spawning for correctness on:
  - paths with spaces
  - Windows separators and drive roots
  - consistent repo-relative path normalization for public artifacts (canonical `/` separators)
- [ ] Fix issues discovered during the audit in the “release-critical surface”.
  - Minimum scope for this phase:
    - `tools/release-check.js` (must behave correctly on all supported OSes)
    - packaging scripts added in Phase 20.3/20.5
    - tests added by this phase (must be runnable on CI runners and locally)
  - Broader issues discovered outside this scope should either:
    - be fixed here if the touched files are already being modified, or
    - be explicitly deferred to a named follow-on phase (with a concrete subsection placeholder).
- [ ] Add regression tests for path safety and quoting.
  - Touchpoints:
    - `tests/platform/paths-with-spaces.test.js` (new)
    - `tests/platform/windows-paths-smoke.test.js` (new; conditional when not on Windows)
  - Requirements:
    - Create a temp repo directory whose absolute path includes spaces.
    - Run build + validate + search using explicit `cwd` and temp cacheRoot.
    - Ensure the artifacts still store repo-relative paths with `/` separators.

#### Tests / Verification
- [ ] `tests/platform/paths-with-spaces.test.js`
  - Creates `repo with spaces/` under a temp dir; runs build + search; asserts success.
- [ ] `tests/platform/windows-paths-smoke.test.js`
  - On Windows CI, verifies key commands succeed and produce valid outputs.
- [ ] Extend `tools/release-check.js` to include a `--paths` step that runs the above regression checks in quick mode.

---

### Phase 20.3 — Sublime plugin packaging pipeline (bundled, reproducible)
- [ ] Implement a reproducible packaging step for the Sublime plugin.
  - Touchpoints:
    - `sublime/PairOfCleats/**` (source)
    - `tools/package-sublime.js` (new; Node-only)
    - `package.json` scripts (optional: `npm run package:sublime`)
  - Requirements:
    - Package `sublime/PairOfCleats/` into a distributable artifact (`.sublime-package` zip or Package Control–compatible format).
    - Determinism requirements:
      - Stable file ordering in the archive.
      - Normalized timestamps/permissions where feasible.
      - Version-stamp the output using root `package.json` version.
    - Packaging must be Node-only (must not assume Python is present).
- [ ] Add installation and distribution documentation.
  - Touchpoints (choose one canonical location):
    - `docs/editor-integration.md` (add Sublime section), and/or
    - `sublime/PairOfCleats/README.md` (distribution instructions)
  - Include:
    - Manual install steps and Package Control posture.
    - Compatibility notes (service-mode requirements, supported CLI flags, cacheRoot expectations).

#### Tests / Verification
- [ ] `tests/sublime/package-structure.test.js`
  - Runs the packaging script; asserts expected files exist in the output and that version metadata matches root `package.json`.
- [ ] `tests/sublime/package-determinism.test.js` (if feasible)
  - Packages twice; asserts the archive is byte-identical (or semantically identical with a stable file list + checksums).

---

### Phase 20.4 — Make Python tests and tooling optional (skip cleanly when Python is missing)
- [ ] Update Python-related tests to detect absence of Python and **skip with a clear message** (not fail).
  - Touchpoints:
    - `tests/sublime-pycompile.js` (must be guarded)
    - `tests/sublime/test_*.py` (only if these are invoked by CI or tooling; otherwise keep as optional)
  - Requirements:
    - Prefer `spawnSync(python, ['--version'])` and treat ENOENT as “Python unavailable”.
    - When Python is unavailable:
      - print a single-line skip reason to stderr
      - exit using the project’s standard “skip” mechanism (see below)
    - When Python is available:
      - the test must still fail for real syntax errors (no silent skips).
- [x] JS test harness recognizes “skipped” tests via exit code 77.
  - Touchpoints:
    - `tests/run.js` (treat a dedicated exit code, e.g. `77`, as `skipped`)
  - Requirements:
    - `SKIP` must appear in console output (like PASS/FAIL).
    - JUnit output must mark skipped tests as skipped.
    - JSON output must include `status: 'skipped'`.
- [ ] Add a small unit test that proves the “Python missing → skipped” path is wired correctly.
  - Touchpoints:
    - `tests/python/python-availability-skip.test.js` (new)
  - Approach:
    - mock or simulate ENOENT from spawnSync and assert the test exits with the “skip” code and emits the expected message.

#### Tests / Verification
- [ ] `tests/sublime-pycompile.js`
  - Verified behavior:
    - Without Python: skips (non-failing) with a clear message.
    - With Python: compiles all `.py` files under `sublime/PairOfCleats/**` and fails on syntax errors.
- [ ] `tests/python/python-availability-skip.test.js`
  - Asserts skip-path correctness and ensures we do not “skip on real failures”.

---

### Phase 20.5 — VS Code extension packaging + compatibility (extension exists)
- [ ] Add a reproducible VS Code extension packaging pipeline (VSIX).
  - Touchpoints:
    - `extensions/vscode/**` (source)
    - `package.json` scripts (new: `package:vscode`), and/or `tools/package-vscode.js` (new)
  - Requirements:
    - Use a pinned packaging toolchain (recommended: `@vscode/vsce` as a devDependency).
    - Output path must be deterministic and placed under a temp/artifacts directory suitable for CI.
    - Packaging must not depend on repo-root `process.cwd()` assumptions; set explicit cwd.
- [ ] Ensure the extension consumes the **public artifact surface** via manifest discovery and respects user-configured `cacheRoot`.
  - Touchpoints:
    - `extensions/vscode/extension.js`
    - `extensions/vscode/package.json`
  - Requirements:
    - No hard-coded internal cache paths; use configuration + CLI contracts.
    - Any default behaviors must be documented and overridable via settings.
- [ ] Add a conditional CI gate for VSIX packaging.
  - If the VSIX toolchain is present, packaging must pass.
  - If the toolchain is intentionally absent in some environments, the test must skip (not fail) with an explicit message.

#### Tests / Verification
- [ ] `tests/vscode/extension-packaging.test.js`
  - Packages a VSIX and asserts the output exists (skips if packaging toolchain is unavailable).
- [ ] Extend `tests/vscode-extension.js`
  - Validate required activation events/commands and required configuration keys (and add any cacheRoot-related keys if the contract requires them).

---

### Phase 20.6 — Service-mode bundle + distribution documentation (API server + embedding worker)
- [ ] Ship a service-mode “bundle” (one-command entrypoint) and documentation.
  - Touchpoints:
    - `tools/api-server.js`
    - `tools/indexer-service.js`
    - `tools/service/**` (queue + worker)
    - `docs/service-mode.md` (new) or a section in `docs/commands.md`
  - Requirements:
    - Define canonical startup commands, required environment variables, and queue storage paths.
    - Document security posture and safe defaults:
      - local-only binding by default
      - explicit opt-in for public binding
      - guidance for auth/CORS if exposed
    - Ensure the bundle uses explicit args and deterministic logging conventions (stdout vs stderr).
- [ ] Add an end-to-end smoke test for the service-mode bundle wiring.
  - Use stub embeddings or other deterministic modes where possible; do not require external services.

#### Tests / Verification
- [ ] `tests/service/service-mode-smoke.test.js`
  - Starts API server + worker in a temp environment; enqueues a small job; asserts it is processed and the API responds.
- [ ] Extend `tools/release-check.js` to optionally run a bounded-time service-mode smoke step (`--service-mode`).

---
