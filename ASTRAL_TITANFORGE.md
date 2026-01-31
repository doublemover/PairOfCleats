# ASTRAL_TITANFORGE — Phase 7 Embeddings + ANN Unification Plan

## Guiding decisions (locked in)
- Config key: use `search.denseVectorMode` (matches `tools/default-config.js` + `docs/guides/search.md`).
- CLI: add `--dense-vector-mode` to search; CLI override wins when explicitly provided.
- Search strictness: add `--non-strict` to search CLI only (no config toggle); strict is default.
- sqlite-vec marker: keep optional meta marker (`dense_vectors_sqlite_vec_meta`) for manifest-first discovery of sqlite-vec DB state.
- Config precedence: **CLI > user config > defaults**, log when CLI overrides config.
- Optional dependency tests must skip (not fail) when deps are missing; document rule in testing docs.

## Execution order (matches roadmap 7.0 + recommended order 7.2 -> 7.8)
1) 7.0 Foundation (conflicts, terminology, capability matrix, strict-manifest addendum alignment)
2) 7.2 Artifact contract parity + manifest completeness (prereq for strict loaders)
3) 7.3 Quantization invariants (avoid corrupt artifacts)
4) 7.4 Normalization consistency (required for parity testing)
5) 7.1 Embedding job payload + service scoping (worker correctness)
6) 7.5 LanceDB robustness (candidate filtering + cache safety)
7) 7.6 HNSW compatibility + observability (signature + variant selection)
8) 7.7 Backend policy + parity (denseVectorMode + ANN alignment)
9) 7.8 Storage resilience (LMDB map size, sqlite mode safety, cache preflight)
10) Addendum + fixtures + compatibility checklist + tests

---

## 7.0 Foundation: contracts, terminology, execution order
[@] Reconcile conflicts A/B/C and record decisions in docs if needed
    - [@] Conflict A: queue payload fields (`buildRoot` vs `indexDir`) documented and normalized
    - [x] Conflict B: manifest includes non-JSON artifacts (HNSW/LanceDB) even without JSON schemas
    - [x] Conflict C: strict loaders use manifest-only resolution (no guessed filenames)
[x] Verify terminology is aligned in docs + code comments where needed
    - [x] `repoRoot`, `buildRoot`, `indexDir`, `mode`, `denseVectorMode`, ANN target naming
[x] Confirm capability matrix after Phase 7 is achievable and is reflected in docs
    - [x] Dense exact ranking supports merged/doc/code
    - [x] LanceDB supports merged/doc/code
    - [x] HNSW supports merged/doc/code
[x] Ensure strict-manifest addendum is referenced in Phase 7 docs (if missing)
[x] Update test lane rules so CI classifies new tests correctly
    - [x] `tests/run.rules.jsonc` updated for new Phase 7 tests or confirm names match rules
[x] Add shared optional-deps test helper
    - [x] `tests/helpers/optional-deps.js` provides consistent skip + messaging

## 7.2 Artifact contract parity for embeddings + ANN
### 7.2.1 Canonical artifact names (public surface)
[x] Update docs/contracts to list canonical names + formats
    - [x] `docs/contracts/public-artifact-surface.md`
    - [x] `docs/contracts/artifact-schemas.md`
[x] Align contract registry if needed
    - [x] `src/contracts/registry.js`
    - [x] `src/contracts/schemas/artifacts.js`
[x] Ensure canonical names defined for:
    - [x] dense vectors (merged/doc/code)
    - [x] HNSW (bin + meta) merged/doc/code
    - [x] LanceDB (dir + meta) merged/doc/code
    - [x] sqlite-vec optional meta marker

### 7.2.2 Manifest writer includes non-JSON artifacts
[x] Update `tools/build-embeddings/manifest.js`
    - [x] Allowlist includes bin/dir artifacts in addition to `ARTIFACT_SCHEMA_DEFS`
    - [x] Add entries when files/dirs exist
    - [x] `format: bin|dir` for HNSW/LanceDB
    - [x] Bytes/sha256 for files; deterministic dir sizing if implemented
    - [x] Exclude `.bak` artifacts from manifest

