# Phase 10 (Interprocedural Risk Flows) — Refined Implementation Plan (PairOfCleats)

## 1) Purpose
Phase 10 extends PairOfCleats’ current **intra-chunk** risk detection to **interprocedural** (cross-function) risk paths by:

1. Producing a **per-symbol taint summary**.
2. Propagating taint through the **resolved call graph** to emit **explainable risk paths**.
3. Surfacing those results in existing artifacts and retrieval UX.

This plan refines and de-ambiguates the Phase 10 roadmap items while aligning them to the current PairOfCleats codebase.

## 2) Current-state facts in the codebase (why Phase 10 is needed)

### 2.1 Risk detection is local (intra-chunk)
* `src/index/risk.js` scans chunk text for rule matches and tracks simple variable assignment taint.
* It can emit `docmeta.risk.sources`, `docmeta.risk.sinks`, `docmeta.risk.sanitizers`, and local `docmeta.risk.flows`.
* It **does not** currently produce multi-hop call paths.

### 2.2 Cross-file inference already resolves call links (but loses call-site multiplicity)
* `src/index/type-inference-crossfile/pipeline.js` builds `chunk.codeRelations.callLinks` using `addLink(...)`, which **dedupes** by `(calleeName, targetName, targetFile)` and drops distinct call-sites.

### 2.3 metaV2 can drift
* `src/index/build/file-processor/assemble.js` builds `metaV2` early.
* `src/index/build/indexer/steps/relations.js` runs `applyCrossFileInference(...)` later, which mutates `chunk.docmeta` and `chunk.codeRelations`.
* Without a post-enrichment rebuild, `metaV2` can become stale.

## 3) Design principles (non-negotiable)

1. **Determinism**: same repo+config must produce identical risk artifacts (ordering, truncation, sampling).
2. **Bounded output**: every new artifact must have strict caps and per-record byte-size limits.
3. **Minimal coupling**: interprocedural risk flows must not “accidentally” enable type inference or tooling.
4. **Joinability**: all artifacts must share stable IDs to enable joins without heuristics.

## 4) Key decisions (resolve ambiguity)

### D1 — Canonical identity for symbols and edges
**Decision:** Use `chunkUid` as the canonical chunk/function identifier for interprocedural risk propagation and artifacts. If Phase 9 symbol identity is available, artifacts may additionally include `symbolId`, but `chunkUid` remains the primary join key.

*Why this is best:* `chunkUid` is designed to remain stable under common edits (e.g., line insertions above a chunk) because it is derived from segment identity + chunk content + small context windows, rather than absolute offsets. It avoids `(file,name)` collisions without relying on range-derived IDs.

**Edge id:** `edgeId = sha1("${callerChunkUid}→${calleeChunkUid}")` (stable, direction-aware). Store caller/callee `chunkUid` (and optional `symbolId`) alongside the edge.

### D2 — Storage strategy
**Decision:** Store *compact* summary fields inline on each chunk **and** emit full JSONL artifacts.

* Inline: `chunk.docmeta.risk.summary` and `chunk.metaV2.risk.summary` (compact + capped).
* Artifacts: `risk_summaries.jsonl`, `risk_flows.jsonl`, and `call_sites.jsonl`.

*Why this is best:* inline summary supports fast retrieval and ranking without reading large JSONL; JSONL supports validation, bulk analysis, and explainability.

### D3 — Call-site evidence strategy
**Decision:** Preserve multiple call-sites per edge in a **separate** `call_sites.jsonl` artifact and reference them by `callSiteId` from flows.

*Why this is best:* avoids `chunk_meta` bloat; keeps call-site samples bounded and reusable across multiple flows.

### D4 — Capping and time budgets
**Decision:** Do **not** allow time budgets to create partially-different outputs.

* Use structural caps (`maxDepth`, `maxPathsPerSourceSink`, `maxTotalFlows`, `maxCallSitesPerEdge`).
* If an optional `maxMs` guard is enabled and is exceeded:
  * abort propagation entirely and emit a single deterministic `analysisStatus: "timed_out"` record (no partial flows), or
  * record `analysisStatus: "timed_out"` and write **zero** `risk_flows` rows.

*Why this is best:* preserves strict determinism.

### D5 — Strictness modes
**Decision:** Implement strictness as:

* `conservative` (default): summary-level propagation; no arg->param taint mapping.
* `argAware` (opt-in): only enabled if parameter contracts exist; supports arg->param mapping.

*Why this is best:* incremental correctness; avoids claiming precision we can’t support.

## 5) Implementation plan (step-by-step)

### Step 1 — Add config surface + runtime flags
**Files:**
* `src/index/build/runtime/runtime.js`
* `src/index/build/indexer/pipeline.js` (feature metrics registration)

**Add:** `indexing.riskInterprocedural` object:

```js
indexing: {
  riskInterprocedural: {
    enabled: false,
    summaryOnly: false,
    strictness: 'conservative',
    emitArtifacts: 'jsonl',
    caps: {
      maxDepth: 4,
      maxPathsPerPair: 200,
      maxTotalFlows: 500,
      maxCallSitesPerEdge: 3,
      // maxMs optional; if set, must not affect partial output
      maxMs: null
    }
  }
}
```

**Gating:** enabling `riskInterprocedural.enabled` must force cross-file call linking to run even when `riskAnalysisCrossFile` is off.

