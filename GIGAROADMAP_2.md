# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

### Source-of-truth hierarchy (when specs disagree)
When a document/spec conflicts with the running code, follow this order:

1) **`src/contracts/**` and validators** are authoritative for artifact shapes and required keys.
2) **Current implementation** is authoritative for runtime behavior *when it is already validated by contracts/tests*.
3) **Docs** (`docs/contracts/**`, `docs/specs/**`, `docs/phases/**`) must be updated to match (never the other way around) unless we have a deliberate migration plan.

If you discover a conflict:
- **Prefer “fix docs to match code”** when the code is already contract-validated and has tests.
- **Prefer “fix code to match docs/contracts”** only when the contract/validator is explicit and the code violates it.

### Touchpoints + line ranges (important: line ranges are approximate)
This document includes file touchpoints with **approximate** line ranges like:

- `src/foo/bar.js` **(~L120–L240)** — anchor: `someFunctionName`

Line numbers drift as the repo changes. Treat them as a **starting hint**, not a hard reference.
Always use the **anchor string** (function name / constant / error message) as the primary locator.

### Tests: lanes + name filters (use them aggressively)
The repo has a first-class test runner with lanes + filters:

- Runner: `npm test` (alias for `node tests/run.js`)
- List lanes/tags: `npm test -- --list-lanes` / `npm test -- --list-tags`
- Run a lane: `npm run test:unit`, `npm run test:integration`, `npm run test:services`, etc.
- Filter by name/path (selectors):  
  - `npm test -- --match risk_interprocedural`  
  - `npm run test:unit -- --match chunk-uid`  
  - `npm run test:integration -- --match crossfile`

**Lane rules are defined in:** `tests/run.rules.jsonc` (keep new tests named/placed so they land in the intended lane).

### Deprecating spec documents: archive policy (MANDATORY)
When a spec/doc is replaced (e.g., a reconciled spec supersedes an older one):

- **Move the deprecated doc to:** `docs/archived/` (create this folder if missing).
- Keep a short header in the moved file indicating:
  - what replaced it,
  - why it was deprecated,
  - the date/PR.
- Add/update the repository process in **`AGENTS.md`** so future agents follow the same archival convention.

This roadmap includes explicit tasks to enforce this process (see Phase 10 doc merge).

---


## Roadmap Table of Contents
> **Reminder:** This list is a navigational summary. The authoritative implementation details live in the phase bodies below.

- **Phase 7 — Embeddings + ANN unification**
  - 7.0 — Foundation: contracts, terminology, and execution order
  - 7.1 — Embedding jobs are build-scoped, deterministic, idempotent
  - 7.2 — Artifact contract parity for embeddings + ANN
  - 7.3 — Quantization invariants end-to-end
  - 7.4 — Normalization policy consistency across build + query-time ANN
  - 7.5 — LanceDB ANN correctness and resilience
  - 7.6 — HNSW ANN correctness, compatibility, and failure observability
  - 7.7 — ANN backend policy and parity
  - 7.8 — Backend storage resilience required by embeddings/ANN workflows
  - Phase 7 mapping + strict manifest compliance addendum (mandatory)

- **Phase 9 — Symbol identity (collision-safe IDs) + cross-file linking**
  - Phase 9 objective + non-goals + locked decisions
  - Phase 9 contracts (normative; implementation-ready)
  - Phase 9 implementation plan (tasks/tests)
    - 9.1 — Verify identity primitives
    - 9.2 — Symbol identity
      - 9.2.1 — Implement/extend symbol identity helpers
      - 9.2.2 — Attach `metaV2.symbol`
    - 9.3 — Import bindings + resolver
      - 9.3.1 — Emit `importBindings` in `file_relations`
      - 9.3.2 — Relative import resolver helper
      - 9.3.3 — SymbolRef resolver
      - 9.3.4 — Tests
    - 9.4 — Cross-file linking pipeline
      - 9.4.1 — Replace `file::name` join logic with SymbolRef resolution
      - 9.4.2 — Emit new-format `callLinks` and `usageLinks`
      - 9.4.3 — Keep `callSummaries`, but add resolved IDs where possible
      - 9.4.4 — Tooling provider audit
      - 9.4.5 — Pipeline tests
    - 9.5 — Symbol graph artifacts
      - 9.5.1 — Writers
      - 9.5.2 — Artifact integration
    - 9.6 — Graph building
      - 9.6.1 — Update graph builder to ingest SymbolRef links
      - 9.6.2 — Version bump
    - 9.7 — Map build (stop using `file::name` as member identity)
      - 9.7.1 — Member ID strategy
      - 9.7.2 — Backward compatibility
    - 9.8 — Performance, determinism, and regression guardrails
      - 9.8.1 — Determinism requirements
      - 9.8.2 — Throughput requirements
  - Phase 9 exit criteria + addendum (dependencies, ordering, artifacts, tests, edge cases)

- **Phase 10 — Interprocedural risk propagation + explainability artifacts**
  - Source-of-truth decisions + conflicts resolved (A–C)
  - 10.0 — Documentation merge + canonical spec cleanup (FOUNDATION)
  - 10.1 — Config wiring + runtime gating (FOUNDATION)
  - 10.2 — Param name stabilization for arg-aware mode (FOUNDATION)
  - 10.3 — Risk summaries (artifact + compact docmeta)
  - 10.4 — Shared callsite utilities (FOUNDATION)
  - 10.5 — Interprocedural propagation → `risk_flows`
  - 10.6 — Artifact writing + contracts + manifest integration
  - 10.7 — Validation + referential integrity
  - 10.8 — CLI: explain interprocedural risk flows
  - 10.9 — Cross-cutting robustness improvements (recommended)
  - Phase 10 completion checklist
  - 10.A–10.E — Spec appendices (output of 10.0 merge; keep in-sync with contracts)

---

## Phase 7 — Embeddings + ANN unification

This section is a **fully expanded, implementation-ready** rewrite of the Phase 7 roadmap. 

**Primary goals:**
- Make embedding generation **build-scoped, deterministic, and resumable** (service queue or inline).
- Make ANN backends **consistent** (same target vectors, same candidate filtering semantics, same readiness signals).
- Make the artifact surface **manifest-first** and contract-compliant (no “guessing” filenames in strict mode).
- Remove quantization/normalization ambiguity so that outputs are **correct, stable, and comparable**.

---

### Objective

Unify embeddings and ANN artifacts across all build paths (inline indexing, build-embeddings, and service queue) so that:

1. **Index build outputs are deterministic**
   - Embedding jobs always target an explicit build root and index directory.
   - Cached embeddings are keyed by an explicit identity key that includes model and quantization settings.
   - Incremental updates and full builds produce the same embedding artifacts.

2. **ANN backends behave consistently**
   - Candidate filtering behaves the same across HNSW and LanceDB.
   - ANN target selection aligns with `denseVectorMode` (merged/doc/code/auto).
   - “ANN-ready” state is clearly signaled in `index_state.json` and the manifest.

3. **Artifact discovery is contract-compliant**
   - Strict discovery uses `pieces/manifest.json` (no directory scanning / filename guessing).
   - Embeddings/ANN artifacts are included in the manifest when present, absent when not.

---

### Exit criteria

All items must be satisfied:

- ✅ **Embedding jobs are build-scoped**
  - `tools/indexer-service.js` uses the job payload to run build-embeddings **against the correct build root** even if builds/current.json changes.
  - Queue payload format is versioned and validated (`embeddingPayloadFormatVersion`).

- ✅ **No quantization overflow / wrap**
  - Quantization levels are clamped to `[2, 256]` in every path that quantizes vectors.
  - No path writes >255 values into a `Uint8Array` or “uint8 JSON” vector artifact.

- ✅ **Normalization is consistent**
  - If `embeddingIdentity.normalize === true`, all stored vectors used for ANN and exact ranking are normalized (or explicitly documented and tested otherwise).

- ✅ **Manifest completeness**
  - If an ANN backend artifact exists (HNSW bin, LanceDB directory, SQLite-vec table marker), the manifest includes a corresponding entry (and any required meta entry).
  - If it does not exist, the manifest does not list it.

- ✅ **Strict mode compliance**
  - Retrieval and validation do not guess filenames in strict mode; they locate artifacts through the manifest.

- ✅ **Parity tests pass**
  - Ranking parity tests demonstrate that Dense vs HNSW vs LanceDB are consistent on deterministic fixtures (within acceptable error bounds for ANN).

---

## 7.0 Foundation: contracts, terminology, and execution order

### 7.0.1 Source-of-truth hierarchy and conflict resolution rules

Phase 7 touches multiple “spec surfaces”. Use this hierarchy when conflicts arise:

1. **docs/contracts/public-artifact-surface.md**  
   - Canonical rule: strict tooling must discover artifacts via the manifest (no guessing).  