### 7.2.3 Strict loaders must use manifest
[@] Add/extend manifest helper(s) for binary/dir artifacts
    - [x] `src/shared/artifact-io.js`
    - [x] `src/shared/artifact-io/manifest.js`
    - [x] Ensure strict=default; non-strict uses legacy guessing w/ warning
[x] Update retrieval loaders
    - [x] `src/retrieval/cli-index.js` (dense + HNSW paths)
    - [x] `src/retrieval/cli/load-indexes.js` (LanceDB attach)
[x] Update validator to require manifest entries in strict mode
    - [x] `src/index/validate.js`

### 7.2.4 index_state embedding identity + backend presence
[x] Stage2 (build index) emits identity + pending fields
    - [x] `src/index/build/indexer/steps/write.js`
[x] Stage3 (build-embeddings) updates ready/pending + backends
    - [x] `tools/build-embeddings/runner.js`
    - [x] Include `embeddingIdentity`, `embeddingIdentityKey`, `backends.*`

### 7.2.5 Tests for manifest completeness + strict discovery
[x] Add manifest coverage tests
    - [x] `tests/manifest-embeddings-pieces.js`
    - [x] `tests/artifact-io-manifest-discovery.test.js` updates
[x] Add strict retrieval failure test
    - [x] `tests/retrieval-strict-manifest-embeddings.js`
[x] Add sqlite-vec marker test (if marker implemented)
    - [x] ensure manifest entry appears only when sqlite-vec built
[x] Ensure all optional-dependency tests skip when deps missing (hnswlib-node, lancedb, sqlite-vec)
    - [x] Update `docs/testing/truth-table.md` to codify skip behavior for optional deps
    - [x] Use `tests/helpers/optional-deps.js` helper for consistent skips

## 7.3 Quantization invariants end-to-end
### 7.3.1 Clamp quantization levels globally
[x] Clamp in `src/storage/sqlite/vector.js` (`resolveQuantizationParams`)
[x] Clamp in `src/shared/embedding-utils.js` (`quantizeEmbeddingVector`, `quantizeEmbeddingVectorUint8`)
[x] Emit warning when vector values are clamped during quantization
[x] Ensure all call paths use clamped quantizer
    - [x] `src/index/embedding.js`
    - [x] `tools/build-embeddings/embed.js`
    - [x] `src/storage/sqlite/build/incremental-update.js`
    - [x] `src/index/build/file-processor/embeddings.js`

### 7.3.2 Ensure uint8 artifacts are actually 0..255
[x] Validate dense JSON vectors never exceed 255
[x] Validate sqlite dense vectors never wrap (Uint8Array safe)

### 7.3.3 Persist quantization metadata
[x] Add `minVal/maxVal/levels` to dense vector JSON artifacts
[x] Add quantization metadata to HNSW meta
[x] Add quantization metadata to LanceDB meta
[x] Consume quantization metadata in retrieval / dequant paths
    - [x] `src/retrieval/rankers.js`
    - [x] `src/retrieval/sqlite-helpers.js`
    - [x] `tools/build-embeddings/lancedb.js`

### 7.3.4 LanceDB dequantization correctness
[x] Pass quantization params into LanceDB builder
    - [x] `tools/build-embeddings/runner.js`
    - [x] `tools/build-embeddings/lancedb.js`

### 7.3.5 Quantization tests
[x] Add/extend unit tests for clamp and uint8 bounds
    - [x] `tests/embeddings/quantization-clamp-warning.test.js`
    - [x] `tests/embeddings/quantization-no-wrap.test.js`
    - [x] `tests/embeddings-validate.js` checks dense vector quantization fields

