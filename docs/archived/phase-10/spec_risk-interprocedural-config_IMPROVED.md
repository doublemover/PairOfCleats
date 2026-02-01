DEPRECATED: Replaced by docs/specs/risk-interprocedural-config.md Reason: Consolidated into canonical Phase 10 specs Date: 2026-01-31 Commit: 5965fcc # Risk Interprocedural Config

**Status:** Improved spec for PairOfCleats (Phase 10).

This document defines the configuration surface for Phase 10 interprocedural risk.

It is based on `docs/specs/risk-interprocedural-config.md`, with repo-specific clarifications:
- how `analysisPolicy` overrides interact with `indexing.riskInterprocedural`
- where the runtime normalization lives
- what must be included in incremental build signatures

---

## 1. Location in config
The user-facing config lives under:

- `indexing.riskInterprocedural` (object | undefined)

This config is separate from (but depends on) the existing risk settings:
- `indexing.riskAnalysis`
- `analysisPolicy.risk.enabled` (if present)

---

## 2. Normalized runtime shape
Runtime must expose two concepts:

1) **user config** (what they asked for)
2) **effective config** (what will actually execute)

Proposed runtime fields:

- `runtime.riskInterproceduralConfig`: normalized config object (never null; default `{ enabled:false, ... }`)
- `runtime.riskInterproceduralEnabled`: boolean (effective)
- `runtime.riskInterproceduralSummaryOnly`: boolean (effective)
- `runtime.riskInterproceduralEmitArtifacts`: `'none'|'jsonl'` (effective)
- `runtime.riskInterproceduralStrictness`: `'conservative'|'argAware'` (effective)
- `runtime.riskInterproceduralCaps`: resolved caps (defaults applied)

### 2.1 Effective enablement rules (MUST)
`riskInterproceduralEnabled` MUST be `false` if any of the following hold:
- `runtime.mode !== 'code'`
- resolved risk analysis is disabled:
  - `analysisPolicy.risk.enabled === false`, OR
  - `indexing.riskAnalysis === false`
- `riskInterprocedural.enabled === false`

### 2.2 Default values (recommended)
- `enabled`: false
- `summaryOnly`: false
- `emitArtifacts`: 'none'
- `strictness`: 'conservative'
- `sanitizerPolicy`: 'terminate'
- `caps.maxCallDepth`: 4
- `caps.maxFlowsPerRoot`: 32
- `caps.maxEdgesPerRoot`: 256
- `caps.maxCallSitesPerEdge`: 2
- `caps.maxTotalCallSites`: 50_000
- `caps.timeBudgetMs`: 8_000

---

## 3. Where normalization happens
Normalization MUST be centralized in:

- `src/index/risk-interprocedural/config.js` (new)

and called from:

- `src/index/build/runtime/runtime.js` in `createBuildRuntime(...)`.

This ensures every downstream user (relations step, artifact writer, CLI explainers) sees the same effective config.

---

## 4. Incremental build signatures
Turning interprocedural risk on/off (or changing its effective behavior) MUST invalidate incremental build caches.

Update:
- `src/index/build/indexer/signatures.js` (`buildIncrementalSignaturePayload`)

to include at least:
- `riskInterproceduralEnabled`
- `riskInterproceduralSummaryOnly`
- `riskInterproceduralEmitArtifacts`
- `riskInterproceduralStrictness`
- a stable summary of caps

Prefer placing this inside the existing `features` object (or an `extensions.riskInterprocedural` subtree) so it is visible in signatures and index_state.

---

## 5. Implementation references
- Runtime: `src/index/build/runtime/runtime.js`
  - anchors: `createBuildRuntime` (starts ~L38), risk flags block (~L163)
- Relations step: `src/index/build/indexer/steps/relations.js`
  - `runCrossFileInference` (~L126)
- Signature: `src/index/build/indexer/signatures.js` (~L13)


