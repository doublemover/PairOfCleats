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