## 7.4 Normalization policy consistency
### 7.4.1 Enforce normalization rules
[x] Ensure normalize=true always normalizes before storage
    - [x] `src/shared/embedding-adapter.js`
    - [x] `tools/build-embeddings/embed.js`
    - [x] `src/index/build/file-processor/embeddings.js`
    - [x] `tools/build-embeddings/runner.js` (cache load + HNSW path)
[x] Define merged vector behavior for missing doc vectors
    - [x] confirm zero-fill + normalize path

### 7.4.2 Normalization tests
[x] Add `tests/embedding-normalization-consistency.js`
[x] Update `tests/hnsw-ann.js` and `tests/lancedb-ann.js` for normalize metadata + parity

## 7.1 Embedding jobs build-scoped, deterministic, idempotent
### 7.1.1 Job payload schema (v2)
[x] Update `src/index/build/indexer/embedding-queue.js` validation
[x] Update `tools/service/queue.js` payload handling
[x] Update `tools/indexer-service.js` to accept/validate v2
[x] Add legacy v1 upgrade path + warning

### 7.1.2 Fix enqueue site
[x] Update `src/index/build/indexer/pipeline.js` to send `buildRoot` + `indexDir`
[x] Normalize legacy `indexRoot` when present
[x] Validate `indexDir` is inside `buildRoot`

### 7.1.3 Worker uses buildRoot
[x] `tools/indexer-service.js` runBuildEmbeddings uses `--index-root job.buildRoot`
[x] Use `job.repoRoot` preferentially; warn on mismatch
[x] Fail job with clear error if `buildRoot` missing

### 7.1.4 index_state pending semantics
[x] Stage2 emits pending=true for queued embeddings
[x] Stage3 updates pending/ready/lastError on completion

### 7.1.5 Tests for scoping + worker correctness
[x] Update `tests/embedding-queue.js`
[x] Update `tests/embedding-queue-defaults.js`
[x] Add `tests/indexer-service-embedding-job-uses-build-root.js`

## 7.5 LanceDB robustness improvements
[x] Implement iterative overfetch for large candidateSet
    - [x] `src/retrieval/lancedb.js` (`searchLanceDbCandidates`)
    - [x] capped iterations + deterministic ordering
[x] Make connection cache promise-based, concurrency-safe
[x] Harden filter clause construction (id column + integer candidates)

### Tests
[x] `tests/unit/lancedb-candidate-filtering.test.js`
[x] `tests/unit/lancedb-connection-cache.test.js`
[x] `tests/unit/lancedb-filter-pushdown.test.js`
[x] Update `tests/lancedb-ann.js` if needed

## 7.6 HNSW signature compatibility and observability
[x] Make `loadHnswIndex` signature-tolerant
    - [x] `src/shared/hnsw.js` fallback arity handling + warning
[x] Build/load HNSW indices for merged/doc/code variants
    - [x] `tools/build-embeddings/runner.js`
    - [x] `tools/build-embeddings/hnsw.js`
    - [x] `src/shared/hnsw.js` path resolver
    - [x] `src/retrieval/cli-index.js`
[x] Improve insert failure observability
    - [x] capture failures, write failure report or include in meta
    - [x] keep `.bak` behavior, no manifest entry for `.bak`

### Tests
[x] Update `tests/hnsw-ann.js` (variant existence)
[x] Update `tests/hnsw-atomic.js` (bak fallback still works)
[x] Add `tests/hnsw-target-selection.js`
[x] Add `tests/unit/hnsw-load-signature.test.js`
[x] Add `tests/unit/hnsw-insert-failures.test.js`

## 7.7 Backend policy and ranking equivalence
[x] Wire `search.denseVectorMode` + CLI flag end-to-end
    - [x] `src/retrieval/cli-args.js` add `--dense-vector-mode`
    - [x] `src/retrieval/cli/normalize-options.js` read config + CLI
    - [x] `src/retrieval/cli/resolve-run-config.js` keep value
    - [x] `docs/guides/search.md` update
    - [x] `docs/guides/embeddings.md` update
    - [x] Log when CLI overrides config; precedence CLI > config > defaults
    - [x] `docs/config/schema.json` and/or `docs/config/inventory.md` updated for config + flag docs
    - [x] docs/config/schema.json and/or docs/config/inventory.md updated for config + flag docs
