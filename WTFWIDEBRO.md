# WTFWIDEBRO
- C:/Users/sneak/Development/PairOfCleats_CODEX/WIDESWEEPS/CODEBASE_WIDE_SWEEP_ARTIFACTS_SHARDS_FINAL.md: Skipped; requires broader design/policy decisions before changes. Full sweep content:

`
# Codebase Static Review Findings — Wide Sweep C (Final, Merged)

**Scope / focus:** Artifact emission + postings correctness + shard planning + embedding materialization (format correctness, determinism, and high-risk silent degradation).

**Merged sources (wide sweep drafts):**
- `CODEBASE_WIDE_SWEEP_ARTIFACTS_SHARDS.md`
- `CODEBASE_STATIC_REVIEW_FINDINGS_PASS12C_WIDE_ARTIFACTS_POSTINGS_SHARDS.md`
- `CODEBASE_STATIC_REVIEW_FINDINGS_PASS12C_WIDE_ARTIFACTS_POSTINGS_SHARDS_EMBEDDINGS.md`

## Severity key

- **P0 / Critical**: silent corruption risk, non-deterministic docId joins, or artifacts that look valid but are inconsistent.
- **P1 / High**: correctness loss at scale, partial/invalid artifacts, or major performance cliffs.
- **P2 / Medium**: quality/maintainability debt, observability gaps.

## Executive summary

The build pipeline currently treats artifacts/postings/shards/embeddings as “later materialization,” but several implicit assumptions make this fragile:

1. **Work deferral (tree-sitter missing WASM) can reorder processing mid-build**, changing docId assignment and artifact ordering. Multiple consumers assume docId is stable and/or dense.
2. **Shard planning is not segment-aware** and does not enforce language grouping constraints needed for tree-sitter WASM loading and throughput.
3. **Integrity artifacts (checksums / manifests) are computed early but can become stale** after later stages mutate artifacts (e.g., stage 3/4 emissions), undermining incremental validation.
4. **Several joins are effectively implicit array-index joins by docId**, but the pipeline does not validate alignment across chunk-meta, postings, filter-index, vectors, and fts — a high-risk silent degradation.
5. **Embedding materialization is not first-class**: dims/model/stage boundaries and JSON serialization hazards can silently degrade retrieval.

---

## Findings

### P0 — Tree-sitter language deferral can reorder file processing mid-build, destabilizing docId assignment

**Where**
- File processing and deferral:
  - `src/index/build/indexer/steps/process-files.js` (e.g., `discoverAndDeferMissingWasmLanguages(...)`)
  - `src/index/build/runtime/tree-sitter.js`
  - `src/lang/tree-sitter/runtime.js`

**What’s wrong**
- When a missing tree-sitter WASM language is discovered, processing is deferred and potentially re-queued.
- If docIds are assigned as files are processed, this changes ordering and can break any assumption that:
  - docId assignment is deterministic,
  - docId is stable across builds,
  - docId maps 1:1 to the Nth row in arrays emitted later.

**Suggested fix**
- Decouple docId allocation from traversal order:
  - allocate docId based on stableChunkId ordering (canonical sort),
  - or assign docIds only after a complete FileSet + segment plan is known.
- Prefer “language-grouped processing” so WASM availability is known up front.

**Tests**
- A fixture that triggers a missing WASM deferral; verify:
  - stableChunkIds unchanged,
  - docId→stableChunkId mapping is consistent and validated.

---

### P0 — Integrity artifacts (checksums/manifests) can become stale after later-stage writes

**Where**
- Checksums and integrity:
  - `src/index/build/artifacts/checksums.js`
  - `src/index/build/artifacts/writer.js`
- Chunk-meta writer and later-stage emissions:
  - `src/index/build/artifacts/writers/chunk-meta.js`

**What’s wrong**
- Integrity metadata is computed for a stage boundary, but subsequent stages may write/append artifacts that are not reflected in the integrity metadata.
- Incremental validation and “fail closed” checks can therefore pass while the promoted index has internally inconsistent parts.

**Suggested fix**
- Treat integrity artifacts as the final stage output:
  - compute checksums only after all writers have completed,
  - stamp integrity with `{buildSignature, schemaVersion, artifactSetHash}`.
- Alternatively: incremental checksums per artifact, re-computed on append.

**Tests**
- Run a build that writes stage3/4 artifacts after checksums computed; assert:
  - validate detects mismatch and fails closed.

---

### P0 — DocId alignment is assumed but not validated (implicit array-index joins across artifacts)

**Where**
- Postings and related materializations:
  - `src/index/build/postings.js`
  - `src/index/build/indexer/steps/postings.js`
- Retrieval and bitmap joins:
  - `src/retrieval/bitmap.js`
  - `src/retrieval/fts.js`
- SQLite ingestion from artifacts:
  - `src/storage/sqlite/build/from-artifacts.js`

**What’s wrong**
- Multiple components implicitly assume:
  - docId is dense 0..N-1,
  - docId corresponds to array index in multiple arrays (chunk meta, postings vectors, fts rows).
- The system does not enforce or validate this alignment across artifact sets.
- Any reordering (deferrals, incremental reuse, shard merges) can produce *silent wrong joins*.

**Suggested fix**
- Emit explicit join tables:
  - `docId -> stableChunkId`
  - per-artifact row indices -> stableChunkId
- Validate at load time:
  - verify that all required stableChunkIds exist exactly once across artifact sets.
- Never use docId as an implicit join key without verification.

**Tests**
- Add a contract test that loads all artifacts and asserts:
  - join completeness and bijection,
  - stableChunkId exists in chunk-meta and postings and vectors.

---

### P0 — Shard planning is not segment-aware and cannot enforce language-group processing

**Where**
- Shard planning:
  - `src/index/build/shards.js`
  - shard writers and emission:
    - `src/index/build/artifacts/writers/*` (chunk-meta, repo-map, file-relations)
- Language/segment logic:
  - `src/index/segments.js`

**What’s wrong**
- Shards appear to be derived primarily from file-level keys and/or file ordering.
- Segment-level language can differ from file-level extension, but shard planning does not operate at segment/chunk granularity.
- This makes “process all TS chunks with TS tooling / tree-sitter TS wasm” infeasible and increases deferral/retry behavior.

**Suggested fix**
- Shard by canonical `(languageId, stableChunkId range)` not by file extension.
- Create a shard plan that can guarantee:
  - for each shard, required WASM/tooling dependencies are installed/available.

---

### P1 — Artifact size policy and writer boundaries are not tuned for throughput and correctness

**Where**
- Artifact size policy:
  - `src/index/build/artifacts/metrics.js`
  - `src/index/build/artifacts/compression.js`
- Writers:
  - `src/index/build/artifacts/writer.js`

**What’s wrong**
- Very large JSONL pieces can cause:
  - high memory spikes,
  - slow GC,
  - slow streaming reads,
  - partial-write risk windows.
- Writer boundaries appear to be set without a consistent “target piece size” contract.

**Suggested fix**
- Enforce a target piece size (e.g., 8–32 MB), per artifact type.
- Use newline-delimited streaming with strict flush points and atomic “piece finalize” markers.

---

### P1 — Embedding materialization semantics are not first-class (dims/model/stage boundaries)

**Where**
- Embedding processing:
  - `src/index/build/file-processor/embeddings.js`
  - `src/index/embedding.js`
  - `src/index/build/tokenization.js` (inputs to embeddings)
- Retrieval ANN providers and dims expectations:
  - `src/retrieval/ann/providers/*`
  - `src/retrieval/ann/types.js`

**What’s wrong**
- Dims/model identity may be validated in some places, but not treated as a hard “build signature” component everywhere.
- There are hazards around:
  - mixing embeddings across stages,
  - fallback behavior when dims mismatch,
  - JSON serialization of embedding vectors / metrics.

**Suggested fix**
- Make embeddings a stage artifact with a manifest:
  - `embeddings.manifest.json` contains modelId, dims, chunkSetHash.
- Require retrieval to verify manifest matches index signature.

---

### P1 — JSON hazards: NaN/Infinity and non-JSON values can silently break downstream readers

**Where**
- Any JSON/JSONL emission that might serialize metrics/vectors:
  - `src/shared/json-stream.js`
  - `src/index/build/artifacts/writers/*`

**What’s wrong**
- Standard `JSON.stringify` will serialize `NaN` and `Infinity` as `null`, silently corrupting numeric fields.

**Suggested fix**
- Centralize JSON serialization with a strict replacer that:
  - rejects non-finite numbers (fail closed) or encodes them explicitly with a tagged representation.

---

### P2 — Shard plan language keys may not match analysis/runtime keys (file-language vs engine-language)

**Where**
- Shard planning and metadata:
  - `src/index/build/shards.js`

**Suggested fix**
- Define `languageId` as the canonical language key in all shard plans and artifacts.
- Do not use file extension as the shard language key.

---

## “Keep it right” invariants for artifacts/shards

1. Artifact sets must be internally join-consistent (docId/stableChunkId mapping validated).
2. Checksums/manifests must reflect the final artifact set (computed last).
3. Shard plans must be segment-aware and language-grouped.
4. Embedding artifacts must be manifest-stamped and validated by retrieval.
`

- C:/Users/sneak/Development/PairOfCleats_CODEX/WIDESWEEPS/CODEBASE_WIDE_SWEEP_BUILD_RUNTIME_FINAL.md: Skipped; requires broader design/policy decisions before changes. Full sweep content:

`
# Codebase Static Review Findings — Wide Sweep B (Final, Merged)

**Scope / focus:** Build/runtime orchestration and operational robustness (watch mode, workers, promotion/current.json, signature hashing, entrypoint/lint drift), plus file discovery + file processor correctness and scaling (preprocess/read/scan, incremental reuse/cached bundles, caps, context windows, experimental structural boundary checks).

**Merged sources (wide sweep drafts):**
- `CODEBASE_WIDE_SWEEP_BUILD_RUNTIME.md`
- `CODEBASE_STATIC_REVIEW_FINDINGS_PASS12_WIDE_BUILD_ORCHESTRATION_AND_FILE_PROCESSING.md`
- `CODEBASE_STATIC_REVIEW_FINDINGS_PASS12B_WIDE_BUILD_RUNTIME_ORCHESTRATION.md`
- `CODEBASE_STATIC_REVIEW_FINDINGS_PASS12B_WIDE_BUILD_RUNTIME_DISCOVERY.md`

## Severity key

- **P0 / Critical**: can corrupt builds, promote partial indexes, mix artifacts across runs, or silently degrade correctness.
- **P1 / High**: operational drift or correctness loss at scale; common failure modes.
- **P2 / Medium**: maintainability debt or edge-case correctness issues that become P0 as throughput increases.
- **P3 / Low**: polish.

## Executive summary

The codebase has the right *pieces* for a robust index build lifecycle (locking, staging, artifacts, promotion, incremental reuse), but there are several cross-cutting orchestration failures that make the system fragile:

1. **Background embedding jobs are not pinned to a build root** and can cross-contaminate between runs. This is the single largest “silent corruption” risk in the build path.
2. **Promotion is not transactionally end-to-end**: `current.json` can point at a build whose artifacts are incomplete or internally inconsistent, especially when later stages run after “promotion-like” state updates.
3. **Stage semantics and signatures drift**: multiple signature algorithms and stage override paths exist, but are not enforced as part of a single canonical build contract.
4. **Discovery is not canonical**: multiple file scanning/preprocess/discover/watch paths can yield different file sets for the same repo, breaking determinism and incremental reuse.

The best forward direction is to model the build as a strict **BuildRoot transaction**:
- create → stage1 → stage2 → stage3 → stage4 → validate → finalize → promote (atomic pointer flip) → cleanup.

---

## Findings

### P0 — Background embedding jobs are not bound to a build root (cross-run mixing risk)

**Why this is critical**
- Embeddings are expensive and often run concurrently. If embedding jobs are not scoped to a single build root, the system can write embeddings that belong to a *different* index build into the currently promoted index.

**Where**
- Embedding job queue / scheduling:
  - `src/index/build/indexer/embedding-queue.js`
  - `src/shared/embedding-batch.js`
  - `src/shared/onnx-embeddings.js` (session/queue semantics)
- Integrations that enqueue build-side work:
  - `src/integrations/core/index.js`
- Promotion/runtime orchestration:
  - `src/index/build/promotion.js`
  - `src/index/build/build-state.js`

**What’s wrong**
- The queue appears to be keyed to a process-level epoch / runtime rather than a concrete build root artifact directory.
- The promotion layer does not appear to “join” on embedding completion (or validate that embedding outputs correspond to the same build signature).

**Suggested fix**
- Make embedding work a first-class stage in the build DAG:
  - `BuildRoot/<id>/embeddings/…`
  - embedding outputs stamped with `{buildId, buildSignature, modelId, dims}`
- Introduce a strict rule:
  - **No promotion** until embedding materialization has either completed or been explicitly marked as “skipped with reason”.
- If you keep background embedding:
  - require all writes to go through an atomic, build-root–scoped writer that refuses mismatched `{buildId, signature}`.

**Keep-it-right tests**
- Start two builds concurrently (different repos or different build roots) and ensure:
  - embeddings written in each build root match only that build’s manifest,
  - promotion never points to an index with mixed embedding metadata.

---

### P0 — Promotion (`current.json`) is not end-to-end transactional across all artifacts

**Why this is critical**
- The system relies on `current.json` (and/or a promoted pointer) as the “what is current” source of truth.
- If promotion happens before all artifacts are stable, readers can observe incomplete or inconsistent indexes.

**Where**
- Promotion logic:
  - `src/index/build/promotion.js`
  - `src/index/build/runtime/runtime.js`
  - `src/index/build/records.js` (if promotion touches record state)
- Writer behavior:
  - `src/index/build/artifacts/writer.js`
  - `src/shared/artifact-io.js` / atomic replace paths

**What’s wrong**
- Promotion does not appear to be a two-phase commit covering:
  - piece manifests,
  - chunk-meta/relations/graphs,
  - postings / filter-index,
  - embeddings materialization,
  - integrity checksums.
- There are multiple “partial promote” states (e.g., stage 2 promoted, later stage writes still occurring).

**Suggested fix**
- Implement a strict promote transaction:
  1) write all artifacts in `BuildRoot/tmp`  
  2) run `validate(BuildRoot)` (includes internal checksums + schema validation)  
  3) write `BuildRoot/READY` marker  
  4) atomic rename/symlink swap to `current` (or atomic update of `current.json`)  
  5) never mutate artifacts under `current` after the pointer flip.

**Keep-it-right tests**
- Kill the build process at random points; verify:
  - `current` always points to a validated build,
  - incomplete builds are never visible as current.

---

### P0 — Stage semantics and signature hashing are not canonical (drift across entrypoints)

**Where**
- Stage overrides and gating:
  - `src/index/build/runtime/stage.js`
  - `src/index/build/runtime/runtime.js`
- Signature hashing:
  - `src/index/build/signatures.js`
  - `src/index/build/indexer/signatures.js`
- Entrypoints:
  - `build_index.js`, `bin/pairofcleats.js`, `tools/*`

**What’s wrong**
- Multiple “signature” concepts exist (plan signature, build signature, index signature), but not all of them are enforced as hard gates for incremental reuse or promotion.
- Stage override paths can allow running later stages with inputs that do not match the earlier stage’s signature.

**Suggested fix**
- Define one canonical `BuildSignature` computed from:
  - repo state (commit-ish / worktree hash),
  - config (including policy),
  - model ids / dims,
  - chunking options,
  - tooling versions,
  - shard plan inputs.
- Store `BuildSignature` in build root and stamp every artifact with it.
- If stage overrides are allowed, require explicitly passing and validating the signature.

---

### P1 — Watch mode rebuilds can drift: overlapping builds, inconsistent change sets, and worker lifecycle issues

**Where**
- Watch orchestrators:
  - `src/index/build/watch.js`
  - backends: `src/index/build/watch/backends/chokidar.js`, `src/index/build/watch/backends/parcel.js`
- Worker pool:
  - `src/index/build/worker-pool.js`
  - `src/index/build/runtime/workers.js`

**What’s wrong**
- Watch rebuilds are susceptible to:
  - re-entrant triggers while previous stages are still running,
  - partial change-set processing without a strict “rebase onto new snapshot” semantics,
  - long-lived workers holding stale config, stale caches, or stale stage overrides.

**Suggested fix**
- Move watch mode to a snapshot queue model:
  - each watch “tick” produces a snapshot `{fileSetHash, changedPaths, timestamp}`,
  - the builder processes snapshots sequentially and cancels superseded ones.
- Add explicit worker lifecycle management:
  - workers must subscribe to a build root, and be torn down or reinitialized when the build root changes.

---

### P1 — File discovery is not canonical (multiple pipelines can disagree about what is indexed)

**Where**
- Discovery/preprocess:
  - `src/index/build/preprocess.js`
  - `src/index/build/discover.js`
  - `src/index/build/file-scan.js`
  - `src/index/build/ignore.js`

**What’s wrong**
- There are multiple “enumerate files” passes, and not all of them share the same ignore policy / overrides / path normalization.
- This breaks:
  - determinism (different ordering and membership),
  - incremental reuse (signature computed from different inputs),
  - user expectations (“why wasn’t file X indexed?”).

**Suggested fix**
- Implement a single `FileSet` contract:
  - `FileSet = { canonicalRoot, files: [{path, size, mtime, hash?}], ignored: [...] }`
- Ensure all stages (preprocess, discover, watch, incremental) consume the same `FileSet` artifact.
- Make ignore overrides part of the signature.

**Tests**
- Fixture repo with ignore overrides, symlinks, and generated files:
  - assert preprocess/discover/watch all produce the same FileSet.

---

### P1 — Cached bundles and incremental reuse boundaries are under-specified

**Where**
- Cached bundle:
  - `src/index/build/file-processor/cached-bundle.js`
- Incremental reuse:
  - `src/index/build/incremental.js`
  - `src/index/build/file-processor/incremental.js`
- Locking:
  - `src/index/build/lock.js`

**What’s wrong**
- Reuse decisions depend on signatures and manifests, but:
  - not all relevant inputs are included in signatures,
  - stale bundles can be reused if validity checks are too shallow.

**Suggested fix**
- Require every cached bundle to carry:
  - `bundleInputsHash` including tooling versions, chunking options, and language registry selection.
- Fail closed: if bundle cannot be proven valid, rebuild.

---

### P2 — Symlink/realpath handling can cause duplicate indexing or ignored files

**Where**
- Discovery and ignore:
  - `src/index/build/discover.js`
  - `src/index/build/ignore.js`
- Watch backends:
  - `src/index/build/watch/backends/*`

**Suggested fix**
- Canonicalize paths early:
  - `canonicalPath = realpath + normalized separators`
- Decide explicitly whether symlinks are allowed; if allowed, treat them as separate roots with explicit policy.

---

### P2 — Operational observability is fragmented (metrics, crash logs, failure taxonomy)

**Where**
- Metrics & profiling:
  - `src/index/build/feature-metrics.js`
  - `src/index/build/perf-profile.js`
- Crash logs:
  - `src/index/build/crash-log.js`
  - `src/index/build/failure-taxonomy.js`

**Suggested fix**
- Produce one build “run report” artifact per build:
  - stages + durations,
  - workers utilized,
  - cache hits/misses,
  - errors/warnings with stable codes.

---



### P2 — Build summaries and downstream reporting depend on preprocess artifacts that may be stale

**Where**
- Preprocess summary:
  - `src/index/build/preprocess.js`
- Build summary/reporting:
  - `src/index/build/summary.js`
  - `src/index/build/report.js` (if present)

**What’s wrong**
- Some “what happened” summaries rely on preprocess-time outputs (`preprocess.json`, file counts, sizes, ignore decisions).
- If discovery/reprocessing changes the effective FileSet after preprocess (or watch mode mutates it), summaries can misreport what was actually indexed.

**Suggested fix**
- Make reporting consume the canonical `FileSet` artifact produced for the build root (post-discovery), not preprocess scratch outputs.

---

### P2 — Context-window / budget selection is computed late but not enforced as a signature input

**Where**
- Context expansion budget and config:
  - `src/index/build/context-window.js`
  - `src/retrieval/context-expansion.js`

**What’s wrong**
- If context budgets are derived from prescan/import metadata but not included in `BuildSignature`, you can:
  - reuse cached bundles that were built under different budgets,
  - promote indexes whose retrieval behavior differs from the build’s intended constraints.

**Suggested fix**
- Treat context budgets and normalization knobs as signature inputs.
- Stamp them into the build manifest and require retrieval to honor them.

---

### P2 — `current.json`/manifest schema drift: multiple shapes and partial back-compat increase risk

**Where**
- Current pointer and manifest loading:
  - `src/index/build/promotion.js`
  - `src/index/build/runtime/runtime.js`

**What’s wrong**
- Allowing multiple shapes for current pointers and manifests makes it easy to accidentally ship a writer that emits a new field (or drops an old one) without readers noticing until later.

**Suggested fix**
- Version `current.json` (or replace it with a versioned manifest file).
- Validate schema on both write and read; fail closed on unknown major versions.


## “Keep it right” build invariants

1. `current.json` must only point to a build root with a `READY` marker and a validated manifest.
2. Every artifact must be stamped with `{buildId, buildSignature, schemaVersion}`.
3. Watch mode must never run overlapping build roots simultaneously.
4. File discovery must produce a canonical FileSet artifact consumed by all later stages.
5. Incremental reuse must be provably safe (fail closed if uncertain).
`