2. **src/contracts/** (runtime validators + schema defs)  
   - Canonical for what the code *currently* enforces.
3. **docs/guides/embeddings.md** and **docs/guides/search.md**  
   - Operational guidance. If it conflicts with (1), update the guide.
4. **Current implementation**  
   - If code is *ahead* of docs (e.g., it already writes an artifact but docs omit it), update docs/contracts to match the intended public surface.
   - If code is *behind* docs/contracts, update code to match contracts.

**Explicit Phase 7 conflicts discovered and resolution choices:**
- **Conflict A:** Embedding queue `indexRoot` meaning is inconsistent (pipeline passes per-mode index dir; build-embeddings `--index-root` expects base build root).  
  ✅ Resolution: **Rename/clarify fields** in the job payload (`buildRoot` as base; `indexDir` as per-mode). Update tests + worker accordingly. This removes ambiguity and matches build-embeddings behavior.
- **Conflict B:** `tools/build-embeddings/manifest.js` currently filters entries by `ARTIFACT_SCHEMA_DEFS`, which omits non-JSON artifacts like HNSW `.bin` and LanceDB directories.  
  ✅ Resolution: **Manifest must include these artifacts**. Update manifest writer to include them via an allowlist even if they are not JSON-schema-validated, and update docs/contracts to explicitly list them as part of the public surface.
- **Conflict C:** Retrieval loaders read many JSON artifacts via direct filesystem reads (bypassing manifest), contradicting “manifest-first”.  
  ✅ Resolution: In strict mode, retrieval must use `src/shared/artifact-io.js` manifest-based resolvers for all artifacts it loads (JSON and non-JSON).

### 7.0.2 Terminology

To prevent recurring confusion, Phase 7 standardizes these terms:

- **repoRoot**: The repository being indexed/searched.
- **buildRoot**: A single build output root (e.g., `<repo>/builds/<buildId>`). This is the root that contains `index-code`, `index-prose`, etc.
- **indexDir**: A per-mode directory inside buildRoot, e.g.:
  - `<buildRoot>/index-code`
  - `<buildRoot>/index-prose`
- **mode**: One of `code | prose | extracted-prose | records` (Phase 7 primarily targets code + prose).
- **vector variant / target**:
  - `merged`: merged embedding vector for a chunk
  - `code`: code-only vector
  - `doc`: doc-only vector
- **denseVectorMode**: How to select the vector variant for ranking:
  - `merged | code | doc | auto`
  - `auto` is resolved per query intent (and/or mode-specific fallback).
- **ANN backend**: `lancedb | hnsw | sqlite-vec | dense | none` (exact list depends on optional deps and configuration).

### 7.0.3 Capability matrix (post-Phase 7 required behavior)

After Phase 7, these capabilities must hold:

- Dense exact ranking: supports `merged/doc/code` (already possible via `resolveDenseVector()` once `denseVectorMode` is wired through).
- LanceDB ANN: supports `merged/doc/code` (already built and selectable via `resolveLanceDbTarget()`).
- HNSW ANN: **must have an explicit, documented target mapping**:
  - Build and load HNSW indices for `merged/doc/code` so it can match LanceDB behavior.


### 7.0.4 Recommended execution order

Order tasks so that cross-cutting foundational changes land first:

1. **7.2 Artifact contract + manifest completeness** (must exist before strict loaders can be updated)
2. **7.3 Quantization invariants** (prevents corrupt outputs and invalid caches)
3. **7.4 Normalization policy consistency** (required before parity tests)
4. **7.1 Embedding job scoping + worker behavior** (service correctness)
5. **7.5 LanceDB robustness**
6. **7.6 HNSW compatibility + observability**
7. **7.7 Backend policy + ranking equivalence**
8. **7.8 Storage resilience**

---

## 7.1 Embedding jobs are build-scoped, deterministic, idempotent

### Why this exists

Current embedding service flow is not fully build-scoped:
- `src/index/build/indexer/pipeline.js` enqueues an embedding job, but the worker (`tools/indexer-service.js`) ignores job buildRoot/indexRoot and calls `tools/build-embeddings.js` without `--index-root`.
- Queue tests currently allow inconsistent `buildRoot` vs `indexRoot` values, which hides real scoping bugs.

### 7.1.1 Define the embedding job payload schema (versioned)

**Touchpoints**
- `src/index/build/indexer/embedding-queue.js` (~L1–L49)
- `tools/service/queue.js` (~L1–L270)
- `tools/indexer-service.js` (~L1–L441)
- Tests: `tests/embedding-queue.js` (~L1–L51), `tests/embedding-queue-defaults.js` (~L1–L37)

**New canonical job payload fields** (JSON):
```json
{
  "type": "embeddings",
  "embeddingPayloadFormatVersion": 2,
  "repoRoot": "/abs/path/to/repo",
  "buildId": "b123",
  "buildRoot": "/abs/path/to/repo/builds/b123",
  "mode": "code",
  "indexDir": "/abs/path/to/repo/builds/b123/index-code",
  "embeddingIdentity": { "...": "..." },
  "embeddingIdentityKey": "sha1-or-similar",
  "configHash": "sha1-of-effective-config",
  "repoProvenance": {
    "gitSha": "optional",
    "dirty": false,
    "toolVersion": "optional"
  },
  "createdAt": "2026-01-30T12:34:56.000Z",
  "updatedAt": "2026-01-30T12:34:56.000Z",
  "attemptCount": 0,
  "lastError": null
}
```

**Hard requirements**
- `buildRoot` MUST be an absolute path.
- `indexDir` MUST be an absolute path AND MUST be inside `buildRoot` (validate via `path.relative()`; reject `..` escape).
- `mode` MUST be one of the supported modes.
- `embeddingIdentityKey` MUST match `buildEmbeddingIdentityKey(embeddingIdentity)` exactly.
- `configHash` MUST be stable for the effective embedding config.
- `embeddingPayloadFormatVersion` MUST be set (defaulted, but not omitted).

**Compatibility behavior**
- If a job is missing `embeddingPayloadFormatVersion`, treat it as version 1 and:
  - If it has `indexRoot` (legacy), interpret:
    - If `indexRoot` ends with `/index-code` or `/index-prose`, treat it as `indexDir`.
    - Else treat it as `buildRoot`.
  - Populate missing fields where safely derivable.
  - Emit a warning once per worker run that legacy payloads are being upgraded.

### 7.1.2 Fix the enqueue site to emit correct fields

**Touchpoints**
- `src/index/build/indexer/pipeline.js` (~L1–L326) (search: `enqueueEmbeddingJob({`)
- `src/index/build/indexer/embedding-queue.js` (~L1–L49)

**Current bug**
- Pipeline passes `indexRoot: outDir` where `outDir` is already the per-mode index directory. This is incompatible with build-embeddings `--index-root` semantics and breaks any future “join index dir” logic.

**Required changes**
- In `pipeline.js` when calling `enqueueEmbeddingJob`, pass:
  - `buildRoot: runtime.buildRoot` (already exists on runtime)
  - `indexDir: outDir` (rename from indexRoot)
- In `embedding-queue.js`, accept `indexDir` (new) and either:
  - Disallow legacy `indexRoot` input, OR
  - Support both but normalize to canonical `indexDir`.

**Also update**
- Validate `indexDir` exists (or at least that its parent buildRoot exists) before enqueueing. If missing, treat as programmer error and throw (this prevents silent jobs that can never run).

### 7.1.3 Worker must run build-embeddings against the correct build root

**Touchpoints**
- `tools/indexer-service.js` (~L1–L441) (function `runBuildEmbeddings`)
- `tools/build-embeddings/cli.js` (~L1–L95) (already supports `--index-root`)
- `tools/build-embeddings/runner.js` (~L1–L763) (already expects indexRoot base)

**Required changes**
- Update `runBuildEmbeddings({ job })` to include:
  - `--index-root <job.buildRoot>`  
    (NOT `job.indexDir`; build-embeddings runner will derive per-mode indexDir.)
- If job includes `indexDir`, pass it only for validation/logging; do not use as the base index root.
- Ensure the worker runs `--mode <job.mode>` and uses the job’s `repoRoot` (or `repo`).
- If `job.repoRoot` and the worker’s `--repo` mismatch, the worker should:
  - prefer `job.repoRoot` if present
  - warn if `--repo` differs (avoid “wrong repo” processing)

**Safety requirement**
- If `job.buildRoot` does not exist, mark job failed with `lastError` explaining missing build root and do not retry indefinitely (cap attempts).

### 7.1.4 Index state should clearly represent “pending embeddings”

**Touchpoints**
- `src/index/build/indexer/steps/write.js` (~L1–L101) (writes initial index_state during stage2)
- `tools/build-embeddings/runner.js` (~L1–L763) (updates index_state during stage3)

**Required state machine**
- Stage2 build when embeddings are configured to run later via service:
  - `index_state.embeddings.enabled = true`
  - `index_state.embeddings.ready = false`
  - `index_state.embeddings.pending = true`  ✅ add this
  - `index_state.embeddings.service = true`
  - `index_state.embeddings.mode = <mode>`
  - `index_state.embeddings.embeddingIdentity` and `.embeddingIdentityKey` SHOULD be present if known at stage2.
- Stage3 success:
  - `enabled = true`
  - `ready = true`
  - `pending = false`
  - `updatedAt` set (already)
- Stage3 failure:
  - `enabled = true`
  - `ready = false`
  - `pending = false` (job completed but failed) OR keep `pending=true` only if the job will be retried.
  - `lastError` set (new)

**Note:** Retrieval currently uses `embeddingsReady = embeddingsState?.ready !== false && embeddingsState?.pending !== true`. That logic assumes `pending` exists; Phase 7 makes it real.

### 7.1.5 Tests for build scoping and worker correctness

**Update existing tests**
- `tests/embedding-queue.js`
  - Must require that when `enqueueEmbeddingJob({ runtime, mode, indexDir })` is called:
    - job.buildRoot equals runtime.buildRoot
    - job.indexDir equals resolved indexDir
    - job.indexDir is within job.buildRoot
  - Remove the current test behavior that allows buildRoot/indexRoot mismatch.
- `tests/embedding-queue-defaults.js`
  - Assert that missing optional fields are filled:
    - `embeddingPayloadFormatVersion` is set
    - `attemptCount` default 0
    - `createdAt` and `updatedAt` are ISO strings

**Add new tests**
- `tests/indexer-service-embedding-job-uses-build-root.js` (new)
  - Create two builds (b1 and b2) under a temp repo
  - Create a job targeting buildRoot=b1
  - Simulate builds/current.json pointing at b2
  - Run `tools/indexer-service.js --once --queue embeddings` (or equivalent)
  - Assert embeddings artifacts were written under build b1 (not b2)
  - Assert job is marked completed and `index_state.json` under b1 indicates `ready=true`.

---

## 7.2 Artifact contract parity for embeddings + ANN

### Why this exists

Contracts require manifest-first discovery. Today:
- `tools/build-embeddings/manifest.js` tries to add embedding pieces but filters them by `ARTIFACT_SCHEMA_DEFS`, excluding important non-JSON artifacts.
- Retrieval/validation still open some artifacts by guessed filenames.

Phase 7 makes embeddings and ANN artifacts fully discoverable via the manifest.

### 7.2.1 Define the canonical public artifact names for embeddings + ANN

**Specs to update**
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/public-artifact-surface.md`

**Code to update**
- `src/contracts/registry.js` and/or `src/contracts/schemas/artifacts.js` (if adding names)
- `tools/build-embeddings/manifest.js`
- `src/shared/artifact-io/manifest.js` (if adding helpers for binary/dir artifacts)
- `src/retrieval/cli-index.js`, `src/retrieval/cli/load-indexes.js`, `src/index/validate.js`

**Canonical names (Phase 7)**
These names are used as `manifestEntry.name` and in code when resolving artifacts:

Dense vectors (quantized uint8 JSON, with vectors embedded):
- `dense_vectors` → `dense_vectors_uint8.json`
- `dense_vectors_doc` → `dense_vectors_doc_uint8.json`
- `dense_vectors_code` → `dense_vectors_code_uint8.json`

HNSW (non-JSON + JSON meta):
- `dense_vectors_hnsw` → `dense_vectors_hnsw.bin`
- `dense_vectors_hnsw_meta` → `dense_vectors_hnsw.meta.json`
- `dense_vectors_doc_hnsw` → `dense_vectors_doc_hnsw.bin`
- `dense_vectors_doc_hnsw_meta` → `dense_vectors_doc_hnsw.meta.json`
- `dense_vectors_code_hnsw` → `dense_vectors_code_hnsw.bin`
- `dense_vectors_code_hnsw_meta` → `dense_vectors_code_hnsw.meta.json`

LanceDB (directories + JSON meta):
- `dense_vectors_lancedb` → `dense_vectors.lancedb/`
- `dense_vectors_lancedb_meta` → `dense_vectors.lancedb.meta.json`
- `dense_vectors_doc_lancedb` → `dense_vectors_doc.lancedb/`
- `dense_vectors_doc_lancedb_meta` → `dense_vectors_doc.lancedb.meta.json`
- `dense_vectors_code_lancedb` → `dense_vectors_code.lancedb/`
- `dense_vectors_code_lancedb_meta` → `dense_vectors_code.lancedb.meta.json`

SQLite vector extension ANN presence:
- This is DB state, not a file artifact. Represent it in `index_state.embeddings.backends.sqliteVec` and optionally as a manifest “marker”:
  - `dense_vectors_sqlite_vec_meta` → `dense_vectors_sqlite_vec.meta.json` (new optional)  
    (If added, it documents dims/count and table name; it is optional because it depends on build options and sqlite configuration.)

**Important:** Even if you do not add JSON schemas for binary/dir artifacts, their NAMES must be part of the public artifact surface and must appear in the manifest when present.

### 7.2.2 Update the embeddings manifest writer to include non-JSON artifacts

**Touchpoints**
- `tools/build-embeddings/manifest.js` (~L1–L111)

**Current behavior**
- Builds `embeddingPieces`, then filters by `ARTIFACT_SCHEMA_DEFS` names, which excludes:
  - `dense_vectors_hnsw` (bin)
  - `dense_vectors_lancedb` (dir)
  - and doc/code variants.

**Required behavior**
- Remove or relax the schema-name filter. Replace with a clear allowlist:
  - `const allowed = new Set([...Object.keys(ARTIFACT_SCHEMA_DEFS), ...NON_JSON_PUBLIC_ARTIFACTS]);`
  - where `NON_JSON_PUBLIC_ARTIFACTS` includes the bin/dir names listed above.
- For `format: 'bin'`, add manifest entry if the file exists.
- For `format: 'dir'`, add manifest entry if the directory exists.
- Ensure manifest entries record:
  - `format` as `json|jsonl|bin|dir` (already)
  - `bytes` and `sha256` for files (`bin` and `json`) where feasible
  - For directories, record `entries` count and/or omit bytes (bytes optional); if bytes is recorded, compute deterministically (walk directory sorted).

**Edge cases**
- If `.bak` exists for HNSW, do not add it to manifest as a separate artifact. The `.bak` is an implementation detail. Only the canonical `.bin` path is listed.

### 7.2.3 Update readers to use manifest in strict mode

**Touchpoints**
- `src/retrieval/cli-index.js` (~L1–L416) (file-backed load)
- `src/retrieval/cli/load-indexes.js` (~L1–L368) (LanceDB attach)
- `src/index/validate.js` (~L1–L581)
- `src/shared/artifact-io.js` (~L1–L12) and `src/shared/artifact-io/manifest.js` (~L1–L291)

**Required behavior**
- In strict mode:
  - JSON artifacts are loaded via `loadJsonArrayArtifact`, `loadJsonObjectArtifact`, `loadChunkMeta`, etc.
  - Non-JSON artifacts are *located* via manifest (resolve path), then opened.

**Concrete implementation steps**
1. Add helper(s) in `src/shared/artifact-io.js`:
   - `resolveBinaryArtifactPath(dir, name, { strict })`
   - `resolveDirArtifactPath(dir, name, { strict })`
   These should:
   - in strict mode: require manifest entry and return absolute path
   - in non-strict mode: fall back to legacy filename guessing (only for backward compatibility)
2. Update `src/retrieval/cli-index.js`:
   - Replace `readJsonFile(path.join(dir, 'dense_vectors_uint8.json'))` with `loadJsonObjectArtifact(dir, 'dense_vectors', { strict: true })`
   - Replace HNSW meta load with `loadJsonObjectArtifact(dir, 'dense_vectors_hnsw_meta', { strict: true })`
   - Resolve HNSW bin with `resolveBinaryArtifactPath(dir, 'dense_vectors_hnsw', { strict: true })`
3. Update `src/retrieval/cli/load-indexes.js` attachLanceDb:
   - Resolve `dense_vectors_*_lancedb_meta` through manifest, not direct path join.
   - Resolve the lancedb directory through manifest entry `dense_vectors_*_lancedb`.
4. Update `src/index/validate.js`:
   - For strict validation, require manifest presence for embedding artifacts and use it to locate them.
   - Validation should fail if an artifact exists on disk but is missing from manifest (strict mode).

### 7.2.4 Index state should include embedding identity and backend presence

**Touchpoints**
- `src/index/build/indexer/steps/write.js` (~L1–L101) (stage2)
- `tools/build-embeddings/runner.js` (~L1–L763) (stage3)
- Tests: `tests/embeddings-validate.js` (~L1–L82), `tools/index-validate.js` (~L1–L130) output

**Required new fields**
- `index_state.embeddings.embeddingIdentity` (object)
- `index_state.embeddings.embeddingIdentityKey` (string)
- `index_state.embeddings.backends` (object, example):
```json
{
  "hnsw": { "enabled": true, "available": true, "target": "merged", "dims": 384, "count": 1234 },
  "lancedb": { "enabled": true, "available": true, "target": "code", "dims": 384, "count": 1234 },
  "sqliteVec": { "enabled": true, "available": false }
}
```

**Rules**
- `available` means the artifact is present and loadable.
- `enabled` means config requested it.
- `target` is only required if the backend depends on vector variant selection.

### 7.2.5 Tests for manifest completeness and strict discovery

**Add new tests**
- `tests/manifest-embeddings-pieces.js`
  - Build stage2 index for fixture repo (stub embeddings).
  - Run build-embeddings stage3.
  - Load `<indexDir>/pieces/manifest.json`.
  - Assert it includes entries for:
    - `dense_vectors`
    - `dense_vectors_hnsw` and `dense_vectors_hnsw_meta` (if hnswlib is installed; if not installed, assert they are absent)
    - `dense_vectors_lancedb` and `dense_vectors_lancedb_meta` (if lancedb is installed; else absent)
  - Assert that if `dense_vectors_hnsw.bin` exists, manifest includes it.
  - Assert that if manifest lists it, file exists.

- `tests/retrieval-strict-manifest-embeddings.js`
  - Create an indexDir with embeddings artifacts present but remove `pieces/manifest.json`.
  - Run `search.js` in strict mode (default) and assert it fails with `ERR_MANIFEST_MISSING` (or equivalent).
  - Run `search.js --non-strict` (if supported) and assert it can still run (legacy fallback), but logs a warning.

**Update existing tests**
- `tests/artifact-io-manifest-discovery.test.js`
  - Extend to also verify `dense_vectors` and `dense_vectors_hnsw_meta` cannot be loaded without manifest in strict mode once the loader changes land.

---

## 7.3 Quantization invariants end-to-end

### Why this exists

There are multiple quantization entry points:
- `src/shared/embedding-utils.js` has both `quantizeEmbeddingVector()` (unclamped levels) and `quantizeEmbeddingVectorUint8()` (clamped).
- Several call sites use the unclamped path and then pack into a Uint8Array, which can wrap values.

This phase enforces correct quantization everywhere.

### 7.3.1 Clamp quantization levels globally to [2, 256]

**Touchpoints**
- `src/storage/sqlite/vector.js` (~L1–L71) (function `resolveQuantizationParams`)
- `src/shared/embedding-utils.js` (~L1–L176) (`quantizeEmbeddingVector`, `quantizeEmbeddingVectorUint8`, `dequantizeUint8ToFloat32`)
- `src/index/embedding.js` (~L1–L56) (`quantizeVec`, `quantizeVecUint8`)
- `tools/build-embeddings/embed.js` (~L1–L119)
- `src/storage/sqlite/build/incremental-update.js` (~L1–L567)
- `src/index/build/file-processor/embeddings.js` (~L1–L260)

**Required changes**
1. In `resolveQuantizationParams()`:
   - Clamp `levels` to integer in `[2, 256]`.
   - Rationale: prevents overflow **and** avoids divide-by-zero in `scale = (maxVal - minVal) / (levels - 1)` when `levels <= 1`.
   - If invalid, default to 256.
2. In `quantizeEmbeddingVector()`:
   - Either:
     - clamp internally (same as Uint8 version), OR
     - mark as internal-only and ensure no production path uses it.
   - Phase 7 requirement: **production quantization must not be able to output values >255**.
3. Update `src/index/embedding.js`:
   - Make `quantizeVec()` call the clamped implementation OR remove it in favor of `quantizeVecUint8()` and update call sites.

### 7.3.2 Ensure all stored “uint8 artifacts” are actually uint8-safe

**Artifacts affected**
- `dense_vectors_uint8.json` (`dense_vectors`)
- `dense_vectors_doc_uint8.json` (`dense_vectors_doc`)
- `dense_vectors_code_uint8.json` (`dense_vectors_code`)
- SQLite dense tables written by `tools/build-embeddings/sqlite-dense.js`
- HNSW/LanceDB build paths that dequantize from uint8

**Required changes**
- Update `tools/build-embeddings/embed.js` to quantize using the clamped path.
  - Prefer storing vectors as plain arrays of integers 0..255 in JSON.
- Update `src/storage/sqlite/build/incremental-update.js` to use a clamped quantizer before packing into Uint8Array.

### 7.3.3 Persist quantization metadata where it is needed

Current code often assumes `minVal=-1` and `levels=256`, which breaks if config differs.

**Phase 7 rule**
- Any component that needs to dequantize MUST have access to the exact `(minVal, maxVal, levels)` used (or an equivalent representation).

**Implementation choice**
- Add optional fields to the dense vector artifacts and backend meta files:
  - For `dense_vectors*` artifacts: add `minVal`, `maxVal`, `levels`, and optionally `quantization` object.
  - For HNSW meta and LanceDB meta: add the same quantization fields.
  - This is safe because JSON schemas allow additionalProperties.

**Touchpoints**
- Writers:
  - `tools/build-embeddings/runner.js` (~L1–L763) (when writing dense_vectors*.json and meta)
  - `tools/build-embeddings/hnsw.js` (~L1–L115) (meta output)
  - `tools/build-embeddings/lancedb.js` (~L1–L143) (meta output)
- Readers:
  - `src/retrieval/rankers.js` (~L1–L292) (rankDenseVectors: stop hardcoding `minVal=-1`)
  - `src/retrieval/sqlite-helpers.js` (~L1–L544) (dense meta: stop hardcoding minVal)
  - `tools/build-embeddings/lancedb.js` (~L1–L143) (dequantizeUint8ToFloat32 must use correct quantization)

### 7.3.4 Update LanceDB build to dequantize correctly

**Touchpoints**
- `tools/build-embeddings/lancedb.js` (~L1–L143)

**Required changes**
- `buildBatch()` currently calls `dequantizeUint8ToFloat32(row.vec)` without passing params (defaults to -1..1, 256).
- Update `writeLanceDbIndex()` signature to accept quantization params (or `scale + minVal`), and pass through from `runner.js`.

**Correctness tests**
- A dedicated test should:
  - Configure quantization levels != 256 (e.g., 128) in a temporary repo config
  - Build embeddings and LanceDB index
  - Query LanceDB directly (or via search) and assert results are stable and not obviously degraded vs Dense

### 7.3.5 Tests for quantization invariants

**Update existing tests**
- `tests/quantize-embedding-utils.js` (if exists) or add new:
  - Assert clamping:
    - levels < 2 => 2
    - levels > 256 => 256
  - Assert no value in output exceeds 255.

**Add new test**
- `tests/embedding-quantization-no-wrap.js`
  - Construct an embedding vector with values near 1.0
  - Use quantization levels 512 in config (intentionally invalid)
  - Run the embedding build path that writes JSON and SQLite
  - Assert:
    - dense vectors JSON only contains integers 0..255
    - sqlite dense table values match expected quantization (no modulo wrap)
    - `index_state.embeddings.embeddingIdentity.quantization.levels` shows the clamped value.

---

## 7.4 Normalization policy consistency

### Why this exists

Normalization affects:
- exact dense ranking (dot product expects normalized vectors for cosine equivalence)
- ANN backends (HNSW metric, LanceDB metric)
- caching (embedding identity includes normalize)

### 7.4.1 Define and enforce normalization rules

**Rule 1**
- If `embeddingIdentity.normalize === true`, then:
  - code, doc, and merged vectors MUST be L2 normalized before storage.
  - Any dequantized float vectors used for ANN MUST be normalized (or equivalent).

**Rule 2**
- If `embeddingIdentity.normalize === false`, then:
  - storage may contain raw vectors, but ANN backend selection must respect configured metric.

**Touchpoints**
- `src/shared/embedding-adapter.js` (~L1–L158) (ensures embedding providers normalize)
- `tools/build-embeddings/embed.js` (~L1–L119) (mergeEmbeddingVectors + normalizeEmbeddingVector)
- `src/index/build/file-processor/embeddings.js` (~L1–L260) (inline embeddings path)
- `tools/build-embeddings/runner.js` (~L1–L763) (cache load path where HNSW vectors are dequantized)

**Required changes**
- Ensure build-embeddings cache load path normalizes HNSW float vectors whenever identity.normalize is true, not only when `hnswConfig.space === 'cosine'`.
- Ensure `mergeEmbeddingVectors()` behavior is explicitly specified:
  - If doc vector is missing (zeros), merged should still normalize correctly and not bias scale.
  - Add test coverage.

### 7.4.2 Tests for normalization consistency

**Add test**
- `tests/embedding-normalization-consistency.js`
  - Use stub embeddings that produce a known non-normalized vector.
  - Ensure the pipeline normalizes it before storage when normalize=true.
  - Ensure merged vector equals normalized(mean(code, doc)) within tolerance.

**Update ANN tests**
- `tests/hnsw-ann.js` and `tests/lancedb-ann.js` should assert:
  - embeddings meta includes normalize=true
  - ANN meta metric/space matches expected
  - Query-time similarity ordering matches Dense within tolerance.

---

## 7.5 LanceDB robustness improvements

### Why this exists

Candidate filtering semantics and robustness issues:
- When candidateSet is large and pushdown is disabled, a single fixed-limit query may return fewer than topN matches after filtering.
- Connection caching is not concurrency-safe (race opens).
- Filter clause construction must be safe and correct.

### 7.5.1 Implement iterative overfetch for candidateSet filtering

**Touchpoints**
- `src/retrieval/lancedb.js` (~L1–L180) (function `searchLanceDbCandidates`)

**Required behavior**
- When `candidateSet` is provided:
  - Try pushdown if candidateSet is numeric and <= `LANCE_CANDIDATE_PUSH_LIMIT`.
  - Else run iterative overfetch:
    1. Start with `limit = max(topN*4, topN+10)`.
    2. Execute query with that limit.
    3. Filter results by candidateSet.
    4. If filtered count < topN AND raw results length == limit:
       - increase limit (e.g., x2) up to a cap (candidateCount or a global max).
       - repeat.
     5. Stop when enough results or when limit reaches cap.

**Correctness requirement**
- Deterministic: same inputs yield same outputs (stable sort tie-breakers).
- Efficient: cap iterations (e.g., max 4 passes).

### 7.5.2 Make connection caching concurrency-safe

**Touchpoints**
- `src/retrieval/lancedb.js` (~L1–L180) (`connectionCache`)

**Required changes**
- Store a Promise in the cache while connecting:
  - If concurrent calls happen, they await the same Promise.
- If connection fails, delete cache entry so later attempts can retry.

### 7.5.3 Harden filter construction

**Touchpoints**
- `src/retrieval/lancedb.js` (~L1–L180)

**Required changes**
- Validate `idColumn` is a safe identifier (e.g., `/^[A-Za-z_][A-Za-z0-9_]*$/`).
- Ensure `candidateSet` values are integers, not floats.

### 7.5.4 Tests for LanceDB candidate filtering

**Add new test**
- `tests/lancedb-candidate-filtering.js`
  - Use a stub dataset large enough that candidateSet > push limit.
  - Use a candidateSet that excludes most top hits.
  - Assert:
    - The function still returns topN results within candidateSet (iterative overfetch works).
    - Stats indicate multiple passes were executed (optional metric in logs).

---

### 7.5.5 Acceptance criteria

- Candidate-set filtering works for both small and large candidate sets:
  - If `candidateSet.size >= topN`, the function returns **at least** `topN` results whenever the underlying dataset contains enough matches.
  - If the dataset (or candidateSet) cannot produce `topN` matches, it returns as many as possible without throwing.
- Connection caching is concurrency-safe:
  - Concurrent queries to the same LanceDB directory do not trigger multiple `connect()` calls.
- Pushdown filtering is used when safe:
  - When `candidateSet` is numeric and `candidateSet.size <= LANCE_CANDIDATE_PUSH_LIMIT`, the query uses a `where` clause pushdown.

### 7.5.6 Tests

Add/Update the following tests (names are prescriptive; adjust location if the repo’s test layout requires flat files):

- `tests/unit/lancedb-candidate-filtering.test.js` (new)
  - Exercises iterative overfetch when candidateSet is large.
- `tests/unit/lancedb-connection-cache.test.js` (new)
  - Verifies promise-cached connections prevent double-open under concurrency.
- `tests/unit/lancedb-filter-pushdown.test.js` (new)
  - Verifies pushdown is used only for safe numeric candidate sets.
- `tests/lancedb-ann.js` (existing)
  - Extend assertions if needed to confirm ANN backend is LanceDB and returns stable results.



## 7.6 HNSW signature compatibility and observability

### Why this exists

- `hnswlib-node` API signatures differ across versions; current code may pass the wrong second argument to `readIndexSync`.
- Insert failures are not sufficiently observable.
- Variant selection must align with denseVectorMode if Phase 7 supports doc/code/merged.

### 7.6.1 Make loadHnswIndex tolerant to signature differences

**Touchpoints**
- `src/shared/hnsw.js` (~L1–L160) (function `loadHnswIndex`)
- `src/shared/hnsw.js` (~L1–L160) (function `resolveHnswPaths` if extended to support variants)

**Required changes**
- Detect `readIndexSync` signature:
  - If it expects `(path, maxElements)` then pass maxElements (number).
  - If it expects `(path, allowReplaceDeleted)` then pass boolean.
  - If unknown, try safe fallbacks with try/catch:
    1. call with just `(path)`
    2. call with `(path, maxElements)`
    3. call with `(path, allowReplaceDeleted)`
  - Use meta/config to choose expected dims/count.

**Observability**
- When fallback path is used, log a warning once with:
  - detected arity
  - attempted signatures
  - final chosen signature

### 7.6.2 Build and load HNSW indices for merged/doc/code variants

**Touchpoints**
- Writer:
  - `tools/build-embeddings/runner.js` (~L1–L763)
  - `tools/build-embeddings/hnsw.js` (~L1–L115)
- Reader:
  - `src/retrieval/cli-index.js` (~L1–L416) (HNSW load)
  - `src/retrieval/ann/providers/hnsw.js` (~L1–L27) (already uses idx.hnsw)
  - `src/shared/hnsw.js` (~L1–L160) path resolver

**Required behavior**
- For each mode, if embeddings are ready and HNSW is enabled and available:
  - Build HNSW for:
    - merged vectors (`dense_vectors_hnsw.*`)
    - doc vectors (`dense_vectors_doc_hnsw.*`)
    - code vectors (`dense_vectors_code_hnsw.*`)
- At query-time, select which HNSW index to use based on `resolvedDenseVectorMode`.
  - This mirrors LanceDB behavior and ensures parity.
- Meta files MUST include:
  - dims, count
  - space/metric
  - efSearch/efConstruction/m
  - embeddingIdentityKey (or at least model id)
  - quantization parameters (or scale + minVal)
  - createdAt timestamp

### 7.6.3 Improve insert failure observability

**Touchpoints**
- `tools/build-embeddings/hnsw.js` (~L1–L115)

**Required changes**
- Preserve and rely on the existing atomic write pattern:
  - write to a temp path
  - atomically replace the target `.bin`
  - keep a `.bak` via `replaceFile({ keepBackup: true })`
  - never delete `.bak` unless a subsequent successful load of the new `.bin` is confirmed (and even then, deletion is optional).
- In `writeIndex()`:
  - Collect insertion failures:
    - `{ idx, label, errorMessage }` (label is the chunk id)
  - If count mismatch:
    - write a JSON file alongside meta (e.g., `dense_vectors_hnsw.failures.json`) or include failure summary in meta
    - include top N failures in error message for debugging
- Ensure build fails loudly if insertion failures occur (unless explicitly configured to allow partial indexes).

### 7.6.4 Tests for HNSW variant selection and signature fallback

**Update existing tests**
- `tests/hnsw-ann.js`
  - Once doc/code variants are built, assert those files exist too.
- `tests/hnsw-atomic.js`
  - Ensure .bak fallback still works with new load logic.

**Add new test**
- `tests/hnsw-target-selection.js`
  - Build embeddings with stub embeddings.
  - Force `denseVectorMode=code` and ensure HNSW provider loads the code variant.
  - Force `denseVectorMode=doc` and ensure doc variant loads.

---

### 7.6.5 Acceptance criteria

- HNSW loading is compatible across supported `hnswlib-node` versions:
  - `loadHnswIndex()` successfully loads a valid index regardless of the `readIndexSync` signature variant.
  - If a signature mismatch occurs, fallback logic selects a working call shape and logs a single diagnostic warning.
- Insert failures are observable and actionable:
  - If HNSW insertion fails for any vector, the build either:
    - fails with a clear error including a failure summary, OR
    - (only if explicitly configured) produces a partial index and writes a failures report.
- Atomicity behavior remains correct:
  - If `.bak` exists and the main `.bin` is corrupt, load falls back to `.bak` and still serves results.

### 7.6.6 Tests

Add/Update the following tests:

- `tests/unit/hnsw-load-signature.test.js` (new)
  - Mocks multiple `readIndexSync` signatures and verifies fallback behavior.
- `tests/unit/hnsw-insert-failures.test.js` (new)
  - Forces insertion failures and asserts a failures report (or error) is emitted.
- `tests/hnsw-ann.js` (existing)
  - Extend to verify doc/code variant selection if Phase 7 builds those indices.
- `tests/hnsw-atomic.js` (existing)
  - Must continue to pass; ensures `.bak` fallback behavior remains intact.
- `tests/hnsw-candidate-set.js` (existing)
  - Must continue to pass; candidate-set filtering for HNSW remains correct.



## 7.7 Backend policy and ranking equivalence

### Why this exists

We need a single coherent way to:
- select which dense vectors are used for ranking (`denseVectorMode`)
- select which ANN target is used (must align with denseVectorMode)
- compare backends on a stable fixture (parity)

### 7.7.1 Wire denseVectorMode from config/CLI into retrieval

**Touchpoints**
- `docs/guides/search.md` (~L1–L74) (already references denseVectorMode)
- `src/retrieval/cli/normalize-options.js` (~L1–L273) (currently hardcodes denseVectorMode='merged')
- `src/retrieval/cli/options.js` (~L1–L141) (CLI option definitions)
- `src/retrieval/cli/query-plan.js` (~L1–L205) (already passes denseVectorMode into plan)
- `src/retrieval/query-intent.js` (~L1–L84) (resolveIntentVectorMode)

**Required changes**
- Add CLI option: `--dense-vector-mode merged|doc|code|auto`
  - default should match existing behavior (`merged`) to avoid breaking changes.
- Also allow config: `policy.retrieval.denseVectorMode` or `search.denseVectorMode` (choose one and document).
- Ensure `resolvedDenseVectorMode` is computed once and passed into `loadSearchIndexes()` (already).
- Ensure `resolveIntentVectorMode()` never returns `'auto'` when intent provided and valid; else allow 'auto' as fallback.

### 7.7.2 Ensure ANN backend target selection matches denseVectorMode

**Touchpoints**
- LanceDB:
  - `src/shared/lancedb.js` (~L1–L65) (`resolveLanceDbTarget`) ✅ already supports.
- HNSW:
  - `src/shared/hnsw.js` (~L1–L160) path resolver must support variants.
- SQLite-vec:
  - `tools/build-embeddings/sqlite-dense.js` (~L1–L209) and `tools/vector-extension.js` (~L1–L393)
  - If SQLite-vec is kept as merged-only, it must be documented and enforced.

**Required behavior**
- For each mode, the ANN provider uses the same vector variant as `idx.denseVec` uses.
- If a backend cannot support the selected variant, it must:
  - either fail with a clear error (if explicitly requested), or
  - fall back with an explicit warning (if auto-selected).

### 7.7.3 Parity tests: dense vs ANN backends

**Add new integration test**
- `tests/ann-parity.js`
  - Build index + embeddings for fixture repo with stub embeddings.
  - Run search with:
    - `--ann-backend dense`
    - `--ann-backend lancedb`
    - `--ann-backend hnsw`
  - For each, capture topK doc ids and scores.
  - Assert:
    - Dense is the reference.
    - ANN results contain the same top results in the same order for a deterministic stub embedding (or within a small tolerance / allow ties).
  - Run for multiple `denseVectorMode` values:
    - merged
    - code
    - doc

**Note**
- ANN parity can be relaxed for real embeddings, but for stub embeddings it should be exact or nearly exact.

---

### 7.7.4 Acceptance criteria

- `denseVectorMode` is end-to-end functional:
  - CLI/config can set `merged|doc|code|auto`.
  - The resolved mode is applied consistently to:
    - exact dense ranking
    - ANN target selection (LanceDB + HNSW; SQLite-vec if supported)
- Backend selection is explicit and explainable:
  - If a requested backend cannot satisfy the resolved vector mode, the system either errors clearly or falls back with an explicit warning (depending on selection policy).
- ANN parity tests pass on deterministic fixtures:
  - With stub embeddings, Dense vs ANN results match (or are within the defined tolerance window).

### 7.7.5 Tests

Add/Update tests:

- `tests/integration/ann-parity.test.js` (new; can be implemented as a Node script in this repo’s style)
  - Compares Dense vs LanceDB vs HNSW across vector modes.
- `tests/unit/dense-vector-mode.test.js` (new)
  - Verifies `resolveIntentVectorMode()` and `resolveDenseVector()` behaviors.
- `tests/unit/ann-backend-selection.test.js` (new)
  - Verifies the capability matrix and fallback/error behaviors.
- Existing backend smoke tests:
  - `tests/lancedb-ann.js`
  - `tests/hnsw-ann.js`



## 7.8 Storage resilience (LMDB/SQLite/cache)

### 7.8.1 LMDB mapSize planning

**Touchpoints**
- `tools/build-lmdb-index.js` (~L1–L311)
- `src/storage/lmdb/schema.js` (~L1–L49) (meta keys)
- Tests: `tests/lmdb-backend.js` (~L1–L122), `tests/lmdb-corruption.js` (~L1–L105), `tests/lmdb-report-artifacts.js` (~L1–L125)

**Required behavior**
- Compute a conservative mapSize before writing:
  - Derive an estimate from artifact sizes (chunk_meta, postings, file_relations, etc.)
  - Add overhead factor (e.g., *2.0) and minimum floor (e.g., 256MB)
  - Cap to a maximum if needed
- Write the chosen mapSize into LMDB meta keys so debugging is easier.

### 7.8.2 SQLite dense writer safety for shared DB paths

**Touchpoints**
- `tools/build-embeddings/sqlite-dense.js` (~L1–L209)
- `tools/dict-utils/paths/db.js` (~L1–L62) (resolveSqlitePaths)

**Current risk**
- `DELETE FROM dense_vectors_ann` is unscoped; if code and prose share the same DB file, one run can delete the other mode’s ANN table.

**Required change**
Choose one (documented) approach:
- Preferred: mode-specific ANN table names:
  - `dense_vectors_ann_code`, `dense_vectors_ann_prose`
- Alternative: add `mode` column to vector table and delete by mode (if supported by extension).

Update all query code accordingly:
- `tools/vector-extension.js` query table name must match.

### 7.8.3 Embedding cache preflight metadata

**Touchpoints**
- `tools/build-embeddings/cache.js` (~L1–L26)
- `tools/build-embeddings/runner.js` (~L1–L763)

**Goal**
- Avoid scanning full cache to validate dims/identity each run on huge repos.

**Required change**
- Write a cache meta file per (mode, identityKey), e.g.:
  - `<cacheRoot>/<mode>/cache_meta.json`
  - includes: identityKey, dims, model, normalize, quantization, createdAt
- On startup, runner loads this meta and uses it for fast validation.
- If missing, fall back to current scan and then write meta.

### 7.8.4 Tests for storage resilience

**Update tests**
- LMDB tests should continue to pass; add an assertion that mapSize meta exists (if added).
- Add a new test for shared SQLite DB path configuration:
  - Configure codeDbPath == proseDbPath in a temp user config
  - Build embeddings for code and prose
  - Assert both modes’ ANN tables exist and are not deleted by the other.

---

### 7.8.5 Acceptance criteria

- LMDB build is resilient:
  - `tools/build-lmdb-index.js` chooses a mapSize that prevents MapFull errors on Phase 7 fixtures.
  - The chosen mapSize is recorded in LMDB metadata for debugging.
- SQLite ANN tables are mode-safe:
  - If code and prose share a DB file, running embeddings build for one mode does not delete the other mode’s ANN data.
- Cache preflight avoids full scans in the common case:
  - When cache meta exists, runner does not scan the entire cache to validate dims/identity.

### 7.8.6 Tests

Add/Update tests:

- `tests/unit/lmdb-mapsize.test.js` (new)
  - Builds LMDB for a fixture repo and asserts no MapFull and that mapSize meta is present.
- `tests/unit/sqlite-ann-mode-scope.test.js` (new)
  - Configures shared DB paths and asserts both modes’ ANN tables remain intact.
- `tests/unit/cache-preflight-meta.test.js` (new)
  - Ensures cache meta is written and later used to avoid scanning.
- Existing LMDB tests (must continue to pass):
  - `tests/lmdb-backend.js`
  - `tests/lmdb-corruption.js`
  - `tests/lmdb-report-artifacts.js`
- Storage resilience integration test:
  - `tests/storage/embeddings-backend-resilience.test.js` (new)
    - Simulates partial backend failures (e.g., LanceDB build fails, HNSW succeeds) and asserts:
      - index_state advertises only available backends
      - retrieval does not attempt to use missing backend

### 7.8.7 Edge cases and fallback behavior

- Partial backend build failure:
  - If one backend fails (e.g., LanceDB directory missing/corrupt) but dense vectors exist:
    - `index_state.embeddings.ready` may still be true (dense vectors are usable).
    - `index_state.embeddings.backends.lancedb.available` must be false.
    - Retrieval must either fall back to another backend or Dense, without crashing.
- Manifest mismatch:
  - If an artifact exists on disk but is missing from manifest (strict mode):
    - validation should fail loudly
    - retrieval should treat it as unavailable and surface a clear message rather than guessing.



## Mapping: Where this work fits in the repo

### ANN backends
- LanceDB:
  - Build: `tools/build-embeddings/lancedb.js`
  - Runtime: `src/retrieval/lancedb.js`, `src/retrieval/ann/providers/lancedb.js`, `src/shared/lancedb.js`
- HNSW:
  - Build: `tools/build-embeddings/hnsw.js`
  - Runtime: `src/shared/hnsw.js`, `src/retrieval/ann/providers/hnsw.js`, `src/retrieval/cli-index.js`
- SQLite vector extension:
  - Build: `tools/build-embeddings/sqlite-dense.js`
  - Runtime: `tools/vector-extension.js`, `src/retrieval/sqlite-helpers.js`

### Artifact contract / manifest
- Contract docs:
  - `docs/contracts/public-artifact-surface.md`
  - `docs/contracts/artifact-schemas.md`
- Schema code:
  - `src/contracts/registry.js`
  - `src/contracts/schemas/artifacts.js`
- Manifest tooling:
  - `tools/build-embeddings/manifest.js`
  - `src/shared/artifact-io/manifest.js`

---

## Addendum: Strict manifest compliance requirements

This addendum is **mandatory** for Phase 7 completeness.

### A. Strict mode must not guess filenames

Any code path that loads artifacts in strict mode MUST NOT:
- `fs.readFile(path.join(dir, 'dense_vectors_uint8.json'))`
- check for `dense_vectors_hnsw.bin` via guessed filename
- scan directories for `.lancedb`

Instead, strict mode MUST:
- load manifest (`pieces/manifest.json`)
- resolve artifact paths through `resolveArtifactPresence()`

### B. Non-strict fallback is allowed only as a temporary compatibility bridge

If non-strict mode is supported:
- It should be explicitly gated by a CLI flag (e.g., `--non-strict`) or an internal option.
- It should emit a warning that strict contract is being bypassed.

---

## Fixtures list

Use these fixtures in tests. Prefer deterministic, small fixtures; do not introduce “random” corpora that make ANN results flaky.

### Existing fixture repos already in-tree
- `tests/fixtures/sample/`  
  - Primary small deterministic fixture repo used broadly in existing tests.

### Phase 7 fixture repos to add (or verify) under `tests/fixtures/embeddings/`

If these directories do not exist yet, Phase 7 must create them exactly as specified.

1. `tests/fixtures/embeddings/basic-repo/`
   - Purpose: baseline end-to-end embeddings + ANN build on a tiny repo.
   - Must include:
     - At least 2 small code files (e.g., `src/a.js`, `src/b.py`)
     - At least 1 prose file (e.g., `README.md`)
   - Expected behavior:
     - Both `index-code` and `index-prose` produce chunk_meta and dense vectors artifacts.
     - ANN backends can be built if optional deps exist.

2. `tests/fixtures/embeddings/missing-vectors/`
   - Purpose: validate that “missing code/doc vectors” are handled deterministically (zero-fill), and merged vectors normalize correctly.
   - Must include:
     - A small code file with no doc/comments (so `docVector` can be missing/empty in some build paths)
     - A prose file that produces doc-only content
   - Expected behavior:
     - `dense_vectors_doc` for some chunks is all-zero.
     - Merged vector is normalized and non-NaN.
     - ANN builders do not crash on many identical doc vectors.

3. `tests/fixtures/embeddings/quantization-caps/`
   - Purpose: validate quantization clamping and “no wrap” invariants.
   - Must include:
     - A repo with enough chunks to exercise vector writing (even 5–10 chunks is fine).
     - A repo-local config that intentionally sets `quantization.levels` out of range (e.g., 9999).
   - Expected behavior:
     - Artifacts contain only 0..255 values.
     - `embeddingIdentity.quantization.levels` reflects the **clamped** effective value.

### Stub embeddings mode
To keep tests deterministic and fast, use stub embeddings wherever possible:
- Environment: `PAIROFCLEATS_EMBEDDINGS=stub` (or the repo’s equivalent stub toggle)
- Requirement:
  - Stub embeddings must produce deterministic vectors based only on input text and requested dims.
  - They must support both code and prose modes.

## Compat migration checklist Phase 7

Phase 7 intentionally adds fields and manifest entries. It must remain safe to run against older builds and older queue payloads.

Checklist:

- [ ] **Do not rename dense vector filenames on disk.**  
  Keep:
  - `dense_vectors_uint8.json`
  - `dense_vectors_doc_uint8.json`
  - `dense_vectors_code_uint8.json`  
  Phase 7 may add optional metadata fields to these JSON objects, but must not change filenames.

- [ ] **Queue payload versioning is explicit and safe.**
  - New jobs must include `embeddingPayloadFormatVersion: 2`.
  - Worker must either:
    - accept v1 payloads and upgrade them with a warning, or
    - refuse v1 payloads with a clear error message that points to remediation.
  - Never “silently reinterpret” ambiguous fields without logging.

- [ ] **index_state fields are additive.**
  - Preserve existing `index_state.embeddings.enabled/ready/service/mode` semantics.
  - Add new fields (`pending`, `embeddingIdentity`, `embeddingIdentityKey`, `backends`) without breaking older readers.

- [ ] **Strict manifest compatibility.**
  - Older builds may not include embedding artifacts in `pieces/manifest.json`.
  - In strict mode, treat missing manifest entries as “artifact unavailable” and surface a clear validation error (do not guess filenames).
  - If non-strict mode is supported, it may fall back to guessed filenames but must warn.

- [ ] **Optional dependencies remain optional.**
  - If `hnswlib-node` is not installed:
    - Build should skip HNSW gracefully.
    - Manifest must not list HNSW artifacts.
    - Retrieval must not advertise HNSW as available.
  - If `lancedb` is not installed:
    - Build should skip LanceDB gracefully.
    - Manifest must not list LanceDB artifacts.
    - Retrieval must not advertise LanceDB as available.

- [ ] **Quantization clamp is allowed to invalidate caches.**
  - If an out-of-range `levels` value previously produced incorrect artifacts, Phase 7 clamp is a correctness fix.
  - Any resulting cache invalidation is expected; document it and ensure failures are clear (“identityKey changed”).

## Artifacts contract appendix

This appendix consolidates the *minimum* contract required for Phase 7 so implementers do not need to cross-reference multiple docs while coding. It is additive with (and must not contradict) `docs/contracts/public-artifact-surface.md`.

### A. Dense vector artifacts

These artifacts are JSON objects whose `vectors` field contains the quantized vectors.

#### A.1 `dense_vectors`  
- Manifest name: `dense_vectors`  
- On-disk file: `dense_vectors_uint8.json`

#### A.2 `dense_vectors_doc`  
- Manifest name: `dense_vectors_doc`  
- On-disk file: `dense_vectors_doc_uint8.json`

#### A.3 `dense_vectors_code`  
- Manifest name: `dense_vectors_code`  
- On-disk file: `dense_vectors_code_uint8.json`

#### Required keys (all three)
- `dims` (int)  
- `vectors` (array)  
- `scale` (number)

#### Optional keys (recommended in Phase 7)
- `model` (string or null)
- `minVal` (number)
- `maxVal` (number)
- `levels` (int)
- `quantization` (object, if you want a structured form)
- `embeddingIdentityKey` (string)
- `createdAt` (ISO timestamp)

#### Vector invariants
- For every vector `v` in `vectors`:
  - `v.length === dims`
  - every element is an integer in `[0, 255]`
- If a vector is missing upstream (no doc text, etc), zero-fill is allowed but must be deterministic.

---

### B. HNSW artifacts

HNSW consists of a binary index file plus a JSON meta file.

#### Names and paths (merged/doc/code)
- `dense_vectors_hnsw` → `dense_vectors_hnsw.bin`
- `dense_vectors_hnsw_meta` → `dense_vectors_hnsw.meta.json`
- `dense_vectors_doc_hnsw` → `dense_vectors_doc_hnsw.bin`
- `dense_vectors_doc_hnsw_meta` → `dense_vectors_doc_hnsw.meta.json`
- `dense_vectors_code_hnsw` → `dense_vectors_code_hnsw.bin`
- `dense_vectors_code_hnsw_meta` → `dense_vectors_code_hnsw.meta.json`

#### B.1 HNSW meta required keys
- `dims` (int)
- `count` (int)
- `space` (string; e.g. `cosine|l2|ip`)

#### B.2 HNSW meta optional keys (recommended)
- `efSearch` (int)
- `m` (int)
- `efConstruction` (int)
- `expectedModel` (string; legacy, if present)
- `identityKey` or `embeddingIdentityKey` (string)
- `createdAt` (ISO timestamp)
- quantization metadata (`minVal/maxVal/levels` or equivalent)

#### B.3 HNSW binary file invariants
- The `.bin` file is treated as an opaque artifact for the contract.
- It MUST be discoverable via the manifest in strict mode.
- `.bak` files are implementation details and must not be separately listed in the manifest.

---

### C. LanceDB artifacts

LanceDB consists of a directory plus a JSON meta file.

#### Names and paths (merged/doc/code)
- `dense_vectors_lancedb` → `dense_vectors.lancedb/`
- `dense_vectors_lancedb_meta` → `dense_vectors.lancedb.meta.json`
- `dense_vectors_doc_lancedb` → `dense_vectors_doc.lancedb/`
- `dense_vectors_doc_lancedb_meta` → `dense_vectors_doc.lancedb.meta.json`
- `dense_vectors_code_lancedb` → `dense_vectors_code.lancedb/`
- `dense_vectors_code_lancedb_meta` → `dense_vectors_code.lancedb.meta.json`

#### C.1 LanceDB meta required keys
- `dims` (int)
- `count` (int)
- `metric` (string; e.g. `cosine|l2|dot`)

#### C.2 LanceDB meta additional keys (recommended)
- `table` (string; table name)
- `idColumn` (string; must match how IDs are stored, typically `id`)
- `embeddingColumn` (string; column containing vector embedding)
- `identityKey` or `embeddingIdentityKey` (string)
- `createdAt` (ISO timestamp)
- quantization metadata (`minVal/maxVal/levels` or equivalent)

#### C.3 LanceDB directory invariants
- The directory MUST be discoverable via the manifest in strict mode.
- Directory contents are considered backend-specific implementation details, but must remain stable enough for readers to open.

---

### D. Manifest entry invariants

Every manifest entry must include:
- `name` (string; canonical artifact name)
- `path` (string; relative to the indexDir)
- `format` (string; one of `json|jsonl|bin|dir`)
- `bytes` (int)  
  - For `dir` entries, `bytes` may be omitted. If present, it must be deterministic.

Recommended fields:
- `sha256` for file entries (`json`, `jsonl`, `bin`)

---

### E. Cross-artifact invariants

- If `index_state.embeddings.ready === true` then the manifest MUST contain `dense_vectors`.
- If an ANN backend is reported as available in `index_state.embeddings.backends.*.available === true`, then the corresponding artifact entries MUST exist in the manifest.

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
- `src/index/metadata-v2.js` — attach `metaV2.symbol` (definition chunks only).
- `src/shared/identity.js` — **already exists** and contains symbol identity primitives. Phase 9 MUST extend/reuse this (do **not** fork identity algorithms).
- New (optional wrapper): `src/index/identity/symbol.js` — if created, keep it as a thin adapter over `src/shared/identity.js` for index-specific policy (definition chunk detection, kind-group mapping, etc).
- Update callsites: graph builder, cross-file resolver, map builder

#### 9.2.1 Implement symbol identity builder

- [ ] **Update `src/shared/identity.js` (do this first)**
  - [ ] Confirm/export the primitives used by every symbol identity producer:
    - `buildSymbolKey(...)`
    - `buildSignatureKey(...)`
    - `buildScopedSymbolId(...)`
    - `buildSymbolId(...)`
    - `resolveSymbolJoinKey(...)` (used to join calls/usages to symbol definitions)
  - [ ] Ensure the primitives accept the Phase 9 canonical inputs (`virtualPath`, `qualifiedName`, `signature`, `kindGroup`, `chunkUid`/`segmentUid` as required by the Phase 9 contracts) and **do not depend on legacy `chunkId`** for uniqueness unless explicitly marked legacy/back-compat.

- [ ] **Add `src/index/identity/kind-group.js`**
  - [ ] Implement `toKindGroup(kind: string | null): string`

- [ ] **Add `src/index/identity/symbol.js`** *(thin adapter over `src/shared/identity.js`)*
  - [ ] Export `buildSymbolIdentity({ metaV2 }): { scheme, kindGroup, qualifiedName, symbolKey, signatureKey, scopedId, symbolId } | null`
  - [ ] **Hard requirement:** implement hashing/key building by calling helpers from `src/shared/identity.js` (e.g., `buildSymbolKey`, `buildSignatureKey`, `buildScopedSymbolId`, `buildSymbolId`).  
    Do **not** create a second independent SymbolKey/SignatureKey algorithm.
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

#### 9.4.4 Tooling provider audit (chunkUid-keyed outputs are already implemented)

✅ **Current repo state (verified in code):** all built-in tooling providers already return results keyed by `chunkUid` (no `file::name` Maps).

Providers (current touchpoints):
- `src/index/tooling/clangd-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/pyright-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/sourcekit-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: false`)
- `src/index/tooling/typescript-provider.js` — returns `{ byChunkUid }` (capability: `supportsSymbolRef: true`)

**Why keep this task anyway?**  
Phase 9 relies on `chunkUid` as the canonical join key, so we need a regression-proof audit + tests that prevent reintroducing `file::name` joins.

- [x] Confirm each provider’s public output surface is `{ provider, byChunkUid }` (not `{ byFile }`).
- [ ] Add a targeted regression test per provider that asserts:
  - [ ] the top-level key is `byChunkUid`,
  - [ ] keys look like `ck64:v1:` / `chunk:`-style UIDs (not `file::name`),
  - [ ] duplicate keys are not silently overwritten (throw or log+count, but do not drop).
  - Suggested test files (choose lane explicitly):
    - `tests/unit/tooling/clangd-provider-output-shape.test.js`
    - `tests/unit/tooling/pyright-provider-output-shape.test.js`
    - `tests/unit/tooling/sourcekit-provider-output-shape.test.js`
    - `tests/unit/tooling/typescript-provider-output-shape.test.js`

**Additional Phase 9 requirement for TS provider**
- [ ] Ensure the TS provider’s `symbolRef` emission uses the Phase 9 symbol identity scheme (see 9.2), and does not embed legacy `chunkId` in any join-critical field unless explicitly marked “legacy/back-compat”.

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

## Appendix A -- Concrete file-by-file change list

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
## Phase 10 — Interprocedural risk propagation + explainability artifacts

**Goal:** Add a deterministic, capped, explainable *interprocedural* risk propagation system for the **code** index mode that:
- Reuses existing **local** risk signals (`docmeta.risk` from `src/index/risk.js`).
- Reuses existing **cross-file inference** call resolution (`applyCrossFileInference`), specifically `callDetails[].targetChunkUid`.
- Emits **new artifacts**:
  - `risk_summaries*.jsonl` (+ shard meta)
  - `risk_flows*.jsonl` (+ shard meta)
  - `risk_interprocedural_stats.json`
- Adds a compact, low-bytes **`docmeta.risk.summary`** for each risk-relevant chunk (to support fast display/filtering without scanning JSONL).
- Provides a CLI to explain the flows in an index (`pairofcleats risk explain …`).

---

### Source-of-truth decisions + conflicts resolved 

This phase touches multiple “specs” that are currently **not aligned** with the repo’s implemented contracts. Implement the *best* functionality **and** remove ambiguity by making these explicit choices.

#### A) `call_sites.jsonl` schema: **CODE contract is authoritative**
- **Authoritative schema:** `src/contracts/schemas/artifacts.js` (`call_sites` entry schema)
- **Writer:** `src/index/build/artifacts/writers/call-sites.js`

The older spec `docs/specs/risk-flows-and-call-sites.md` contains a *different* `call_sites` row shape (e.g., `calleeName`, `argsSummary`, no `start/end offsets`, etc.). That spec is **out of date** for `call_sites`.

✅ **Choice:** Do **not** change the repo’s `call_sites` contract to match the spec.  
✅ **Action:** Update the *documents/specs* to match the code contract (see **10.0 Doc merge**).

**Why:** `call_sites` already exists, is validated by contracts/tests, and is used for call graph evidence. The safest and most correct approach is to treat the implemented contract as the single source of truth and bring docs into alignment.

#### B) `callSiteId` algorithm: **keep the existing implementation; update newer docs**
- **Actual implementation:** `buildCallSiteId(...)` in `src/index/build/artifacts/writers/call-sites.js`
- **Doc (currently aligned with code):** `docs/specs/risk-callsite-id-and-stats.md`
- **Doc (currently NOT aligned with code):** `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (it proposes a different string-to-hash recipe)

✅ **Choice:** Keep the current algorithm (colon-separated parts, no `callsite:v1` prefix).  
✅ **Action:** Update the “IMPROVED” doc during merge (or explicitly label it as a future v2) so docs do not contradict working code.

**Why:** Changing `callSiteId` would silently invalidate any stored references and degrade determinism across builds. We can introduce a versioned v2 later **only** if we add an explicit `callSiteIdVersion`/`schemaVersion` surface.

#### C) Config surface conflict: “repo config contract” vs Phase 10 config keys
- `docs/config/contract.md` suggests a narrow public config surface.
- Phase 10’s specs and roadmap require `indexing.riskInterprocedural`.

✅ **Choice (best for engineering velocity + testability):** Treat `indexing.riskInterprocedural` as an **internal/advanced** indexing knob and explicitly preserve it through config load/normalization.  
✅ **Action:** Update `tools/dict-utils/config.js` normalization to keep `indexing.riskInterprocedural` (and any prerequisite knobs used by runtime gating), and update docs so the contract vs internal knobs are clearly delineated.

**Why:** Interprocedural risk is *expensive* and must be opt-in. The least invasive, most explicit opt-in is a config knob. If the product wants a narrower public contract later, it can gate exposure without deleting the internal setting.

---

## 10.0 Documentation merge + canonical spec cleanup (FOUNDATION — do first)

> **Objective:** Eliminate spec drift *before* implementation.

### 10.0.1 Merge/replace outdated specs with reconciled versions
Files involved (read all, then produce a merged canonical set):

- Canonical targets (should live under `docs/specs/`):
  - `docs/specs/risk-interprocedural-config.md`
  - `docs/specs/risk-summaries.md`
  - `docs/specs/risk-flows-and-call-sites.md`
  - `docs/specs/risk-callsite-id-and-stats.md`
  - `docs/specs/risk-interprocedural-stats.md` (currently placeholder)

- Sources to merge in (from `docs/new_docs/`):
  - `spec_risk-interprocedural-config_IMPROVED.md`
  - `spec_risk-summaries_IMPROVED.md`
  - `spec_risk-flows-and-call-sites_RECONCILED.md`
  - `risk-callsite-id-and-stats_IMPROVED.md`
  - `interprocedural-state-and-pipeline_DRAFT.md`

**Required merge outcomes (no ambiguity):**
1. **`call_sites` schema section** in `risk-flows-and-call-sites.md` must explicitly say:
   - “Call sites are the existing artifact contract in `src/contracts/schemas/artifacts.js`.”
   - “For interprocedural risk, we only require a subset of fields (list them), but the artifact may contain superset fields.”
2. **`callSiteId` algorithm** section must match `buildCallSiteId` in `call-sites.js` (use `calleeRaw`, not `calleeName`).
3. **Risk summaries schema** must incorporate the improved doc’s stronger evidence shape (start/end line+col) **and** keep the older doc’s truncation/caps guidance. Any mismatched field names must be resolved (see 10.3 for the final schema we will implement).
4. **Risk flows schema**: keep the roadmap’s detailed schema (source+sink endpoints, path with `chunkUids` + `callSiteIdsByStep`, confidence, notes). If any new_docs schema differs, update it to match.
5. **Stats schema** must be explicit about what “callSitesEmitted” counts in a world where `call_sites` is a general artifact:
   - ✅ Define it as “unique callSiteIds referenced by emitted `risk_flows`” (not total rows in call_sites).
6. Remove any outdated statements (e.g., “docs/config/schema.json doesn’t include indexing.*” is no longer accurate).

### 10.0.2 Add “Spec status table” inside Phase 10 docs
Create a small table (in whichever canonical spec is most appropriate, or at the top of this Phase 10 section) showing:

- spec file → implemented-by code module → status (implemented / draft / planned)
- version numbers (schemaVersion) and compatibility notes


### 10.0.3 Archive deprecated specs + codify the process (MANDATORY)

This implements the repo-wide rule:

> Deprecated/replaced spec documents must be moved to `docs/archived/` (never deleted), and the process must be documented in `AGENTS.md`.

**Tasks**
- [ ] Create `docs/archived/README.md` explaining:
  - what belongs here,
  - how to name/archive files,
  - how to reference the replacement spec.
- [ ] Create `docs/archived/phase-10/` (or `docs/archived/specs/phase-10/`) as the destination for Phase 10 spec deprecations.
- [ ] After the merges in **10.0.1** are complete:
  - [ ] Move the *staging* source docs from `docs/new_docs/` that are no longer meant to be edited:
    - `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
    - `docs/new_docs/spec_risk-summaries_IMPROVED.md`
    - `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
    - `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
    - `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md`
    - Destination: `docs/archived/phase-10/` (keep filenames intact).
  - [ ] Add a short “DEPRECATED” header block to each moved file that points to the canonical replacement(s) in `docs/specs/…`.
- [ ] Update **`AGENTS.md`** with a “Spec deprecation + archival process” section:
  - When to archive vs update-in-place.
  - Required metadata to include in the archived file header (replacement link + date/PR).
  - A reminder that contracts (`src/contracts/**`) remain authoritative and specs must track them.

**Why this is required**
- `docs/new_docs/` is a staging area; leaving parallel variants creates drift and confusion.
- `docs/archived/` preserves context without keeping multiple “active” specs.


---

## 10.1 Config wiring + runtime gating (FOUNDATION — do before any propagation code)

### 10.1.1 Add risk interprocedural config normalizer
**New file:** `src/index/risk-interprocedural/config.js`

Export:
- `normalizeRiskInterproceduralConfig(raw, { mode })`

Inputs:
- `raw` comes from `runtime.indexingConfig.riskInterprocedural` (or `{}`).

Output (**effective config**; use these defaults unless the merged spec dictates otherwise):
```js
{
  enabled: false,                 // hard gate
  summaryOnly: false,             // if true: summaries + compact docmeta only, no propagation, no risk_flows
  strictness: 'conservative',     // 'conservative' | 'argAware'
  sanitizerPolicy: 'terminate',   // 'terminate' | 'weaken'
  emitArtifacts: 'jsonl',         // 'none' | 'jsonl'  (accept legacy aliases: 'off' -> 'none')
  caps: {
    maxDepth: 4,
    maxPathsPerPair: 3,
    maxTotalFlows: 5000,
    maxCallSitesPerEdge: 3,
    maxEdgeExpansions: 200000,    // global cap on edge traversals (prevents explosion even if flows are capped)
    maxMs: 2500                   // wall clock budget; null disables
  }
}
```

**Normalization rules (MUST be deterministic):**
- `emitArtifacts`: accept `off|none` → `none`, `jsonl` → `jsonl`. Anything else → default `jsonl`.
- `strictness`: unknown → `conservative`
- `sanitizerPolicy`: unknown → `terminate`
- numeric caps:
  - coerce to integers
  - clamp to sane ranges (define in code):
    - `maxDepth`: 1..20
    - `maxPathsPerPair`: 1..50
    - `maxTotalFlows`: 0..1_000_000
    - `maxCallSitesPerEdge`: 1..50
    - `maxEdgeExpansions`: 10_000..10_000_000
    - `maxMs`: null OR 10..60_000
- `summaryOnly=true` forces “no flows” even if other caps allow.
- If `enabled=false`, downstream code must treat the entire feature as disabled and avoid any heavy compute.

### 10.1.2 Preserve config keys through repo config normalization
**File:** `tools/dict-utils/config.js`  
Function: `normalizeUserConfig(config)`

Today this function intentionally narrows the public config surface. For Phase 10 to be operable and testable, we must preserve:

- `config.indexing.riskInterprocedural` (entire nested object)

**Implementation requirement:**
- Add:
  - `riskInterprocedural: indexingConfig.riskInterprocedural || undefined`
  - under the returned `indexing` object.
- Keep it **as-is** (no normalization here); normalization is done in `src/index/risk-interprocedural/config.js`.

Also preserve any prerequisite knobs *already used by runtime* and referenced by specs (only if they are currently being dropped):
- `indexing.riskAnalysis` (if you want it configurable)
- `indexing.riskAnalysisCrossFile`
- `indexing.typeInferenceCrossFile`

If the project intentionally keeps these non-configurable, document that clearly in the merged specs and do not add them.

### 10.1.3 Wire effective config into build runtime
**File:** `src/index/build/runtime/runtime.js`

Tasks:
1. Import `normalizeRiskInterproceduralConfig`.
2. Compute:
   - `const riskInterproceduralConfig = normalizeRiskInterproceduralConfig(indexingConfig.riskInterprocedural, { mode });`
3. Add to returned runtime:
   - `riskInterproceduralConfig`
   - `riskInterproceduralEnabled` (boolean)
     - `true` iff:
       - `mode === 'code'`
       - `riskAnalysisEnabled === true` (Phase 10 depends on local signals)
       - `riskInterproceduralConfig.enabled === true`
4. Add gating to `analysisPolicy`:
   - include `analysisPolicy.risk.interprocedural = riskInterproceduralEnabled`
   - include `analysisPolicy.risk.interproceduralSummaryOnly = riskInterproceduralConfig.summaryOnly`

### 10.1.4 Ensure cross-file inference runs when riskInterprocedural is enabled
**File:** `src/index/build/indexer/steps/relations.js`

Current logic:
- `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`

Update to:
- `crossFileEnabled = typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled || runtime.riskInterproceduralEnabled`

**Important constraint:** Enabling cross-file inference does **not** have to enable “type inference output artifacts”; it only needs to run resolution so `callDetails[].targetChunkUid` exists.

So, keep:
- `enableTypeInference: typeInferenceCrossFileEnabled`
- `enableRiskCorrelation: riskAnalysisCrossFileEnabled`
- (do NOT implicitly force these true just because riskInterprocedural is enabled)

### 10.1.5 Incremental build signature must include riskInterprocedural effective config
**File:** `src/index/build/indexer/signatures.js`

Add `riskInterproceduralConfig` (or a stable subset) to the signature components so incremental rebuilds invalidate when this changes.

- Use a stable JSON stringify (or hash) of the *normalized effective config* object.
- Do **not** include transient fields like timers.

### 10.1.6 Index state output must record whether this feature ran
**File:** `src/index/build/indexer/steps/write.js`

In `index_state.json`, add:
```json
"riskInterprocedural": {
  "enabled": true,
  "summaryOnly": false,
  "emitArtifacts": "jsonl"
}
```

(Exact nesting is flexible; but it must be deterministic and allow tooling to quickly see if risk flows are expected.)

### 10.1.7 Tests for config and gating
Add:
- `tests/risk-interprocedural/config-normalization.test.js`
  - unit test `normalizeRiskInterproceduralConfig`
  - include edge cases: alias values, bad types, clamp behavior
- `tests/risk-interprocedural/runtime-gating.test.js`
  - create runtime via `createBuildRuntime` with mode=`code` and mode=`prose`
  - assert `riskInterproceduralEnabled` toggles correctly
  - assert crossFileEnabled includes it (mock `runCrossFileInference` decision logic)

---

## 10.2 Param name stabilization for arg-aware mode (FOUNDATION)

> Arg-aware propagation requires stable “callee param names” to map tainted args → callee identifiers.

### 10.2.1 Fix JS param extraction to be stable + predictable
**File:** `src/lang/javascript/relations.js` (anchors referenced in original roadmap: around callLinks generation and docmeta param extraction)

Current risk:
- `node.params` can contain patterns (destructuring, defaults) that stringify inconsistently.

Required changes:
1. When building `docmeta.params` (or an adjacent structured field), produce **paramNames** array:
   - For `Identifier` param: use name directly.
   - For `AssignmentPattern` (`x=1`): use left identifier name if possible.
   - For `RestElement` (`...rest`): use argument identifier name if possible.
   - For patterns (`ObjectPattern`, `ArrayPattern`), use stable placeholders:
     - `"arg0"`, `"arg1"`, … (based on param index)
2. Ensure `paramNames` is:
   - stable order
   - capped (e.g., 16)
3. Preserve the existing `docmeta.signature` format (do not break search behavior).

**Cross-file inference dependency:**  
`applyCrossFileInference` populates `callLinks.paramNames` via `extractParamTypes`. That function must rely on stable `docmeta.params` or a new stable `docmeta.paramNames`. If needed:

- Update `src/index/type-inference-crossfile/extract.js` (function `extractParamTypes`) to prefer:
  - `docmeta.paramNames` if present
  - else fall back to `docmeta.params`

### 10.2.2 Add tests for JS param normalization
Add:
- `tests/lang/javascript-paramnames.test.js`

Fixture function:
```js
function f({a,b}, x=1, ...rest) {}
```

Expect:
- `docmeta.paramNames` equals `["arg0","x","rest"]`
- `callLinks.paramNames` for calls to `f` are consistent.

---

## 10.3 Risk summaries (artifact + compact docmeta)

> Summaries are the “input facts” for propagation and the primary explainability artifact even when propagation is disabled or times out.

### 10.3.1 Define the *final* summary row schema (implement exactly)
After doc merge (10.0), Implement this as the actual row contract (`schemaVersion: 1`):

**Artifact:** `risk_summaries.jsonl` (sharded)

**Row (RiskSummaryRowV1):**
```ts
{
  schemaVersion: 1,

  // identity
  chunkUid: string,
  file: string,
  languageId: string|null,

  // optional symbol context (for debugging / UI; must not bloat)
  symbol: {
    name: string|null,
    kind: string|null,
    signature: string|null
  },

  // signals (bounded + deterministic)
  signals: {
    sources: RiskSignalSummary[],
    sinks: RiskSignalSummary[],
    sanitizers: RiskSignalSummary[],
    localFlows: RiskLocalFlowSummary[]
  },

  // optional: local taint hints (helps arg-aware)
  taintHints?: {
    taintedIdentifiers: string[]
  },

  totals: {
    sources: number,
    sinks: number,
    sanitizers: number,
    localFlows: number
  },

  truncated: {
    sources: boolean,
    sinks: boolean,
    sanitizers: boolean,
    localFlows: boolean,
    evidence: boolean
  }
}
```

**RiskSignalSummary:**
```ts
{
  ruleId: string,
  ruleName: string,
  ruleType: "source"|"sink"|"sanitizer",
  category: string|null,
  severity: string|null,        // only meaningful for sinks
  confidence: number|null,      // 0..1
  tags: string[],               // bounded
  evidence: EvidenceRef[]       // bounded
}
```

**EvidenceRef:**
```ts
{
  file: string,
  startLine: number,
  startCol: number,
  endLine: number|null,
  endCol: number|null,
  snippetHash: string|null      // "sha1:<hex>" or null
}
```

**RiskLocalFlowSummary (resolve ambiguity explicitly):**
Because local flows involve a *pair* of rules, store both IDs:
```ts
{
  sourceRuleId: string,
  sinkRuleId: string,
  category: string|null,        // usually from sink
  severity: string|null,        // usually from sink
  confidence: number|null,      // derived from source/sink confidences
  evidence: EvidenceRef[]
}
```

This removes the ambiguity present in `spec_risk-summaries_IMPROVED.md` where flows had a single `ruleId`.

### 10.3.2 Implement summary builder
**New file:** `src/index/risk-interprocedural/summaries.js`

Exports:
- `buildRiskSummaries({ chunks, runtime, mode, log })`

Behavior:
1. Only run when:
   - `mode === 'code'`
   - `runtime.riskInterproceduralEnabled === true` OR `runtime.riskInterproceduralConfig.emitArtifacts === 'jsonl'`
   - (If disabled entirely, skip.)
2. For each chunk in `state.chunks`:
   - Read `chunk.docmeta?.risk` (produced by `src/index/risk.js`).
   - If no risk or no signals, skip row emission.
3. Convert `docmeta.risk.sources/sinks/sanitizers` into `RiskSignalSummary[]`:
   - Deterministic ordering:
     - primary: `severity` (high→medium→low→null) for sinks only
     - then `ruleId`
     - then earliest evidence location
   - Caps:
     - `maxSignalsPerKind = 50`
     - `maxEvidencePerSignal = 5`
     - `maxTagsPerSignal = 10`
4. Convert `docmeta.risk.flows` into `RiskLocalFlowSummary[]`:
   - Derive `sourceRuleId`/`sinkRuleId` from existing detector output:
     - detector: `flow.ruleIds = [sourceRuleId, sinkRuleId]`
   - Deterministic order:
     - `sourceRuleId`, then `sinkRuleId`, then evidence location
   - Caps:
     - `maxLocalFlows = 50`
5. Evidence normalization:
   - Input evidence from detector is `{ line, column, excerpt }`
   - Map:
     - `startLine = line`
     - `startCol = column`
     - `endLine = line` (or null if you prefer; pick one and be consistent)
     - `endCol = column`
     - `snippetHash = sha1(normalizeWhitespace(excerpt))` or null if excerpt missing/empty after normalize
   - Use `sha1` from `src/shared/hash.js`
6. Produce `totals` and `truncated` flags:
   - `totals.*` counts BEFORE truncation
   - `truncated.*` indicates truncation actually occurred

### 10.3.3 Attach compact summary to `docmeta.risk.summary`
**Output field:** `chunk.docmeta.risk.summary`

Compact schema (must stay small; no evidence arrays):
```ts
{
  sources: { count: number },
  sinks: { count: number, maxSeverity: string|null },
  sanitizers: { count: number },
  localFlows: { count: number },

  topCategories: string[],   // max 5
  topTags: string[],         // max 8

  interprocedural: {
    enabled: boolean,
    summaryOnly: boolean
  }
}
```

Rules:
- Populate only if chunk has at least one local risk signal or local flow.
- Values must be deterministic (sort ties lexicographically).
- This compact summary is what UIs and CLI can read quickly without parsing JSONL.

### 10.3.4 Export `taintHints` from local risk detector
**File:** `src/index/risk.js`

Enhancement:
- The local risk detector already tracks a `taint` map internally for assignment propagation.
- Add a bounded list:
  - `taintHints: { taintedIdentifiers: string[] }`
  - Sort + cap (e.g., 50)
- Attach to `docmeta.risk`.

This improves arg-aware propagation but is not required for correctness if `strictness=conservative`.

### 10.3.5 Per-row size cap enforcement (required)
Both summary rows and compact summary additions must obey size limits.

**Hard limit:** `<= 32 KiB` per JSONL row.

Implement row trimming in `buildRiskSummaries` (or in the writer) with deterministic steps:
1. Drop `tags` arrays from all signals.
2. Reduce evidence per signal to 1.
3. Drop all evidence arrays.
4. If still too large: drop the entire summary row and record in stats (`summariesDroppedBySize++`).

### 10.3.6 Tests for summaries
Add:
- `tests/risk-interprocedural/summaries-schema.test.js`
  - Build a fixture index; load `risk_summaries.jsonl`; schema-validate; verify expected counts.
- `tests/risk-interprocedural/summaries-determinism.test.js`
  - Run summary build twice on same fixture (same runtime), assert identical JSONL output bytes.
- `tests/risk-interprocedural/summaries-truncation.test.js`
  - Construct an artificial chunk with huge tags/evidence, assert trimming steps fire and flags/stats reflect.

---

## 10.4 Shared callsite utilities (FOUNDATION)

### 10.4.1 Factor callSiteId algorithm into a shared helper
**Goal:** Risk flows must reference callSiteIds that match the `call_sites` writer exactly.

**New file (recommended):** `src/index/callsite-id.js`

Export:
- `buildCallSiteId({ file, startLine, startCol, endLine, endCol, calleeRaw })`

Implementation:
- Move (or copy exactly) the logic from `src/index/build/artifacts/writers/call-sites.js`.
- Update call-sites writer to import it (so there is only one implementation).

### 10.4.2 Define edge-key and call site sampling helpers
**New file:** `src/index/risk-interprocedural/edges.js`

Exports:
- `edgeKey(callerUid, calleeUid) => string` (format: `"${callerUid}→${calleeUid}"`)
- `sortCallDetailsForSampling(a, b)` (deterministic comparator)
- `sampleCallSitesForEdge(callDetails, { maxCallSitesPerEdge }) => CallSiteSample[]`

Where `CallSiteSample` includes:
```ts
{
  callSiteId: string,
  args: string[]|null
}
```

Sampling requirements:
- Build list from caller chunk’s `codeRelations.callDetails`, filtering:
  - `detail.targetChunkUid === calleeUid`
- Sort by:
  1) `detail.file` (if present, else caller chunk file)
  2) `detail.startLine`, `detail.startCol`, `detail.endLine`, `detail.endCol`
  3) `detail.calleeNormalized` then `detail.calleeRaw`
  4) `callSiteId` (as tie-breaker)
- Take first `N`.

**Important:** Sampling is used only for *flow evidence*, not for call graph completeness.

### 10.4.3 Tests for callsite helpers
Add:
- `tests/risk-interprocedural/callsite-id.test.js`
  - Ensure the shared helper matches the writer’s output on representative inputs.
- `tests/risk-interprocedural/callsite-sampling.test.js`
  - Given an array of mocked callDetails, assert deterministic ordering and stable sampling.

---

## 10.5 Interprocedural propagation → risk_flows

> Propagation enumerates bounded call paths from source signals to sink signals.

### 10.5.1 Define the *final* flow row schema (implement exactly)
**Artifact:** `risk_flows.jsonl` (sharded)

Row `RiskFlowRowV1`:
```ts
{
  schemaVersion: 1,
  flowId: string,  // "sha1:<hex>"

  source: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "source",
    category: string|null,
    severity: null,
    confidence: number|null
  },

  sink: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "sink",
    category: string|null,
    severity: string|null,
    confidence: number|null
  },

  path: {
    chunkUids: string[],             // length >= 2
    callSiteIdsByStep: string[][]    // length == chunkUids.length - 1
  },

  confidence: number,                // computed final confidence 0..1

  notes: {
    strictness: "conservative"|"argAware",
    sanitizerPolicy: "terminate"|"weaken",
    hopCount: number,
    sanitizerBarriersHit: number,
    capsHit: string[]                // e.g., ["maxDepth","maxPathsPerPair"]
  }
}
```

### 10.5.2 Implement propagation engine
**New file:** `src/index/risk-interprocedural/engine.js`

Export:
- `computeInterproceduralRisk({ chunks, summariesByChunkUid, runtime, log })`

Return:
```ts
{
  status: "ok" | "timed_out" | "disabled",
  summaryRows: RiskSummaryRowV1[],
  flowRows: RiskFlowRowV1[],
  stats: RiskInterproceduralStatsV1,
  // for referential checks / writers
  callSiteIdsReferenced: Set<string>
}
```

### 10.5.3 Graph inputs and how to build them (no searching required)
Inputs come from the existing indexing pipeline:

- `chunk.codeRelations.callDetails[]`
  - produced by language relations collectors (e.g., `src/lang/javascript/relations.js`)
  - enriched by cross-file inference (`applyCrossFileInference`) with `detail.targetChunkUid`

- `chunk.docmeta.risk.*`
  - produced by `src/index/risk.js`

The engine must **not** require reading artifacts from disk; it runs during build.

### 10.5.4 Deterministic traversal algorithm (BFS)
Implement BFS rooted at each `(sourceChunkUid, sourceRuleId)`:

**Root ordering:**
- Sort roots by:
  1) `sourceChunkUid`
  2) `sourceRuleId`

**Queue item (“state”) shape:**
```ts
{
  chunkUid: string,
  rootSource: { chunkUid: string, ruleId: string },
  pathChunkUids: string[],             // from root to current
  callSiteIdsByStep: string[][],       // parallel to edges in path
  depth: number,                       // edges traversed so far
  sanitizerBarriersHit: number,
  taintSetKey: string|null             // only used for argAware
}
```

**Visited key (per spec; include depth):**
- `visitedKey = `${rootSource.chunkUid}|${rootSource.ruleId}|${chunkUid}|${taintSetKey||""}|${depth}``

This is more permissive than typical BFS; it matches the intended “allow revisiting at deeper depth” behavior.

**Expansion order:**
- When expanding a node:
  1) Get outgoing resolved callees from callDetails (or callLinks) and sort `calleeUid` lexicographically.
  2) For each callee, sample callSiteIds for the edge deterministically (10.4.2).
  3) Enqueue callee states in that sorted order.

### 10.5.5 Traversal strictness modes
#### conservative
- Treat every resolved edge as traversable.
- No taint tracking required.
- `taintSetKey = null` for visited key.

#### argAware
An edge (caller→callee) is traversable only if at least one call-site argument is tainted.

**Taint sources (caller side):**
- `callerSummary.taintHints.taintedIdentifiers` (if present)
- Regex match against source rule patterns:
  - Use compiled regexes for *source rules* from runtime’s risk rules (`runtime.riskConfig`)
  - Match per-argument string with identifier boundary rules:
    - `argText` is the string from `callDetails.args[]`
    - Consider an argument tainted if:
      - It contains any tainted identifier as a whole token, OR
      - It matches a source rule regex pattern

**Mapping taint into callee:**
- Determine callee param names:
  - Prefer `callLinks.paramNames` for that callee edge if available
  - Else prefer callee chunk’s `docmeta.paramNames` (from 10.2)
  - Else: no mapping possible; treat traversal as conservative for that edge *only if* a tainted arg exists (still require tainted arg)
- If argument index `i` is tainted and `paramNames[i]` exists:
  - add `paramNames[i]` to callee taint set
- Always union in callee’s own `taintHints.taintedIdentifiers` (if present).

**Canonical taintSetKey:**
- Sort tainted identifiers, cap to 16, join with `,`
- Use this for visited key and determinism.

### 10.5.6 Sanitizer policy
A “barrier chunk” is any chunk that has `signals.sanitizers.length > 0` in its summary.

- `terminate`:
  - You may still emit flows that *end at this chunk* (if it contains sinks).
  - Do not expand outgoing edges from this chunk.
- `weaken`:
  - Continue expansion.
  - Increment `sanitizerBarriersHit` counter for notes and confidence penalty.

### 10.5.7 Flow emission rules
While BFS is running:
- When visiting a chunk that has sinks (`signals.sinks.length > 0`):
  - For each sink signal (sorted by severity desc then ruleId):
    - Emit a flow row from root source → this sink **unless**:
      - `sinkChunkUid === sourceChunkUid` (no intra-chunk flows)
      - caps would be exceeded

**Per-(source,sink) path cap:**
- Maintain counter keyed by:
  - `${sourceChunkUid}|${sourceRuleId}|${sinkChunkUid}|${sinkRuleId}`
- Do not emit more than `maxPathsPerPair`.

### 10.5.8 Caps + timeout behavior (must be explicit)
Apply caps in this order (deterministic and reflected in stats):

1. **Timeout** (`maxMs`):
   - Start timer before any propagation.
   - If exceeded:
     - set status=`timed_out`
     - emit **zero** flow rows
     - still emit summaries (already built)
2. **maxEdgeExpansions**:
   - increment on each edge expansion attempt
   - if exceeded: stop traversal and set `capsHit += ["maxEdgeExpansions"]`
3. **maxDepth**:
   - do not expand states with `depth >= maxDepth`
4. **maxPathsPerPair**:
   - per key cap described above
5. **maxTotalFlows**:
   - stop emitting once reached; set `capsHit += ["maxTotalFlows"]`

### 10.5.9 Confidence scoring (implement exactly)
For each emitted flow:
- `C_source = sourceSignal.confidence ?? 0.5`
- `C_sink = sinkSignal.confidence ?? 0.5`
- `base = 0.1 + 0.9 * C_source * C_sink`
- `hopCount = chunkUids.length - 1`
- `hopDecay = 0.85 ** Math.max(0, hopCount - 1)`
- `sanitizerPenalty = sanitizerPolicy==="weaken" ? (0.5 ** sanitizerBarriersHit) : 1.0`
- `final = clamp(base * hopDecay * sanitizerPenalty, 0, 1)`

### 10.5.10 Per-row size cap enforcement (required)
**Hard limit:** `<= 32 KiB` per JSONL row.

Deterministic trimming for flows:
1. Reduce each `callSiteIdsByStep[i]` to at most 1 id.
2. If still too large, replace `callSiteIdsByStep` with empty arrays (correct length).
3. If still too large, drop the row and record in stats.

### 10.5.11 Tests for propagation
Add fixtures + tests:

- `tests/fixtures/risk-interprocedural/js-simple/`
  - `index.js` contains:
    - `function handle(req){ const cmd=req.body; return run(build(cmd)); }`
    - `function build(x){ return x; }`
    - `function run(cmd){ eval(cmd); }`
  - Ensure:
    - source rule `source.req.body` fires in `handle`
    - sink rule `sink.eval` fires in `run`
    - call chain resolved: handle→build→run

- `tests/risk-interprocedural/flows-conservative.test.js`
  - enable riskInterprocedural (conservative)
  - assert at least 1 flow:
    - `path.chunkUids.length === 3`
    - `callSiteIdsByStep.length === 2`
    - `notes.hopCount === 2`
    - `sink.ruleId === "sink.eval"` (or the actual rule id)
- `tests/risk-interprocedural/flows-argaware-negative.test.js`
  - modify fixture so tainted value is NOT passed (e.g., `build("constant")`)
  - argAware should emit 0 flows
- `tests/risk-interprocedural/flows-sanitizer-policy.test.js`
  - add sanitizer call in middle function (`escape(cmd)`)
  - terminate: no flows beyond sanitizer
  - weaken: flow exists but confidence reduced and `sanitizerBarriersHit>0`
- `tests/risk-interprocedural/flows-timeout.test.js`
  - set `maxMs=1` and create a fixture with branching call graph
  - expect status `timed_out` and `risk_flows` empty

---

## 10.6 Artifact writing + contracts + manifest integration

### 10.6.1 Add contracts for new artifacts
**File:** `src/contracts/schemas/artifacts.js`

Add schemas for:
- `risk_summaries` (jsonl)
- `risk_flows` (jsonl)
- `risk_interprocedural_stats` (json)

Also add meta schemas:
- `risk_summaries_meta` (shard meta)
- `risk_flows_meta`

Update:
- `src/contracts/registry.js` (schema registry + schema hash)

### 10.6.2 Add JSONL required keys
**File:** `src/shared/artifact-io/jsonl.js`

Extend `JSONL_REQUIRED_KEYS` with:
- `risk_summaries`: `["schemaVersion","chunkUid","file","signals"]`
- `risk_flows`: `["schemaVersion","flowId","source","sink","path","confidence","notes"]`

(Keep required keys minimal but sufficient.)

### 10.6.3 Add compression defaults for risk JSONL
**File:** `src/index/build/artifacts/compression.js`

Add `risk_summaries` and `risk_flows` to `COMPRESSIBLE_ARTIFACTS`.

### 10.6.4 Implement artifact writers
**New file:** `src/index/build/artifacts/writers/risk-interprocedural.js`

Exports:
- `enqueueRiskInterproceduralArtifacts({ state, runtime, mode, outputDir, manifest, log })`

Responsibilities:
1. If `mode !== "code"`: do nothing.
2. If `!runtime.riskInterproceduralEnabled`: do nothing.
3. Ensure summaries + flows are computed once and stored on state:
   - `state.riskInterprocedural = { summaryRows, flowRows, stats, callSiteIdsReferenced }`
4. Write:
   - always write `risk_interprocedural_stats.json` when enabled
   - write `risk_summaries` jsonl only if `emitArtifacts==="jsonl"`
   - write `risk_flows` jsonl only if `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`

**Where to compute:**  
Compute in the indexing pipeline **after** cross-file inference and **before** metaV2 finalization, so compact summaries land in chunk meta.

Recommended location:
- In `src/index/build/indexer/pipeline.js` after `runCrossFileInference(...)` and before postings/writing, OR
- In `src/index/build/indexer/steps/write.js` immediately before `finalizeMetaV2(...)`

Pick one and document it; do not compute twice.

### 10.6.5 Ensure chunk meta includes compact risk summary
No special code is needed if you attach `chunk.docmeta.risk.summary`, because:
- `src/index/metadata-v2.js` already includes `risk: docmeta?.risk`

But ensure the compact summary is small enough that `chunk-meta` writer does not drop docmeta for size reasons.

### 10.6.6 Add artifacts to piece assembly
**File:** `src/index/build/piece-assembly.js`

Add optional loading for:
- `risk_summaries`
- `risk_flows`
- `risk_interprocedural_stats`

This makes downstream tooling (sqlite build, etc.) able to access these artifacts uniformly.

### 10.6.7 Tests for artifact writing
Add:
- `tests/risk-interprocedural/artifacts-written.test.js`
  - Build fixture index with `emitArtifacts="jsonl"`
  - Assert files exist:
    - `risk_summaries.jsonl` or sharded variants (+ `.meta.json`)
    - `risk_flows.jsonl` or sharded variants (+ `.meta.json`)
    - `risk_interprocedural_stats.json`
  - Assert shard meta points to shard files.

---

## 10.7 Validation + referential integrity

### 10.7.1 Extend validator to load + schema-validate new artifacts
Files:
- `src/index/validate.js`
- `src/index/validate/artifacts.js`
- `src/index/validate/presence.js`

Tasks:
1. Add `risk_summaries`, `risk_flows`, `risk_interprocedural_stats` to optional artifact list.
2. If present:
   - schema-validate each using contracts
3. Add clear validation errors (include artifact name, failing row index if jsonl).

### 10.7.2 Cross-artifact referential checks (must add)
Add new validator module:
- `src/index/validate/risk-interprocedural.js`

Checks:
- For each summary row:
  - `chunkUid` exists in `chunk_meta`
  - `file` matches `chunk_meta.file` (if present)
- For each flow row:
  - `path.chunkUids.length >= 2`
  - `path.chunkUids[0] === source.chunkUid`
  - `path.chunkUids[last] === sink.chunkUid`
  - `path.callSiteIdsByStep.length === path.chunkUids.length - 1`
  - Every `chunkUid` in path exists in `chunk_meta`
  - Every `callSiteId` referenced exists in `call_sites` **if** `call_sites` is present
    - (Note: call_sites is optional; if absent, validation should warn, not fail, unless strict mode demands it.)
- For stats JSON:
  - `effectiveConfig` fields are consistent with normalization
  - If `status==="timed_out"`: flows count is 0
  - If `emitArtifacts==="jsonl"` and `summaryOnly===false` and `status==="ok"`:
    - `risk_flows` artifact must exist

### 10.7.3 Tests for validator checks
Add:
- `tests/validator/risk-interprocedural.test.js`
  - Build fixture index with riskInterprocedural on
  - Run validator, expect pass
  - Corrupt one `callSiteId` in a flow row, expect validator fail with specific message

---

## 10.8 CLI: explain interprocedural risk flows

### 10.8.1 Add new command wiring
**File:** `bin/pairofcleats.js`

Add command:
- `risk explain`

Map to new tool:
- `tools/explain-risk.js`

### 10.8.2 Implement explain tool
**New file:** `tools/explain-risk.js`

Requirements:
- Inputs:
  - `--index <dir>` (required)
  - `--chunk <chunkUid>` (required)
  - `--max <n>` (default 20)
  - optional filters:
    - `--source-rule <ruleId>`
    - `--sink-rule <ruleId>`
    - `--json`
- Loads artifacts from `indexDir`:
  - `chunk_meta`
  - `risk_summaries` (optional)
  - `risk_flows` (optional)
  - `call_sites` (optional; used to print call site context)
  - `risk_interprocedural_stats` (optional)
- Output (human mode):
  1. Print chunk identification (file, symbol name, kind)
  2. Print compact risk summary if present
  3. Print flows where chunk is:
     - source chunk, or sink chunk, or appears in path
     - ordered by descending `confidence`, then `flowId`
  4. For each flow:
     - print path as `file::symbol` chain
     - print sampled call sites per step by looking up `callSiteId` in `call_sites` (if present)
- JSON mode: emit structured JSON with same data.

### 10.8.3 Tests for CLI
Add:
- `tests/cli/risk-explain.test.js`
  - Build fixture index
  - Run `node bin/pairofcleats.js risk explain --index <dir> --chunk <uid>`
  - Assert output contains flowId and the expected file names

---

## 10.9 Cross-cutting robustness improvements (recommended)

### 10.9.1 Call graph edge union (prevents partial call_sites from hiding callLinks)
**File:** `src/index/build/graphs.js`

Current behavior:
- If there is at least one callSiteEdge, it uses callSiteEdges and does NOT fall back to callLinks for missing edges.

Improve:
- Always union edges from:
  - `callSites` (when present)
  - `callLinks` (when present)
This prevents future regressions if call_sites is sampled or filtered.

### 10.9.2 Performance audit checklist
Before marking Phase 10 complete, verify:
- Summaries build is O(#risk signals) and bounded by caps
- Propagation stops on:
  - timeout
  - maxEdgeExpansions
  - maxDepth
  - maxTotalFlows
- Memory usage:
  - avoid building a global all-edges map if not needed; build per chunk on-demand
- Determinism:
  - output stable across runs given same codebase and config

---

## Phase 10 completion checklist (must be true)
- [ ] Docs are merged; canonical specs in `docs/specs/` match code contracts (especially `call_sites`).
- [ ] Deprecated/replaced spec docs have been moved to `docs/archived/` and the process is documented in `AGENTS.md` (see 10.0.3).
- [ ] `indexing.riskInterprocedural` survives config load and is normalized deterministically.
- [ ] Cross-file inference runs when riskInterprocedural is enabled.
- [ ] `docmeta.risk.summary` is present, compact, and deterministic.
- [ ] `risk_summaries` artifact rows are schema-valid, capped, and <=32KiB each.
- [ ] `risk_flows` artifact rows are deterministic, capped, and <=32KiB each.
- [ ] Every callSiteId referenced by flows is resolvable in `call_sites` when present.
- [ ] `risk_interprocedural_stats.json` is always written when enabled and accurately reflects status/caps.
- [ ] Validator enforces schema + referential integrity for the new artifacts.
- [ ] `pairofcleats risk explain` works and is covered by tests.

---

### Doc merge checklist (explicit, per original roadmap requirement)
- [ ] `docs/specs/risk-interprocedural-config.md` ← merge `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md`
- [ ] `docs/specs/risk-summaries.md` ← merge `docs/new_docs/spec_risk-summaries_IMPROVED.md`
- [ ] `docs/specs/risk-flows-and-call-sites.md` ← merge `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md`
- [ ] `docs/specs/risk-callsite-id-and-stats.md` ← reconcile with code + update/annotate `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md`
- [ ] `docs/specs/risk-interprocedural-stats.md` ← expand from placeholder using merged stats schema
- [ ] `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` ← either promote to `docs/specs/` or merge key content into the canonical specs

---

## 10.A Risk Interprocedural Config Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-interprocedural-config.md`  
**Validator/contract authority:** `docs/config/schema.json` + runtime normalization in `tools/dict-utils/config.js`

### Required config keys (must exist; exact spelling)
- `indexing.riskInterprocedural.enabled` — boolean (default: `false`)
- `indexing.riskInterprocedural.mode` — `"off" | "conservative" | "argAware"`
- `indexing.riskInterprocedural.callsiteSampling.enabled` — boolean
- `indexing.riskInterprocedural.callsiteSampling.perCalleeLimit` — integer
- `indexing.riskInterprocedural.callsiteSampling.totalLimit` — integer
- `indexing.riskInterprocedural.callsiteSampling.seed` — string
- `indexing.riskInterprocedural.limits.maxDepth` — integer
- `indexing.riskInterprocedural.limits.maxPathsPerRisk` — integer
- `indexing.riskInterprocedural.limits.maxTotalPaths` — integer
- `indexing.riskInterprocedural.limits.maxFanOutPerCallsite` — integer
- `indexing.riskInterprocedural.timeouts.propagationMs` — integer
- `indexing.riskInterprocedural.emitArtifacts` — boolean (default: `false`)

**Touchpoints**
- `tools/dict-utils/config.js` (~L1–L310) — add/validate keys; normalize defaults.
- `docs/config/schema.json` (~L1–L264) — ensure schema accepts these keys.
- `src/index/build/runtime/runtime.js` (~L1–L683) — pass normalized config into runtime.

**Minimum test coverage**
- Add/keep `tests/risk-interprocedural/config-normalization.test.js` (lane: integration unless placed under `tests/unit/`).
- Verify `enabled=false` short-circuits all extra work (no new artifacts).

---

## 10.B `risk_summaries.jsonl` Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-summaries.md`  
**Contract authority (must match):** `src/contracts/schemas/artifacts.js`

### Minimum record schema (must be stable)
- `riskId: string` (deterministic; stable across runs)
- `kind: string` (risk kind/category)
- `title: string`
- `severity: "low" | "medium" | "high" | "critical"` (or project-defined enum — pick one and enforce)
- `primaryLocation: { virtualPath, startLine, startCol, endLine, endCol }`
- `evidence: Array<{ virtualPath, startLine, startCol, endLine, endCol, excerpt?: string }>`
- `sinks: Array<{ symbol: SymbolRefV1, chunkUid?: string|null }>`
- `sources: Array<{ symbol: SymbolRefV1, chunkUid?: string|null }>`
- `counts: { sinks: number, sources: number, flows: number }`
- `truncated: { evidence?: boolean, sinks?: boolean, sources?: boolean, flows?: boolean }`

**Touchpoints**
- `src/index/risk.js` (~L1–L404) — risk extraction output.
- `src/index/metadata-v2.js` (~L1–L301) — where compact docmeta may surface summary signals.
- `src/index/validate.js` (~L1–L581) — schema enforcement for artifact output.

**Minimum test coverage**
- Schema validation test: `tests/risk-interprocedural/summaries-schema.test.js`
- Determinism test: `tests/risk-interprocedural/summaries-determinism.test.js`
- Truncation/caps test: `tests/risk-interprocedural/summaries-truncation.test.js`

---

## 10.C `risk_flows.jsonl` + `call_sites.jsonl` Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-flows-and-call-sites.md`  
**Call-sites contract authority:** `src/contracts/schemas/artifacts.js` (`call_sites` already exists)

### `call_sites` (existing artifact; do not break)
- Must remain a superset-friendly artifact: interprocedural flow logic should consume a **subset**.

**Touchpoints**
- `src/index/build/artifacts/writers/call-sites.js` (~L1–L276) — `buildCallSiteId` is canonical algorithm.
- `src/contracts/schemas/artifacts.js` (~L1–L677) — contract schema for `call_sites`.

### `risk_flows` (new artifact)
Must include:
- `flowId` (deterministic)
- `riskId`
- `source: { symbol: SymbolRefV1, chunkUid?: string|null }`
- `sink: { symbol: SymbolRefV1, chunkUid?: string|null }`
- `path: Array<{ callSiteId: string, callee: SymbolRefV1, calleeChunkUid?: string|null }>`
- `mode: "conservative" | "argAware"`
- `confidence: "high" | "medium" | "low"`
- `notes?: string[]`
- `truncated?: boolean`

**Minimum test coverage**
- Conservative mode: `tests/risk-interprocedural/flows-conservative.test.js`
- Arg-aware negative test: `tests/risk-interprocedural/flows-argaware-negative.test.js`
- Sanitizer policy: `tests/risk-interprocedural/flows-sanitizer-policy.test.js`
- Timeout behavior: `tests/risk-interprocedural/flows-timeout.test.js`

---

## 10.D Risk Interprocedural Stats Spec (canonical)

**Canonical spec file (post-merge):** `docs/specs/risk-interprocedural-stats.md`  
Clarify counts vs artifacts (especially because `call_sites` is a general artifact).

### Required counters (explicit semantics)
- `flowsEmitted`: number of risk flow records written
- `risksWithFlows`: count of riskIds that emitted ≥1 flow
- `uniqueCallSitesReferenced`: count of unique callSiteIds referenced by emitted `risk_flows`
- `callSiteSampling`: { `enabled`, `perCalleeLimit`, `totalLimit`, `seed` }
- `mode`: propagation mode
- `timingMs`: { `total`, `propagation`, `io` }
- `capsHit`: record which caps were hit (depth, fanout, paths, timeout)

**Minimum test coverage**
- Stats correctness test (small fixture): add/keep `tests/risk-interprocedural/callsite-sampling.test.js`
- Validator test: `tests/validator/risk-interprocedural.test.js`

---

## 10.E Implementation notes (non-normative)

These are constraints to keep implementations coherent:

- **Determinism:** All emitted artifacts must be stable under re-run; enforce deterministic sorting at every aggregation boundary.
- **No hidden global state:** Cache keys must include buildRoot/buildId where applicable.
- **Runtime gating:** When `riskInterprocedural.enabled=false`, do not emit new artifacts, and do not pay traversal costs.
- **Back-compat:** Never break existing `call_sites` readers; new fields must be additive.
- **Archival policy:** Deprecated spec docs move to `docs/archived/` and are documented in `AGENTS.md` (see 10.0.3).

# Appendices — touchpoint mappings (with line ranges) + test lane hints

These appendices are generated to remove scavenger-hunts:
- Every file path referenced in a phase body appears here.
- Existing files include **approximate** line ranges.
- Planned files/dirs are labeled **NEW**.

## Appendix P0 — Root-level touchpoints referenced by this roadmap

- `AGENTS.md` (~L1–L63) — agent workflow; must include the spec archival policy.
- `COMPLETED_PHASES.md` (~L1–L12) — record of completed roadmap phases.
- `GIGAROADMAP.md` (~L1–L4692) — prerequisite plan; this roadmap assumes it is complete.
- `package.json` (~L1–L278) — test lane scripts (`test:unit`, `test:services`, etc).

## Appendix P7 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/contracts/` (DIR; exists)
- `src/contracts/` (DIR; exists)
- `tests/fixtures/sample/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1–L10) — exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/file-processor/embeddings.js` (~L1–L260)
- `src/index/build/indexer/embedding-queue.js` (~L1–L49) — exports/anchors: `enqueueEmbeddingJob`
- `src/index/build/indexer/pipeline.js` (~L1–L326)
- `src/index/build/indexer/steps/write.js` (~L1–L101) — exports/anchors: `writeIndexArtifactsForMode`
- `src/index/embedding.js` (~L1–L56) — exports/anchors: `quantizeVec`, `quantizeVecUint8`, `normalizeVec`, `createEmbedder`
- `src/index/validate.js` (~L1–L581)
- `src/retrieval/ann/providers/hnsw.js` (~L1–L27) — exports/anchors: `createHnswAnnProvider`
- `src/retrieval/ann/providers/lancedb.js` (~L1–L39) — exports/anchors: `createLanceDbAnnProvider`
- `src/retrieval/cli-index.js` (~L1–L416) — exports/anchors: `resolveIndexDir`, `requireIndexDir`, `buildQueryCacheKey`, `getIndexSignature`
- `src/retrieval/cli/load-indexes.js` (~L1–L368)
- `src/retrieval/cli/normalize-options.js` (~L1–L273) — exports/anchors: `normalizeSearchOptions`
- `src/retrieval/cli/options.js` (~L1–L141) — exports/anchors: `getMissingFlagMessages`, `estimateIndexBytes`, `resolveIndexedFileCount`, `resolveBm25Defaults`, `loadBranchFromMetrics`
- `src/retrieval/cli/query-plan.js` (~L1–L205) — exports/anchors: `buildQueryPlan`
- `src/retrieval/lancedb.js` (~L1–L180)
- `src/retrieval/query-intent.js` (~L1–L84) — exports/anchors: `classifyQuery`, `resolveIntentVectorMode`, `resolveIntentFieldWeights`
- `src/retrieval/rankers.js` (~L1–L292) — exports/anchors: `rankBM25Legacy`, `getTokenIndex`, `rankBM25`, `rankBM25Fields`, `rankMinhash`
- `src/retrieval/sqlite-helpers.js` (~L1–L544) — exports/anchors: `createSqliteHelpers`
- `src/shared/artifact-io.js` (~L1–L12)
- `src/shared/artifact-io/manifest.js` (~L1–L291) — exports/anchors: `resolveManifestPath`, `loadPiecesManifest`, `readCompatibilityKey`, `normalizeMetaParts`, `resolveMetaFormat`
- `src/shared/embedding-adapter.js` (~L1–L158) — exports/anchors: `getEmbeddingAdapter`
- `src/shared/embedding-utils.js` (~L1–L176) — exports/anchors: `DEFAULT_EMBEDDING_POOLING`, `DEFAULT_EMBEDDING_NORMALIZE`, `DEFAULT_EMBEDDING_TRUNCATION`, `isVectorLike`, `mergeEmbeddingVectors`
- `src/shared/hnsw.js` (~L1–L160) — exports/anchors: `normalizeHnswConfig`, `resolveHnswPaths`, `loadHnswIndex`, `rankHnswIndex`
- `src/shared/lancedb.js` (~L1–L65) — exports/anchors: `normalizeLanceDbConfig`, `resolveLanceDbPaths`, `resolveLanceDbTarget`
- `src/storage/lmdb/schema.js` (~L1–L49) — exports/anchors: `LMDB_SCHEMA_VERSION`, `LMDB_META_KEYS`, `LMDB_ARTIFACT_KEYS`, `LMDB_ARTIFACT_LIST`, `LMDB_REQUIRED_ARTIFACT_KEYS`
- `src/storage/sqlite/build/incremental-update.js` (~L1–L567)
- `src/storage/sqlite/vector.js` (~L1–L71) — exports/anchors: `quantizeVec`, `resolveQuantizationParams`, `dequantizeUint8ToFloat32`, `toSqliteRowId`, `packUint32`

### Existing tools/ files referenced (edit candidates)
- `tools/build-embeddings.js` (~L1–L12)
- `tools/build-embeddings/cache.js` (~L1–L26) — exports/anchors: `buildCacheIdentity`, `resolveCacheRoot`, `resolveCacheDir`, `buildCacheKey`, `isCacheValid`
- `tools/build-embeddings/cli.js` (~L1–L95) — exports/anchors: `parseBuildEmbeddingsArgs`
- `tools/build-embeddings/embed.js` (~L1–L119) — exports/anchors: `assertVectorArrays`, `runBatched`, `ensureVectorArrays`, `createDimsValidator`, `isDimsMismatch`
- `tools/build-embeddings/hnsw.js` (~L1–L115) — exports/anchors: `createHnswBuilder`
- `tools/build-embeddings/lancedb.js` (~L1–L143)
- `tools/build-embeddings/manifest.js` (~L1–L111) — exports/anchors: `updatePieceManifest`
- `tools/build-embeddings/runner.js` (~L1–L763)
- `tools/build-embeddings/sqlite-dense.js` (~L1–L209) — exports/anchors: `updateSqliteDense`
- `tools/build-lmdb-index.js` (~L1–L311)
- `tools/dict-utils/paths/db.js` (~L1–L62) — exports/anchors: `resolveLmdbPaths`, `resolveSqlitePaths`
- `tools/index-validate.js` (~L1–L130)
- `tools/indexer-service.js` (~L1–L441)
- `tools/service/queue.js` (~L1–L270) — exports/anchors: `resolveQueueName`, `getQueuePaths`
- `tools/vector-extension.js` (~L1–L393) — exports/anchors: `getBinarySuffix`, `getPlatformKey`, `getVectorExtensionConfig`, `resolveVectorExtensionPath`, `loadVectorExtension`

### Existing docs/ files referenced (edit candidates)
- `docs/contracts/artifact-schemas.md` (~L1–L67)
- `docs/contracts/public-artifact-surface.md` (~L1–L104)
- `docs/guides/embeddings.md` (~L1–L92)
- `docs/guides/search.md` (~L1–L74)

### Existing tests/ files referenced (edit candidates)
- `tests/artifact-io-manifest-discovery.test.js` (~L1–L60) — lane: `integration`; run: `npm run test:integration -- --match artifact-io-manifest-discovery.test`
- `tests/embedding-queue-defaults.js` (~L1–L37) — lane: `integration`; run: `npm run test:integration -- --match embedding-queue-defaults`
- `tests/embedding-queue.js` (~L1–L51) — lane: `integration`; run: `npm run test:integration -- --match embedding-queue`
- `tests/embeddings-validate.js` (~L1–L82) — lane: `integration`; run: `npm run test:integration -- --match embeddings-validate`
- `tests/hnsw-ann.js` (~L1–L124) — lane: `integration`; run: `npm run test:integration -- --match hnsw-ann`
- `tests/hnsw-atomic.js` (~L1–L90) — lane: `integration`; run: `npm run test:integration -- --match hnsw-atomic`
- `tests/hnsw-candidate-set.js` (~L1–L78) — lane: `integration`; run: `npm run test:integration -- --match hnsw-candidate-set`
- `tests/lancedb-ann.js` (~L1–L100) — lane: `integration`; run: `npm run test:integration -- --match lancedb-ann`
- `tests/lmdb-backend.js` (~L1–L122) — lane: `integration`; run: `npm run test:integration -- --match lmdb-backend`
- `tests/lmdb-corruption.js` (~L1–L105) — lane: `integration`; run: `npm run test:integration -- --match lmdb-corruption`
- `tests/lmdb-report-artifacts.js` (~L1–L125) — lane: `integration`; run: `npm run test:integration -- --match lmdb-report-artifacts`

### Planned/new paths referenced in this phase (create as needed)
- **tests/**
  - `tests/ann-parity.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity`
  - `tests/embedding-normalization-consistency.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-normalization-consistency`
  - `tests/embedding-quantization-no-wrap.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match embedding-quantization-no-wrap`
  - `tests/fixtures/embeddings` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/basic-repo` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/missing-vectors` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/embeddings/quantization-caps` (NEW fixture/dir — create as part of this phase)
  - `tests/hnsw-target-selection.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match hnsw-target-selection`
  - `tests/indexer-service-embedding-job-uses-build-root.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match indexer-service-embedding-job-uses-build-root`
  - `tests/integration/ann-parity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match ann-parity.test`
  - `tests/lancedb-candidate-filtering.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match lancedb-candidate-filtering`
  - `tests/manifest-embeddings-pieces.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match manifest-embeddings-pieces`
  - `tests/quantize-embedding-utils.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match quantize-embedding-utils`
  - `tests/retrieval-strict-manifest-embeddings.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match retrieval-strict-manifest-embeddings`
  - `tests/storage/embeddings-backend-resilience.test.js` (NEW) — intended lane: `storage`; run (once created): `npm run test:storage -- --match embeddings-backend-resilience.test`
  - `tests/unit/ann-backend-selection.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match ann-backend-selection.test`
  - `tests/unit/cache-preflight-meta.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match cache-preflight-meta.test`
  - `tests/unit/dense-vector-mode.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match dense-vector-mode.test`
  - `tests/unit/hnsw-insert-failures.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-insert-failures.test`
  - `tests/unit/hnsw-load-signature.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match hnsw-load-signature.test`
  - `tests/unit/lancedb-candidate-filtering.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-candidate-filtering.test`
  - `tests/unit/lancedb-connection-cache.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-connection-cache.test`
  - `tests/unit/lancedb-filter-pushdown.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lancedb-filter-pushdown.test`
  - `tests/unit/lmdb-mapsize.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match lmdb-mapsize.test`
  - `tests/unit/sqlite-ann-mode-scope.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match sqlite-ann-mode-scope.test`


## Appendix P9 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `src/index/build/artifacts/writers/` (DIR; exists)
- `src/index/identity/` (DIR; exists)
- `src/index/tooling/` (DIR; exists)
- `tests/type-inference-crossfile/` (DIR; exists)
- `tools/bench/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts.js` (~L1–L528)
- `src/index/build/file-processor.js` (~L1–L529) — exports/anchors: `createFileProcessor`
- `src/index/build/file-processor/assemble.js` (~L1–L127) — exports/anchors: `buildChunkPayload`
- `src/index/build/file-processor/relations.js` (~L1–L71) — exports/anchors: `buildCallIndex`, `buildFileRelations`, `stripFileRelations`
- `src/index/build/graphs.js` (~L1–L267) — exports/anchors: `buildRelationGraphs`
- `src/index/chunk-id.js` (~L1–L21) — exports/anchors: `buildChunkId`, `resolveChunkId`
- `src/index/identity/chunk-uid.js` (~L1–L204) — exports/anchors: `PRE_CONTEXT_CHARS`, `POST_CONTEXT_CHARS`, `ESCALATION_CONTEXT_CHARS`, `MAX_COLLISION_PASSES`, `normalizeForUid`
- `src/index/metadata-v2.js` (~L1–L301) — exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/segments.js` (~L1–L190) — exports/anchors: `assignSegmentUids`, `discoverSegments`, `chunkSegments`
- `src/index/tooling/clangd-provider.js` (~L1–L187) — exports/anchors: `CLIKE_EXTS`, `createClangdProvider`
- `src/index/tooling/pyright-provider.js` (~L1–L127) — exports/anchors: `PYTHON_EXTS`, `createPyrightProvider`
- `src/index/tooling/sourcekit-provider.js` (~L1–L93) — exports/anchors: `SWIFT_EXTS`, `createSourcekitProvider`
- `src/index/tooling/typescript-provider.js` (~L1–L467) — exports/anchors: `createTypeScriptProvider`
- `src/index/type-inference-crossfile/pipeline.js` (~L1–L438)
- `src/index/type-inference-crossfile/symbols.js` (~L1–L30) — exports/anchors: `leafName`, `isTypeDeclaration`, `addSymbol`, `resolveUniqueSymbol`
- `src/index/validate.js` (~L1–L581)
- `src/lang/javascript/relations.js` (~L1–L687) — exports/anchors: `buildCodeRelations`
- `src/map/build-map.js` (~L1–L288) — exports/anchors: `buildNodeList`, `buildMapCacheKey`
- `src/map/build-map/edges.js` (~L1–L186) — exports/anchors: `buildEdgesFromGraph`, `buildEdgesFromCalls`, `buildEdgesFromUsage`, `buildEdgesFromCallSummaries`, `buildImportEdges`
- `src/map/build-map/filters.js` (~L1–L229) — exports/anchors: `resolveFocus`, `normalizeIncludeList`, `applyLimits`, `applyScopeFilter`, `applyCollapse`
- `src/map/build-map/symbols.js` (~L1–L95) — exports/anchors: `buildSymbolId`, `buildPortId`, `upsertMember`, `buildMemberIndex`, `resolveMemberByName`
- `src/map/isometric/client/map-data.js` (~L1–L47) — exports/anchors: `initMapData`
- `src/shared/artifact-io.js` (~L1–L12)
- `src/shared/artifact-io/jsonl.js` (~L1–L79) — exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/artifact-schemas.js` (~L1–L2)
- `src/shared/identity.js` (~L1–L104) — exports/anchors: `buildChunkRef`, `isSemanticSymbolId`, `resolveSymbolJoinKey`, `resolveChunkJoinKey`, `buildSymbolKey`

### Existing docs/ files referenced (edit candidates)
- `docs/phases/phase-9/identity-contracts.md` (~L1–L132)
- `docs/phases/phase-9/migration-and-backcompat.md` (~L1–L45)
- `docs/phases/phase-9/symbol-artifacts-and-pipeline.md` (~L1–L122)
- `docs/specs/identity-contract.md` (~L1–L313)

### Existing tests/ files referenced (edit candidates)
- `tests/graph-chunk-id.js` (~L1–L43) — lane: `integration`; run: `npm run test:integration -- --match graph-chunk-id`

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/symbol-edges.js` (NEW — create as part of this phase)
  - `src/index/build/artifacts/writers/symbol-occurrences.js` (NEW — create as part of this phase)
  - `src/index/build/artifacts/writers/symbols.js` (NEW — create as part of this phase)
  - `src/index/identity/kind-group.js` (NEW — create as part of this phase)
  - `src/index/identity/normalize.js` (NEW — create as part of this phase)
  - `src/index/identity/segment-uid.js` (NEW — create as part of this phase)
  - `src/index/identity/symbol.js` (NEW — create as part of this phase)
  - `src/index/identity/virtual-path.js` (NEW — create as part of this phase)
  - `src/index/type-inference-crossfile/resolve-relative-import.js` (NEW — create as part of this phase)
  - `src/index/type-inference-crossfile/resolver.js` (NEW — create as part of this phase)
- **tools/**
  - `tools/bench/symbol-resolution-bench.js` (NEW — create as part of this phase)
- **docs/**
  - `docs/specs/symbol-artifacts.md` (NEW doc/spec — create as part of this phase)
  - `docs/specs/symbol-identity-and-symbolref.md` (NEW doc/spec — create as part of this phase)
- **tests/**
  - `tests/artifacts/symbol-artifacts-smoke.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifacts-smoke.test`
  - `tests/benchmarks` (NEW fixture/dir — create as part of this phase)
  - `tests/crossfile/resolve-relative-import.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match resolve-relative-import.test`
  - `tests/crossfile/symbolref-resolution.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbolref-resolution.test`
  - `tests/determinism` (NEW fixture/dir — create as part of this phase)
  - `tests/determinism/symbol-artifact-order.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-order.test`
  - `tests/fixtures/graph/chunkuid-join` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/identity/chunkuid-collision` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/imports/relative-ambiguous` (NEW fixture/dir — create as part of this phase)
  - `tests/fixtures/symbols/ambiguous-defs` (NEW fixture/dir — create as part of this phase)
  - `tests/identity/chunk-uid-stability.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-stability.test`
  - `tests/identity/segment-uid-stability.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match segment-uid-stability.test`
  - `tests/identity/symbol-identity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-identity.test`
  - `tests/integration/chunkuid-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunkuid-determinism.test`
  - `tests/integration/file-name-collision-no-wrong-join.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match file-name-collision-no-wrong-join.test`
  - `tests/integration/graph-relations-v2-chunkuid.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match graph-relations-v2-chunkuid.test`
  - `tests/integration/import-resolver-relative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match import-resolver-relative.test`
  - `tests/integration/map-chunkuid-join.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match map-chunkuid-join.test`
  - `tests/integration/symbol-artifact-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-artifact-determinism.test`
  - `tests/map/map-build-symbol-identity.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match map-build-symbol-identity.test`
  - `tests/services/symbol-artifacts-emission.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-artifacts-emission.test`
  - `tests/services/symbol-edges-ambiguous.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-edges-ambiguous.test`
  - `tests/services/symbol-links-by-chunkuid.test.js` (NEW) — intended lane: `services`; run (once created): `npm run test:services -- --match symbol-links-by-chunkuid.test`
  - `tests/unit/chunk-uid-stability.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match chunk-uid-stability.test`
  - `tests/unit/identity-symbolkey-scopedid.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match identity-symbolkey-scopedid.test`
  - `tests/unit/segment-uid-stability.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match segment-uid-stability.test`
  - `tests/unit/symbolref-envelope.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match symbolref-envelope.test`
  - `tests/unit/tooling/clangd-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match clangd-provider-output-shape.test`
  - `tests/unit/tooling/pyright-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match pyright-provider-output-shape.test`
  - `tests/unit/tooling/sourcekit-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match sourcekit-provider-output-shape.test`
  - `tests/unit/tooling/typescript-provider-output-shape.test.js` (NEW) — intended lane: `unit`; run (once created): `npm run test:unit -- --match typescript-provider-output-shape.test`
  - `tests/validate/chunk-uid-required.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match chunk-uid-required.test`
  - `tests/validate/symbol-integrity-strict.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match symbol-integrity-strict.test`


## Appendix P10 — repo touchpoint map

> Line ranges are approximate. Prefer anchor strings (function/export names) over line numbers.

### Existing directories referenced
- `docs/new_docs/` (DIR; exists)
- `docs/specs/` (DIR; exists)
- `src/contracts/` (DIR; exists)

### Existing src/ files referenced (edit candidates)
- `src/contracts/registry.js` (~L1–L10) — exports/anchors: `ARTIFACT_SCHEMA_REGISTRY`, `ARTIFACT_SCHEMA_HASH`, `ARTIFACT_SCHEMA_NAMES`, `getArtifactSchema`
- `src/contracts/schemas/artifacts.js` (~L1–L677) — exports/anchors: `ARTIFACT_SCHEMA_DEFS`
- `src/index/build/artifacts/compression.js` (~L1–L46) — exports/anchors: `resolveCompressionConfig`
- `src/index/build/artifacts/writers/call-sites.js` (~L1–L276) — exports/anchors: `createCallSites`, `enqueueCallSitesArtifacts`
- `src/index/build/graphs.js` (~L1–L267) — exports/anchors: `buildRelationGraphs`
- `src/index/build/indexer/pipeline.js` (~L1–L326)
- `src/index/build/indexer/signatures.js` (~L1–L120) — exports/anchors: `SIGNATURE_VERSION`, `buildIncrementalSignatureSummary`, `buildIncrementalSignaturePayload`, `buildTokenizationKey`, `buildIncrementalSignature`
- `src/index/build/indexer/steps/relations.js` (~L1–L205) — exports/anchors: `resolveImportScanPlan`, `preScanImports`, `postScanImports`, `runCrossFileInference`
- `src/index/build/indexer/steps/write.js` (~L1–L101) — exports/anchors: `writeIndexArtifactsForMode`
- `src/index/build/piece-assembly.js` (~L1–L512)
- `src/index/build/runtime/runtime.js` (~L1–L683)
- `src/index/metadata-v2.js` (~L1–L301) — exports/anchors: `buildMetaV2`, `finalizeMetaV2`
- `src/index/risk.js` (~L1–L404) — exports/anchors: `normalizeRiskConfig`, `detectRiskSignals`
- `src/index/type-inference-crossfile/extract.js` (~L1–L84) — exports/anchors: `extractReturnTypes`, `extractParamTypes`, `extractReturnCalls`, `inferArgType`
- `src/index/validate.js` (~L1–L581)
- `src/index/validate/artifacts.js` (~L1–L38) — exports/anchors: `buildArtifactLists`
- `src/index/validate/presence.js` (~L1–L183) — exports/anchors: `createArtifactPresenceHelpers`
- `src/lang/javascript/relations.js` (~L1–L687) — exports/anchors: `buildCodeRelations`
- `src/shared/artifact-io/jsonl.js` (~L1–L79) — exports/anchors: `resolveJsonlRequiredKeys`, `parseJsonlLine`
- `src/shared/hash.js` (~L1–L74) — exports/anchors: `sha1`, `sha1File`, `setXxhashBackend`

### Existing tools/ files referenced (edit candidates)
- `tools/dict-utils/config.js` (~L1–L310) — exports/anchors: `loadUserConfig`, `getEffectiveConfigHash`, `getCacheRoot`, `getDictConfig`, `applyAdaptiveDictConfig`

### Existing docs/ files referenced (edit candidates)
- `docs/config/contract.md` (~L1–L70)
- `docs/config/schema.json` (~L1–L264)
- `docs/new_docs/interprocedural-state-and-pipeline_DRAFT.md` (~L1–L156)
- `docs/new_docs/risk-callsite-id-and-stats_IMPROVED.md` (~L1–L120)
- `docs/new_docs/spec_risk-flows-and-call-sites_RECONCILED.md` (~L1–L141)
- `docs/new_docs/spec_risk-interprocedural-config_IMPROVED.md` (~L1–L99)
- `docs/new_docs/spec_risk-summaries_IMPROVED.md` (~L1–L169)
- `docs/specs/risk-callsite-id-and-stats.md` (~L1–L162)
- `docs/specs/risk-flows-and-call-sites.md` (~L1–L341)
- `docs/specs/risk-interprocedural-config.md` (~L1–L171)
- `docs/specs/risk-interprocedural-stats.md` (~L1–L9)
- `docs/specs/risk-summaries.md` (~L1–L253)

### Existing bin/ files referenced (edit candidates)
- `bin/pairofcleats.js` (~L1–L279)

### Planned/new paths referenced in this phase (create as needed)
- **src/**
  - `src/index/build/artifacts/writers/risk-interprocedural.js` (NEW — create as part of this phase)
  - `src/index/callsite-id.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/config.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/edges.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/engine.js` (NEW — create as part of this phase)
  - `src/index/risk-interprocedural/summaries.js` (NEW — create as part of this phase)
  - `src/index/validate/risk-interprocedural.js` (NEW — create as part of this phase)
- **tools/**
  - `tools/explain-risk.js` (NEW — create as part of this phase)
- **docs/**
  - `docs/archived` (NEW — create as part of this phase)
  - `docs/archived/README.md` (NEW doc/spec — create as part of this phase)
  - `docs/archived/phase-10` (NEW — create as part of this phase)
  - `docs/archived/specs/phase-10` (NEW — create as part of this phase)
- **tests/**
  - `tests/cli/risk-explain.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-explain.test`
  - `tests/fixtures/risk-interprocedural/js-simple` (NEW fixture/dir — create as part of this phase)
  - `tests/lang/javascript-paramnames.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match javascript-paramnames.test`
  - `tests/risk-interprocedural/artifacts-written.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match artifacts-written.test`
  - `tests/risk-interprocedural/callsite-id.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-id.test`
  - `tests/risk-interprocedural/callsite-sampling.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match callsite-sampling.test`
  - `tests/risk-interprocedural/config-normalization.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match config-normalization.test`
  - `tests/risk-interprocedural/flows-argaware-negative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-argaware-negative.test`
  - `tests/risk-interprocedural/flows-conservative.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-conservative.test`
  - `tests/risk-interprocedural/flows-sanitizer-policy.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-sanitizer-policy.test`
  - `tests/risk-interprocedural/flows-timeout.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match flows-timeout.test`
  - `tests/risk-interprocedural/runtime-gating.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match runtime-gating.test`
  - `tests/risk-interprocedural/summaries-determinism.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-determinism.test`
  - `tests/risk-interprocedural/summaries-schema.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-schema.test`
  - `tests/risk-interprocedural/summaries-truncation.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match summaries-truncation.test`
  - `tests/unit` (NEW fixture/dir — create as part of this phase)
  - `tests/validator/risk-interprocedural.test.js` (NEW) — intended lane: `integration`; run (once created): `npm run test:integration -- --match risk-interprocedural.test`
