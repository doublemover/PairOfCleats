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
[ ] Reconcile conflicts A/B/C and record decisions in docs if needed
    - [ ] Conflict A: queue payload fields (`buildRoot` vs `indexDir`) documented and normalized
    - [ ] Conflict B: manifest includes non-JSON artifacts (HNSW/LanceDB) even without JSON schemas
    - [ ] Conflict C: strict loaders use manifest-only resolution (no guessed filenames)
[ ] Verify terminology is aligned in docs + code comments where needed
    - [ ] `repoRoot`, `buildRoot`, `indexDir`, `mode`, `denseVectorMode`, ANN target naming
[ ] Confirm capability matrix after Phase 7 is achievable and is reflected in docs
    - [ ] Dense exact ranking supports merged/doc/code
    - [ ] LanceDB supports merged/doc/code
    - [ ] HNSW supports merged/doc/code
[ ] Ensure strict-manifest addendum is referenced in Phase 7 docs (if missing)
[ ] Update test lane rules so CI classifies new tests correctly
    - [ ] `tests/run.rules.jsonc` updated for new Phase 7 tests or confirm names match rules
[ ] Add shared optional-deps test helper
    - [ ] `tests/helpers/optional-deps.js` provides consistent skip + messaging

## 7.2 Artifact contract parity for embeddings + ANN
### 7.2.1 Canonical artifact names (public surface)
[ ] Update docs/contracts to list canonical names + formats
    - [ ] `docs/contracts/public-artifact-surface.md`
    - [ ] `docs/contracts/artifact-schemas.md`
[ ] Align contract registry if needed
    - [ ] `src/contracts/registry.js`
    - [ ] `src/contracts/schemas/artifacts.js`
[ ] Ensure canonical names defined for:
    - [ ] dense vectors (merged/doc/code)
    - [ ] HNSW (bin + meta) merged/doc/code
    - [ ] LanceDB (dir + meta) merged/doc/code
    - [ ] sqlite-vec optional meta marker

### 7.2.2 Manifest writer includes non-JSON artifacts
[ ] Update `tools/build-embeddings/manifest.js`
    - [ ] Allowlist includes bin/dir artifacts in addition to `ARTIFACT_SCHEMA_DEFS`
    - [ ] Add entries when files/dirs exist
    - [ ] `format: bin|dir` for HNSW/LanceDB
    - [ ] Bytes/sha256 for files; deterministic dir sizing if implemented
    - [ ] Exclude `.bak` artifacts from manifest

### 7.2.3 Strict loaders must use manifest
[ ] Add/extend manifest helper(s) for binary/dir artifacts
    - [ ] `src/shared/artifact-io.js`
    - [ ] `src/shared/artifact-io/manifest.js`
    - [ ] Ensure strict=default; non-strict uses legacy guessing w/ warning
[ ] Update retrieval loaders
    - [ ] `src/retrieval/cli-index.js` (dense + HNSW paths)
    - [ ] `src/retrieval/cli/load-indexes.js` (LanceDB attach)
[ ] Update validator to require manifest entries in strict mode
    - [ ] `src/index/validate.js`

### 7.2.4 index_state embedding identity + backend presence
[ ] Stage2 (build index) emits identity + pending fields
    - [ ] `src/index/build/indexer/steps/write.js`
[ ] Stage3 (build-embeddings) updates ready/pending + backends
    - [ ] `tools/build-embeddings/runner.js`
    - [ ] Include `embeddingIdentity`, `embeddingIdentityKey`, `backends.*`

### 7.2.5 Tests for manifest completeness + strict discovery
[ ] Add manifest coverage tests
    - [ ] `tests/manifest-embeddings-pieces.js`
    - [ ] `tests/artifact-io-manifest-discovery.test.js` updates
[ ] Add strict retrieval failure test
    - [ ] `tests/retrieval-strict-manifest-embeddings.js`
[ ] Add sqlite-vec marker test (if marker implemented)
    - [ ] ensure manifest entry appears only when sqlite-vec built
[ ] Ensure all optional-dependency tests skip when deps missing (hnswlib-node, lancedb, sqlite-vec)
    - [ ] Update `docs/testing/truth-table.md` to codify skip behavior for optional deps
    - [ ] Use `tests/helpers/optional-deps.js` helper for consistent skips

## 7.3 Quantization invariants end-to-end
### 7.3.1 Clamp quantization levels globally
[ ] Clamp in `src/storage/sqlite/vector.js` (`resolveQuantizationParams`)
[ ] Clamp in `src/shared/embedding-utils.js` (`quantizeEmbeddingVector`, `quantizeEmbeddingVectorUint8`)
[ ] Ensure all call paths use clamped quantizer
    - [ ] `src/index/embedding.js`
    - [ ] `tools/build-embeddings/embed.js`
    - [ ] `src/storage/sqlite/build/incremental-update.js`
    - [ ] `src/index/build/file-processor/embeddings.js`