[x] Add `--non-strict` to search CLI (flag only)
    - [x] `src/retrieval/cli-args.js` add flag
    - [x] `src/retrieval/cli/normalize-options.js` set `strict=false` when flag set
    - [x] `src/retrieval/cli/index-loader.js`/`load-indexes.js` use strict option for manifest
    - [x] Warn when non-strict fallback used
[x] Ensure ANN target selection matches denseVectorMode
    - [x] `src/shared/lancedb.js` (verify resolved target)
    - [x] `src/shared/hnsw.js` path selection
    - [x] SQLite-vec behavior documented/enforced if merged-only

### Parity tests
[@] Add `tests/integration/ann-parity.test.js`
[x] Add `tests/unit/dense-vector-mode.test.js`
[x] Add `tests/unit/ann-backend-selection.test.js`
[x] Verify existing `tests/hnsw-ann.js` / `tests/lancedb-ann.js`

## 7.8 Storage resilience (LMDB / SQLite / cache)
[x] LMDB mapSize planning
    - [x] `tools/build-lmdb-index.js` estimate mapSize + store meta
    - [x] `src/storage/lmdb/schema.js` meta keys
[x] SQLite dense writer safety for shared DB paths
    - [x] mode-specific ANN table names or mode column
    - [x] update `tools/build-embeddings/sqlite-dense.js`
    - [x] update `tools/vector-extension.js`
[x] Embedding cache preflight metadata
    - [x] `tools/build-embeddings/cache.js` write meta
    - [x] `tools/build-embeddings/runner.js` read meta

### Tests
[x] Update LMDB tests to assert mapSize meta
[x] Add `tests/unit/lmdb-mapsize.test.js`
[x] Add `tests/unit/sqlite-ann-mode-scope.test.js`
[x] Add `tests/unit/cache-preflight-meta.test.js`
[x] Add `tests/storage/embeddings-backend-resilience.test.js`

## Addendum: Strict manifest compliance requirements
[x] Ensure strict mode never guesses filenames for embeddings/ANN artifacts
[x] Ensure non-strict search is opt-in only and emits warnings
[x] Validate manifest entry counts in strict validation

## Fixtures + stub embeddings
[x] Create/verify fixtures under `tests/fixtures/embeddings/`
    - [x] `basic-repo/`
    - [x] `missing-vectors/`
    - [x] `quantization-caps/`
[x] Ensure stub embeddings path is used (`PAIROFCLEATS_EMBEDDINGS=stub`)
[x] Verify deterministic output for ANN parity tests

## Compatibility checklist (Phase 7)
[x] Do not rename dense vector files
[x] Queue payload versioning explicit + safe upgrade path
[x] index_state fields additive only
[x] Strict manifest missing -> fail; non-strict -> warn + fallback
[x] Optional deps (hnswlib/lancedb) remain optional and do not advertise missing backends
[x] Quantization clamp may invalidate caches; document clearly

## Final audit (after all Phase 7 tasks)
[x] Evaluate all search/embeddings code + tests for any remaining updates needed
[x] Confirm lane mappings for any newly added tests
[x] Confirm optional-dep tests skip cleanly on missing dependencies

## Test execution plan (per-area)
[x] Area 7.2 manifest/strict: run manifest + artifact-io tests first
[x] Area 7.3 quantization: run quantize + no-wrap tests
[x] Area 7.4 normalization: run normalization + hnsw/lancedb tests
[x] Area 7.1 queue/worker: run embedding-queue + indexer-service test
[x] Area 7.5 lancedb: run unit lancedb tests + lancedb-ann
[x] Area 7.6 hnsw: run unit hnsw tests + hnsw-ann + hnsw-atomic
[@] Area 7.7 policy/parity: run denseVectorMode/unit + ann-parity
[x] Area 7.8 storage: run lmdb/sqlite/cache tests + storage resilience

