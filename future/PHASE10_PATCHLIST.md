# Phase 10 Patch List (static analysis)

This patch list captures **concrete code/document changes** needed to bring the current repository back in line with the **Phase 10 roadmap text in `COMPLETED_PHASES.md`** (and any adjacent normative specs it references).  
Derived via **static analysis only** (no execution).

---

## 10.1 Config + runtime gating

### 10.1.3 Wire mode-aware interprocedural gating into runtime
- [ ] **Implement per-mode “effective” risk interprocedural config** and use it everywhere mode matters.
  - **Problem:** `createBuildRuntime()` normalizes `riskInterprocedural` with `{}` (no `mode`) and computes `runtime.riskInterproceduralEnabled` without `mode` gating.
  - **Required behavior (roadmap):**  
    `riskInterproceduralEnabled = (mode === "code") && riskAnalysisEnabled && riskInterproceduralConfig.enabled`
  - **Fix options (pick one):**
    - **Option A (recommended, minimal blast radius):** derive a **mode-scoped runtime** inside `buildIndexForMode(...)` and pass it to steps.
      - **Edit:** `src/index/build/indexer/pipeline.js`
      - **Add:** `effectiveRiskInterproceduralConfig = normalizeRiskInterproceduralConfig(runtime.indexingConfig.riskInterprocedural, { mode })`
      - **Add:** `riskInterproceduralEnabled = mode === "code" && riskAnalysisEnabled && effectiveRiskInterproceduralConfig.enabled`
      - **Override:** `runtimeRef.riskInterproceduralConfig` + `runtimeRef.riskInterproceduralEnabled` + `runtimeRef.analysisPolicy.risk.interprocedural`
    - **Option B:** make runtime creation itself mode-aware (larger refactor; the build currently runs multiple modes off one runtime).
      - **Edit:** `src/index/build/runtime/runtime.js` (and all call sites)

### 10.1.5 Incremental signatures must use the mode-effective flag/config
- [ ] Ensure signature payload uses **mode-effective** `riskInterproceduralEnabled` and `riskInterproceduralConfig`.
  - **Problem:** `buildIncrementalSignaturePayload(...)` currently reads `analysisPolicy.risk.interprocedural` / `runtime.riskInterproceduralEnabled` that are not mode-scoped.
  - **Edit:** `src/index/build/indexer/signatures.js`
  - **Acceptance:** enabling interprocedural should not cause **non-code** mode signatures to fluctuate.

### 10.1.6 `index_state.json` must reflect mode-effective interprocedural state
- [ ] In `index_state.json`, ensure:
  - `riskInterprocedural.enabled`
  - `riskInterprocedural.summaryOnly`
  - `riskInterprocedural.emitArtifacts`

  reflect the **mode-effective** values.
  - **Problem:** `writeIndexArtifactsForMode(...)` uses `runtime.riskInterproceduralEnabled` (not mode-scoped).
  - **Edit:** `src/index/build/indexer/steps/write.js`

### 10.1.7 Runtime gating tests (must include non-code mode)
- [ ] Expand `tests/indexing/risk/interprocedural/runtime-gating.test.js`:
  - assert `riskInterproceduralEnabled` true for `mode="code"` (when enabled + riskAnalysis enabled)
  - assert `riskInterproceduralEnabled` false for a non-code mode (e.g. `mode="prose"`)
  - assert `runCrossFileInference` gating includes `riskInterproceduralEnabled` in `crossFileEnabled`
  - **Edits:**  
    - `tests/indexing/risk/interprocedural/runtime-gating.test.js`  
    - (if needed) `src/index/build/indexer/steps/relations.js`

---

## 10.3 Risk summaries + compact chunk meta

### 10.3.2 Update `buildRiskSummaries` signature + gating
- [ ] Change `buildRiskSummaries` signature to match roadmap:
  - **From:** `buildRiskSummaries({ chunks, interprocedural, log })`
  - **To:** `buildRiskSummaries({ chunks, runtime, mode, log })`
  - **Edit:** `src/index/risk-interprocedural/summaries.js`
- [ ] Update caller + gating per roadmap:
  - **Run when:**  
    `mode === "code" && (runtime.riskInterproceduralEnabled === true || runtime.riskInterproceduralConfig.emitArtifacts === "jsonl")`
  - **Edit:** `src/index/build/indexer/steps/relations.js`
- [ ] Ensure `docmeta.risk.summary.interprocedural` uses the correct values:
  - `enabled` should reflect **effective enablement**
  - `summaryOnly` should reflect effective config
  - **Edit:** `src/index/risk-interprocedural/summaries.js`

### 10.3.2 Deterministic ordering: sinks by severity → ruleId → evidence location
- [ ] Update sink sorting to satisfy roadmap ordering:
  - primary: `severity` rank (high→medium→low→null; include `critical` if produced)
  - secondary: `ruleId`
  - tertiary: earliest evidence location (your existing `minEvidenceKey(...)`)
  - **Edit:** `src/index/risk-interprocedural/summaries.js` (`normalizeSignals` / comparator)
- [ ] Extend determinism tests to cover severity ordering explicitly (if current fixtures don’t cover it).
  - **Edit/Add:** `tests/indexing/risk/interprocedural/summaries-determinism.test.js`