### 7.3.2 Ensure uint8 artifacts are actually 0..255
[ ] Validate dense JSON vectors never exceed 255
[ ] Validate sqlite dense vectors never wrap (Uint8Array safe)

### 7.3.3 Persist quantization metadata
[ ] Add `minVal/maxVal/levels` to dense vector JSON artifacts
[ ] Add quantization metadata to HNSW meta
[ ] Add quantization metadata to LanceDB meta
[ ] Consume quantization metadata in retrieval / dequant paths
    - [ ] `src/retrieval/rankers.js`
    - [ ] `src/retrieval/sqlite-helpers.js`
    - [ ] `tools/build-embeddings/lancedb.js`

### 7.3.4 LanceDB dequantization correctness
[ ] Pass quantization params into LanceDB builder
    - [ ] `tools/build-embeddings/runner.js`
    - [ ] `tools/build-embeddings/lancedb.js`

### 7.3.5 Quantization tests
[ ] Add/extend unit tests for clamp and uint8 bounds
    - [ ] `tests/quantize-embedding-utils.js` (or new)
    - [ ] `tests/embedding-quantization-no-wrap.js`

## 7.4 Normalization policy consistency
### 7.4.1 Enforce normalization rules
[ ] Ensure normalize=true always normalizes before storage
    - [ ] `src/shared/embedding-adapter.js`
    - [ ] `tools/build-embeddings/embed.js`
    - [ ] `src/index/build/file-processor/embeddings.js`
    - [ ] `tools/build-embeddings/runner.js` (cache load + HNSW path)
[ ] Define merged vector behavior for missing doc vectors
    - [ ] confirm zero-fill + normalize path

### 7.4.2 Normalization tests
[ ] Add `tests/embedding-normalization-consistency.js`
[ ] Update `tests/hnsw-ann.js` and `tests/lancedb-ann.js` for normalize metadata + parity

## 7.1 Embedding jobs build-scoped, deterministic, idempotent
### 7.1.1 Job payload schema (v2)
[ ] Update `src/index/build/indexer/embedding-queue.js` validation
[ ] Update `tools/service/queue.js` payload handling
[ ] Update `tools/indexer-service.js` to accept/validate v2
[ ] Add legacy v1 upgrade path + warning

### 7.1.2 Fix enqueue site
[ ] Update `src/index/build/indexer/pipeline.js` to send `buildRoot` + `indexDir`
[ ] Normalize legacy `indexRoot` when present
[ ] Validate `indexDir` is inside `buildRoot`

### 7.1.3 Worker uses buildRoot
[ ] `tools/indexer-service.js` runBuildEmbeddings uses `--index-root job.buildRoot`
[ ] Use `job.repoRoot` preferentially; warn on mismatch
[ ] Fail job with clear error if `buildRoot` missing

### 7.1.4 index_state pending semantics
[ ] Stage2 emits pending=true for queued embeddings
[ ] Stage3 updates pending/ready/lastError on completion

### 7.1.5 Tests for scoping + worker correctness
[ ] Update `tests/embedding-queue.js`
[ ] Update `tests/embedding-queue-defaults.js`
[ ] Add `tests/indexer-service-embedding-job-uses-build-root.js`

## 7.5 LanceDB robustness improvements
[ ] Implement iterative overfetch for large candidateSet
    - [ ] `src/retrieval/lancedb.js` (`searchLanceDbCandidates`)
    - [ ] capped iterations + deterministic ordering
[ ] Make connection cache promise-based, concurrency-safe
[ ] Harden filter clause construction (id column + integer candidates)

### Tests
[ ] `tests/unit/lancedb-candidate-filtering.test.js`
[ ] `tests/unit/lancedb-connection-cache.test.js`
[ ] `tests/unit/lancedb-filter-pushdown.test.js`
[ ] Update `tests/lancedb-ann.js` if needed

## 7.6 HNSW signature compatibility and observability
[ ] Make `loadHnswIndex` signature-tolerant
    - [ ] `src/shared/hnsw.js` fallback arity handling + warning
[ ] Build/load HNSW indices for merged/doc/code variants
    - [ ] `tools/build-embeddings/runner.js`
    - [ ] `tools/build-embeddings/hnsw.js`
    - [ ] `src/shared/hnsw.js` path resolver
    - [ ] `src/retrieval/cli-index.js`
[ ] Improve insert failure observability
    - [ ] capture failures, write failure report or include in meta
    - [ ] keep `.bak` behavior, no manifest entry for `.bak`

### Tests
[ ] Update `tests/hnsw-ann.js` (variant existence)
[ ] Update `tests/hnsw-atomic.js` (bak fallback still works)
[ ] Add `tests/hnsw-target-selection.js`
[ ] Add `tests/unit/hnsw-load-signature.test.js`
[ ] Add `tests/unit/hnsw-insert-failures.test.js`

