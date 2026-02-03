DEPRECATED: Replaced by docs/specs/risk-interprocedural-config.md; docs/specs/risk-summaries.md; docs/specs/risk-flows-and-call-sites.md; docs/specs/risk-interprocedural-stats.md Reason: Consolidated into canonical Phase 10 specs Date: 2026-01-31 Commit: (this move)

**Status:** Draft (needs another pass after first implementation).

Phase 10 introduces non-artifact interfaces that are easy to get wrong (and hard to keep stable)
unless they are written down:

- The internal build state stored under `state.riskInterprocedural`
- Ownership / timing of each step in the build pipeline (relations step vs artifact writing step)
- Determinism + cap behavior that must be preserved across refactors

This document is intentionally separate from the artifact contracts:
- `risk_summaries.jsonl` + compact summary (`docmeta.risk.summary`)
- `risk_flows.jsonl`
- `call_sites.jsonl`
- `risk_interprocedural_stats.json`

Those are covered by:
- `spec_risk-summaries_IMPROVED.md`
- `spec_risk-flows-and-call-sites_RECONCILED.md`
- `risk-callsite-id-and-stats_IMPROVED.md`

---

## Terminology

- **chunkUid**: Stable chunk identity (Phase 8+ identity contract). This is the canonical ID for Phase 10.
- **chunkId**: Range-derived ID (legacy). May exist in metadata for debugging, but **must not** be the primary key.
- **call edge**: A resolved `(callerChunkUid -> calleeChunkUid)` edge derived from cross-file inference (`callLinks`).
- **call site**: A concrete invocation expression (`calleeRaw(...)`) with location, stored in `call_sites.jsonl`.

---

## state.riskInterprocedural shape

`state.riskInterprocedural` should be **absent** unless Phase 10 is enabled.

Recommended shape (JS objects / Maps):

```ts
export type EdgeKey = `${string}>>${string}`; // `${callerChunkUid}>>${calleeChunkUid}`

export type RiskInterproceduralState = {
  // Effective config (post-normalization + gating)
  enabled: boolean;
  effective: {
    summaryOnly: boolean;
    emitArtifacts: 'none' | 'jsonl';
    strictness: 'conservative' | 'argAware';
    sanitizerPolicy: 'terminate' | 'weaken';
    maxDepth: number;
    maxRoots: number;
    maxPathsPerRoot: number;
    maxTotalFlows: number;
    maxCallSitesPerEdge: number;
    timeBudgetMs: number;
  };

  // Phase outputs
  summariesByChunkUid: Map<string, RiskSummaryRow>; // only for chunks with local risk
  compactByChunkUid: Map<string, RiskCompactSummary>; // mirrors docmeta.risk.summary payload

  flows: RiskFlowRow[]; // ordered, already capped

  // Evidence selection
  edgesUsed: Set<EdgeKey>; // edges appearing in any emitted flow path
  callSiteIdsByEdge: Map<EdgeKey, string[]>; // deterministic sample for each used edge

  // Accounting / diagnostics
  stats: RiskInterproceduralStats;
};
```

Notes:
- `callSiteIdsByEdge` can be built during propagation (best), because you already know `edgesUsed`.
- If you also want to cap/sort call sites by edge for general call graph purposes, that should be a separate concern.

---

## Pipeline integration points

### 1) Build runtime

**Owner:** `src/index/build/runtime/runtime.js`

- Parse + normalize `indexing.riskInterprocedural` into an **effective** config.
- Apply gating:
  - Not `mode === 'code'`  -> disabled
  - Risk analysis disabled by `analysisPolicy.risk.enabled === false` -> disabled
  - `emitArtifacts === 'none'` still computes in-memory summaries/flows (unless explicitly disabled)

### 2) Relations step

**Owner:** `src/index/build/indexer/steps/relations.js`

Execution order (recommended):
1. Collect per-file relations (language relations collectors)
2. If `riskInterproceduralEnabled`, ensure cross-file inference runs (even if other cross-file features are off)
3. Build local risk summaries (`summariesByChunkUid`, `compactByChunkUid`) from each chunk’s existing `docmeta.risk`
4. If not `summaryOnly`, run propagation over call edges derived from `callLinks` (`targetChunkUid`)
5. Populate `state.riskInterprocedural` with outputs + stats

### 3) Write step

**Owner:** `src/index/build/indexer/steps/write.js`

- Ensure `index_state.json` records:
  - `features.riskInterprocedural` boolean
  - `extensions.riskInterprocedural` with a small summary of effective config (no raw rules)

### 4) Artifact writing

**Owner:** `src/index/build/artifacts.js` + `src/index/build/artifacts/writers/*`

- If `runtime.riskInterproceduralEnabled && runtime.riskInterproceduralEffectiveEmit === 'jsonl'`:
  - write `risk_summaries.jsonl` from `state.riskInterprocedural.summariesByChunkUid`
  - write `risk_flows.jsonl` from `state.riskInterprocedural.flows`
  - write `risk_interprocedural_stats.json` from `state.riskInterprocedural.stats`
  - write `call_sites.jsonl` **filtered to** `state.riskInterprocedural.edgesUsed` (recommended)

---

## Determinism requirements

The following must be deterministic across runs for identical inputs/config:
- `risk_summaries.jsonl` row ordering and evidence ordering
- propagation traversal order and tie-breaking
- call-site sampling per edge
- `flowId` computation

If any randomized sampling is needed, it must be derived from stable inputs (e.g., sort by id and take prefix).

---

## Validation responsibilities

Validation should be split:

- **Schema validation** (contracts): ensured by `src/contracts/schemas/*` and `src/shared/artifact-io/*`.
- **Referential integrity** (Phase 10): ensured by `src/index/validate.js` extensions:
  - each `risk_flows[*].path.chunkUids[*]` exists in chunk_meta
  - each `risk_flows[*].path.callSiteIdsByStep[*][*]` exists in call_sites

---

## Open questions (explicitly needs another pass)

1. Should `call_sites.jsonl` remain a general artifact (call graph) or become “risk-focused” when Phase 10 is enabled?
   - Current repo behavior: call graph uses `call_sites` when present (see `src/index/build/graphs.js`).
   - If Phase 10 filters call_sites to only used edges, `graphs.js` may need to merge callLinks + callSites.

2. Do we want `riskInterprocedural` config in build signature (`signatures.js`)?
   - Recommended: yes, otherwise incremental builds can reuse stale outputs.

3. Should compact summaries be attached to *all* chunks or only those with local risk?
   - Recommended: only chunks with local risk get `docmeta.risk.summary` (keeps metadata minimal).





