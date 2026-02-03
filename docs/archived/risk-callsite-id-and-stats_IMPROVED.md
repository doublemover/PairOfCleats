DEPRECATED: Replaced by docs/specs/risk-callsite-id-and-stats.md; docs/specs/risk-interprocedural-stats.md Reason: Consolidated into canonical Phase 10 specs Date: 2026-01-31 Commit: (this move)

**Status:** Improved spec for PairOfCleats (Phase 10).

This document covers:
- the stable `callSiteId` algorithm used by `call_sites.jsonl`
- the `risk_interprocedural_stats.json` artifact

It is aligned with the repo’s existing call-site infrastructure:
- Call-site writer: `src/index/build/artifacts/writers/call-sites.js`
- Call-site schema: `src/contracts/schemas/artifacts.js` (`callSiteEntry`)
- Required keys: `src/shared/artifact-io/jsonl.js` (`JSONL_REQUIRED_KEYS.call_sites`)

---

## 1. callSiteId algorithm

### 1.1 Inputs
A `callSiteId` must be derived from **only** fields that are stable within a file:
- `file` (relative path)
- `startLine`, `startCol`
- `endLine`, `endCol`
- `calleeRaw` (raw callee string as seen in the call expression)

### 1.2 Canonical string

```
canonical = joinWith("\n", [
  "callsite:v1",
  file,
  `${startLine}:${startCol}`,
  `${endLine}:${endCol}`,
  calleeRaw,
])
```

### 1.3 Hash and formatting

```
callSiteId = "sha1:" + sha1hex(canonical)
```

### 1.4 Notes
- `startCol` and `endCol` are **1-based**.
- For Python, `ast` uses 0-based columns (`col_offset`), so the extractor must add `+1`.
- If an AST does not provide `endLine/endCol`, set them equal to `startLine/startCol`.

---

## 2. risk_interprocedural_stats.json

### 2.1 Purpose
A small, always-loadable summary of what Phase 10 produced.

### 2.2 Contract

```ts
type RiskInterproceduralStatsV1_1 = {
  schemaVersion: 1;

  // Execution gating
  enabled: boolean;
  summaryOnly: boolean;
  emitArtifacts: "none" | "jsonl";
  status: "ok" | "skipped" | "timed_out" | "error";

  // Inputs / constraints
  strictness: "conservative" | "argAware";
  sanitizerPolicy: "terminate" | "weaken";
  maxDepth: number;
  maxEdgeExpansions: number;
  maxCallSitesPerEdge: number;
  maxFlows: number;
  timeoutMs: number;

  // Output sizes
  chunksWithSummaries: number;
  flowsEmitted: number;
  edgesUsed: number;
  callSitesEmitted: number;

  // Diagnostics
  warnings: string[];
  truncated: {
    depthLimited: number;
    edgeExpansionsLimited: number;
    flowsLimited: number;
    callSitesLimited: number;
  };

  // Basic timing
  timingsMs?: {
    buildSummaries?: number;
    propagate?: number;
    writeArtifacts?: number;
  };
}
```

### 2.3 Artifact presence rules
- If `enabled === false`: the stats artifact may be absent or present with `status:"skipped"`.
- If `enabled === true`:
  - `risk_interprocedural_stats.json` **must** exist.
  - If `emitArtifacts === "jsonl"` and `summaryOnly === false` and `status === "ok"`:
    - `risk_flows.jsonl` must exist.
    - `call_sites.jsonl` must include all callSiteIds referenced by `risk_flows`.

---

## 3. Implementation mapping

- callSiteId generation (JS + Python prerequisites):
  - JS relations call details location: `src/lang/javascript/relations.js`
  - Python call details location: `src/lang/python/ast-script.js`
  - Writer: `src/index/build/artifacts/writers/call-sites.js` (`createCallSiteId`)

- Stats production:
  - `state.riskInterprocedural.stats` (see `spec_risk-interprocedural-state-and-pipeline_DRAFT.md`)
  - Writer: `src/index/build/artifacts/writers/risk-interprocedural.js`