## 7.7 Backend policy and ranking equivalence
[ ] Wire `search.denseVectorMode` + CLI flag end-to-end
    - [ ] `src/retrieval/cli-args.js` add `--dense-vector-mode`
    - [ ] `src/retrieval/cli/normalize-options.js` read config + CLI
    - [ ] `src/retrieval/cli/resolve-run-config.js` keep value
    - [ ] `docs/guides/search.md` update
    - [ ] `docs/guides/embeddings.md` update
    - [ ] Log when CLI overrides config; precedence CLI > config > defaults
    - [ ] `docs/config/schema.json` and/or `docs/config/inventory.md` updated for config + flag docs
    - [ ] docs/config/schema.json and/or docs/config/inventory.md updated for config + flag docs
[ ] Add `--non-strict` to search CLI (flag only)
    - [ ] `src/retrieval/cli-args.js` add flag
    - [ ] `src/retrieval/cli/normalize-options.js` set `strict=false` when flag set
    - [ ] `src/retrieval/cli/index-loader.js`/`load-indexes.js` use strict option for manifest
    - [ ] Warn when non-strict fallback used
[ ] Ensure ANN target selection matches denseVectorMode
    - [ ] `src/shared/lancedb.js` (verify resolved target)
    - [ ] `src/shared/hnsw.js` path selection
    - [ ] SQLite-vec behavior documented/enforced if merged-only

### Parity tests
[ ] Add `tests/integration/ann-parity.test.js`
[ ] Add `tests/unit/dense-vector-mode.test.js`
[ ] Add `tests/unit/ann-backend-selection.test.js`
[ ] Verify existing `tests/hnsw-ann.js` / `tests/lancedb-ann.js`

## 7.8 Storage resilience (LMDB / SQLite / cache)
[ ] LMDB mapSize planning
    - [ ] `tools/build-lmdb-index.js` estimate mapSize + store meta
    - [ ] `src/storage/lmdb/schema.js` meta keys
[ ] SQLite dense writer safety for shared DB paths
    - [ ] mode-specific ANN table names or mode column
    - [ ] update `tools/build-embeddings/sqlite-dense.js`
    - [ ] update `tools/vector-extension.js`
[ ] Embedding cache preflight metadata
    - [ ] `tools/build-embeddings/cache.js` write meta
    - [ ] `tools/build-embeddings/runner.js` read meta

### Tests
[ ] Update LMDB tests to assert mapSize meta
[ ] Add `tests/unit/lmdb-mapsize.test.js`
[ ] Add `tests/unit/sqlite-ann-mode-scope.test.js`
[ ] Add `tests/unit/cache-preflight-meta.test.js`
[ ] Add `tests/storage/embeddings-backend-resilience.test.js`

## Addendum: Strict manifest compliance requirements
[ ] Ensure strict mode never guesses filenames for embeddings/ANN artifacts
[ ] Ensure non-strict search is opt-in only and emits warnings
[ ] Validate manifest entry counts in strict validation

## Fixtures + stub embeddings
[ ] Create/verify fixtures under `tests/fixtures/embeddings/`
    - [ ] `basic-repo/`
    - [ ] `missing-vectors/`
    - [ ] `quantization-caps/`
[ ] Ensure stub embeddings path is used (`PAIROFCLEATS_EMBEDDINGS=stub`)
[ ] Verify deterministic output for ANN parity tests

## Compatibility checklist (Phase 7)
[ ] Do not rename dense vector files
[ ] Queue payload versioning explicit + safe upgrade path
[ ] index_state fields additive only
[ ] Strict manifest missing -> fail; non-strict -> warn + fallback
[ ] Optional deps (hnswlib/lancedb) remain optional and do not advertise missing backends
[ ] Quantization clamp may invalidate caches; document clearly

## Final audit (after all Phase 7 tasks)
[ ] Evaluate all search/embeddings code + tests for any remaining updates needed
[ ] Confirm lane mappings for any newly added tests
[ ] Confirm optional-dep tests skip cleanly on missing dependencies

## Test execution plan (per-area)
[ ] Area 7.2 manifest/strict: run manifest + artifact-io tests first
[ ] Area 7.3 quantization: run quantize + no-wrap tests
[ ] Area 7.4 normalization: run normalization + hnsw/lancedb tests
[ ] Area 7.1 queue/worker: run embedding-queue + indexer-service test
[ ] Area 7.5 lancedb: run unit lancedb tests + lancedb-ann
[ ] Area 7.6 hnsw: run unit hnsw tests + hnsw-ann + hnsw-atomic
[ ] Area 7.7 policy/parity: run denseVectorMode/unit + ann-parity
[ ] Area 7.8 storage: run lmdb/sqlite/cache tests + storage resilience

---

## Status log / conflicts
- 2026-01-31: Plan created.