Practical change: in `runCrossFileInference(...)`, define:

```js
const interprocEnabled = runtime.riskInterproceduralEnabled;
const crossFileEnabled = runtime.typeInferenceCrossFileEnabled ||
  runtime.riskAnalysisCrossFileEnabled ||
  interprocEnabled;
```

…but keep `enableTypeInference` and `enableRiskCorrelation` false unless explicitly enabled.

### Step 2 — Fix parameter/return contracts (prerequisite for summaries)
**Files:**
* `src/index/metadata-v2.js`
* `src/index/type-inference-crossfile/extract.js`
* `src/lang/javascript/docmeta.js`
* (recommended) `src/lang/javascript/chunks.js` or a new shared helper

**Goals:**
1. `docmeta.params` must be a stable positional contract.
2. return types must never surface as boolean `true/false`.
3. inferred type extraction must never emit `"[object Object]"`.

**Recommended approach (JS):**
* Derive signature params from AST in `buildJsChunks(...)` and attach to chunk meta (e.g., `meta.sigParams`).
* Merge that into `docmeta.params` when doc comments are missing.
* For destructured params: use `arg0`, `arg1`, … and store `bindings` separately.

**Return types:**
* Treat `docmeta.returnType` (string) as canonical.
* Treat `docmeta.returns` boolean as **documentation presence only** and ignore it for type/risk propagation.

### Step 3 — Implement RiskSummary builder
**New file:** `src/index/risk-flows/summaries.js`

**Input:** `chunks` (post file-processing, pre/post cross-file inference is fine)

**Output:**
* Inline: `chunk.docmeta.risk.summary` (compact)
* Full rows: `risk_summaries.jsonl`

**Algorithm (v1):**
* derive `sources[]`, `sinks[]`, `sanitizers[]` from `chunk.docmeta.risk.*`.
* derive `taintedParams[]` heuristically:
  * if `argAware`: treat params as potential taint carriers when they appear in sink evidence excerpts.
  * if `conservative`: do not assert param taint; only propagate from local sources.
* derive `returnsTainted`:
  * `true` if any local flow indicates source reaches a return pattern (if implemented), else `null`.

### Step 4 — Add call-site payload fields (JS + Python)
**Files:**
* `src/lang/javascript/relations.js`
* `src/lang/python/relations.js`

**Add fields to each `callDetails` entry:**
* `file`, `startLine`, `endLine`, `startCol`, `endCol`
* `calleeName`
* `argsSummary` (truncated)
* `snippetHash` (sha1 of normalized snippet)

**Important:** call-site extraction must be stable and deterministic.

### Step 5 — Preserve call-site samples per call edge
**File:** `src/index/type-inference-crossfile/pipeline.js`

**Change:** keep `callLinks` deduped (for graph size), but also build `callSitesByEdge`:

* Key: `callerChunkUid + calleeChunkUid`
* Value: bounded list of call-site records (dedupe by location)

Expose `callSitesByEdge` on each caller chunk:

```js
chunk.codeRelations.callSiteRefs = {
  "<calleeChunkUid>": ["<callSiteId>", ...]
};
```

…and store `call_sites.jsonl` rows globally.

### Step 6 — Implement propagation engine
**New file:** `src/index/risk-flows/propagate.js`

**Inputs:**
* `summariesByChunkUid`
* `callGraph` (from `chunk.codeRelations.callLinks` → resolved target chunkUid)
* `callSiteRefs` (optional)
* config caps + strictness

**Output:** `risk_flows.jsonl`

**Propagation algorithm:** deterministic bounded BFS that:
1. starts from each source-bearing chunkUid
2. traverses call graph up to `maxDepth`
3. stops path if sanitizer encountered (or reduces confidence, per spec)
4. records a flow when reaching a sink-bearing chunk

Store:
* `pathChunkUids[]`
* `edgeCallSiteIdsByStep[]` (optional)
* `confidence` with deterministic decay.

### Step 7 — Integrate into build pipeline
**File:** `src/index/build/indexer/steps/relations.js`

Insert after `applyCrossFileInference(...)` and before final write:

1. `buildRiskSummaries(...)`
2. if `!summaryOnly`: `propagateRiskFlows(...)`
3. rebuild `metaV2` for all chunks (finalization)

### Step 8 — Artifact writing + validation
**Files:**
* `src/index/build/artifacts.js`
* `src/index/build/artifacts/writers/*` (new)
* `src/shared/artifact-io.js`
* `src/index/validate.js`

Add writers:
* `risk-summaries.jsonl`
* `risk-flows.jsonl`
* `call-sites.jsonl`

Add validation:
* schema checks
* referential integrity: every `callSiteId` referenced by `risk_flows` must exist

### Step 9 — Retrieval/UX surfacing
**Files:**
* `src/retrieval/output/format.js`
* (as needed) retrieval index loaders

Add CLI/display options:
* show `risk.summary` at chunk level
* `--explain-risk <chunkUid>` prints top N flows ending/starting at chunk

## 6) Acceptance criteria

1. Deterministic: repeated runs produce identical JSONL (byte-for-byte) for same repo/config.
2. Validated: `index validate` passes with new artifacts present.
3. Explainable: at least one fixture demonstrates a multi-hop source→sink path with call-site evidence.
4. Safe: no uncontrolled artifact growth; per-record truncation works.