---

## Silent test logging + env sync sweep
[x] Add shared helper for env sync + opt-in logging
    - [x] `tests/helpers/test-env.js`
[x] `tests/abort/abort-propagates-to-subprocess.test.js`
[x] `tests/harness/timeout-target.js`
[x] `tests/subprocess/abort-kills-child.test.js`
[x] `tests/subprocess/spawn-error-propagates.test.js`
[x] `tests/subprocess/timeout-kills-child.test.js`
[x] `tests/perf/sqlite-p95-latency.test.js`
[x] `tests/helpers/kill-tree.js`
[x] `tests/api-server-stream.js`
[x] `tests/helpers/api-server.js`
[x] `tests/download-dicts.js`
[x] `tests/perf/bench/run.test.js`
[x] `tests/subprocess-quoting.js`

---

## Status log / conflicts
- 2026-01-31: Plan created.
- 2026-01-31: Phase 7.2.1-7.2.3 schema, manifest writer, strict loader updates in progress (non-strict warnings still pending).
- 2026-01-31: Phase 7.2.4/7.2.5 done; non-strict manifest warnings + optional-deps helper + tests added.
- 2026-01-31: Phase 7.3.1 clamp applied across quantization helpers.
- 2026-01-31: Phase 7.3.3-7.3.5 quantization metadata + sqlite consumption + tests added.
- 2026-01-31: Phase 7.4 normalization wiring + consistency tests completed.
- 2026-01-31: Phase 7.1 payload + worker updates in progress (tests pending).
- 2026-01-31: Ran `node tests/embedding-queue.js` and `node tests/embedding-queue-defaults.js` (passed).
- 2026-01-31: Phase 7.5 LanceDB robustness code changes done (tests pending).
- 2026-01-31: Ran `node tests/indexer-service-embedding-job-uses-build-root.js` (passed).
- 2026-01-31: Ran LanceDB unit tests (`lancedb-candidate-filtering`, `lancedb-connection-cache`, `lancedb-filter-pushdown`) (passed).
- 2026-01-31: Phase 7.1 embedding job payload + worker updates completed.
- 2026-01-31: Ran `node tests/lancedb-ann.js` (passed).
- 2026-01-31: Ran HNSW tests (`hnsw-target-selection`, `hnsw-load-signature`, `hnsw-insert-failures`, `hnsw-atomic`, `hnsw-ann`) (passed).
- 2026-01-31: Phase 7.6 HNSW compatibility + observability updates completed.
- 2026-01-31: Added sqlite-vec merged-only guard and docs note; added ann-parity integration test.
- 2026-01-31: Ran `node tests/integration/ann-parity.test.js` (passed).
- 2026-01-31: Phase 7.8 storage resilience updates (LMDB mapSize meta, sqlite ANN table scoping, cache preflight meta).
- 2026-01-31: Ran `node tests/unit/cache-preflight-meta.test.js`, `node tests/unit/sqlite-ann-mode-scope.test.js`, `node tests/storage/embeddings-backend-resilience.test.js`, `node tests/unit/lmdb-mapsize.test.js` (passed).
- 2026-01-31: Updated LanceDB ANN test to cover doc/code variants; ran `node tests/lancedb-ann.js` (passed).
- 2026-01-31: Updated embeddings guide for ANN variant capability matrix.
- 2026-01-31: Added manifest count validation in strict index validation; documented quantization clamp cache impact.
- 2026-01-31: Added embeddings fixtures (basic, missing-vectors, quantization-caps).
- 2026-01-31: Ran `node tests/manifest-embeddings-pieces.js`, `node tests/artifact-io-manifest-discovery.test.js`, `node tests/retrieval-strict-manifest-embeddings.js` (passed).
- 2026-01-31: Completed Phase 7 search/embeddings audit; no additional updates required.