### 10.3.4 Export `taintHints` from local risk detector
- [ ] Add `taintHints: { taintedIdentifiers: string[] }` to local risk output.
  - **Roadmap requirements:** sort + cap (e.g. 50), attach to `docmeta.risk`.
  - **Edit:** `src/index/risk.js`
  - **Implementation suggestion (deterministic):**
    - collect candidate identifiers from the internal `taint` map keys (and/or assignments)
    - filter empty / non-ident names
    - sort lexicographically (or by frequency then lexicographically) and cap at 50
    - attach as `risk.taintHints = { taintedIdentifiers: [...] }`
- [ ] Confirm summaries builder passes through `taintHints` (it already consumes `risk.taintHints` if present).
  - **No code change expected:** `src/index/risk-interprocedural/summaries.js`

---

## 10.5 Propagation confidence scoring

### 10.5.9 Implement the confidence formula exactly
- [ ] Update `flowConfidence()` to match roadmap exactly:
  - `C_source = sourceSignal.confidence ?? 0.5`
  - `C_sink = sinkSignal.confidence ?? 0.5`
  - `base = 0.1 + 0.9 * C_source * C_sink`
  - `hopCount = chunkUids.length - 1`
  - `hopDecay = 0.85 ** Math.max(0, hopCount - 1)`
  - `sanitizerPenalty = sanitizerPolicy==="weaken" ? (0.5 ** sanitizerBarriersHit) : 1.0`
  - `final = clamp(base * hopDecay * sanitizerPenalty, 0, 1)`
  - **Edit:** `src/index/risk-interprocedural/engine.js`
- [ ] Update/extend tests so this becomes regression-locked:
  - verify hopCount exponent is `(hopCount - 1)` (with floor at 0)
  - verify sanitizer penalty is `0.5 ** barriers` (not `0.9 ** barriers`)
  - verify clamp is `[0, 1]` (no minimum floor like 0.05)
  - **Edit/Add:** `tests/indexing/risk/interprocedural/*` (most likely the flow tests)

---

## 10.6 Artifacts + contracts + required keys

### 10.6.1 Canonical `risk_interprocedural_stats` schema fields are missing
- [ ] Update the **stats generator** to emit canonical fields:
  - `callSiteSampling: { enabled, perCalleeLimit, totalLimit, seed }`
  - `mode` (propagation mode; likely mirrors `strictness`)
  - `timingMs: { total, propagation, io }` (roadmap requires `io` specifically)
  - `capsHit` (already present)
  - **Fix semantics:** `counts.risksWithFlows` must be the count of **riskIds** (not just sink chunkUids).
    - **Suggested riskId:** `${sink.chunkUid}|${sink.ruleId}`
  - **Edit:** `src/index/risk-interprocedural/engine.js`
- [ ] Update the schema to require/describe those fields (roadmap says canonical).
  - **Edit:** `src/contracts/schemas/artifacts.js`
- [ ] Update spec doc to match canonical schema (roadmap explicitly calls this out).
  - **Edit:** `docs/specs/risk-interprocedural-stats.md`

### 10.6.2 JSONL required keys for `risk_summaries` are too strict
- [ ] Update `JSONL_REQUIRED_KEYS.risk_summaries` to the minimal set:
  - **Expected:** `["schemaVersion","chunkUid","file","signals"]`
  - **Current:** includes `totals`, `truncated` too
  - **Edit:** `src/shared/artifact-io/jsonl.js`

### 10.6.4 `enqueueRiskInterproceduralArtifacts(...)` signature + gating do not match roadmap
- [ ] Align writer **signature** to accept the roadmap parameters:
  - `enqueueRiskInterproceduralArtifacts({ state, runtime, mode, outputDir, manifest, log })`
  - (you may keep additional parameters, but support these names)
  - **Edit:** `src/index/build/artifacts/writers/risk-interprocedural.js`
- [ ] Implement writer gating exactly as written:
  - if `mode !== "code"` → do nothing
  - if `!runtime.riskInterproceduralEnabled` → do nothing
  - **Problem today:** writer runs whenever `state.riskInterproceduralStats` exists, and stats are generated even when disabled.
- [ ] Ensure state aggregation matches roadmap:
  - create `state.riskInterprocedural = { summaryRows, flowRows, stats, callSiteIdsReferenced }`
  - **Edits likely split across:**
    - `src/index/build/indexer/steps/relations.js` (where summaries are computed)
    - `src/index/build/indexer/steps/write.js` (where engine runs)
    - `src/index/build/artifacts/writers/risk-interprocedural.js` (writer expectations)
- [ ] Document **chosen compute location** (roadmap requires one location, documented).
  - Add a short comment in the chosen step (relations vs write) explaining why summaries/engine are invoked there and ensuring it happens once.
  - **Edit:** whichever file owns the invocation.

---

## Tasks this patch list is based on
These roadmap items were evaluated (Phase 10 focus):

- 10.1.3, 10.1.5, 10.1.6, 10.1.7  
- 10.3.2, 10.3.4  
- 10.5.9  
- 10.6.1, 10.6.2, 10.6.4
