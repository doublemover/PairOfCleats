# Spec: `risk_interprocedural_stats` artifact (JSON) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
Provide a single, small, human-readable summary of the interprocedural risk pipeline execution:

* whether it ran
* whether it timed out
* which caps were hit
* counts of emitted rows
* pointers to emitted artifacts (single or sharded)

This avoids hidden failure where flows are missing but users cannot tell why.

## 2) Artifact naming
Logical artifact name: `risk_interprocedural_stats`

Recommended filename:
* `risk_interprocedural_stats.json`

This file is not sharded.

## 3) Schema (normative)

```ts
type RiskInterproceduralStatsV1 = {
  schemaVersion: 1,
  generatedAt: string, // ISO timestamp

  status: "ok" | "disabled" | "timed_out" | "error",
  reason: string | null,

  effectiveConfig: {
    enabled: boolean,
    summaryOnly: boolean,
    strictness: "conservative" | "argAware",
    emitArtifacts: "none" | "jsonl",
    sanitizerPolicy: "terminate" | "weaken",
    caps: {
      maxDepth: number,
      maxPathsPerPair: number,
      maxTotalFlows: number,
      maxCallSitesPerEdge: number,
      maxEdgeExpansions: number,
      maxMs: number | null
    }
  },

  counts: {
    chunksConsidered: number,
    summariesEmitted: number,
    sourceRoots: number,
    resolvedEdges: number,
    flowsEmitted: number,
    risksWithFlows: number,
    uniqueCallSitesReferenced: number
  },

  capsHit: string[],

  timingMs: {
    summaries: number,
    propagation: number,
    total: number
  },

  artifacts: {
    riskSummaries?: ArtifactRef,
    callSites?: ArtifactRef,
    riskFlows?: ArtifactRef
  },

  droppedRecords?: {
    artifact: "risk_summaries" | "call_sites" | "risk_flows",
    count: number,
    reasons?: { reason: string, count: number }[]
  }[]
};

type ArtifactRef = {
  name: string,
  format: "jsonl",
  sharded: boolean,
  entrypoint: string,
  totalEntries: number
};
```

## 4) Status rules (required)
* If `riskInterprocedural.enabled` is false (or forced off due to local risk disabled): `status = "disabled"`.
* If propagation exceeds `caps.maxMs`: `status = "timed_out"`.
* If an unhandled exception occurs: `status = "error"` and `reason` MUST be set.
* Otherwise: `status = "ok"`.

Normative: `timed_out` MUST imply `flowsEmitted === 0` and `uniqueCallSitesReferenced === 0`.

## 5) Artifact references
When `emitArtifacts = "jsonl"`:
* `artifacts.riskSummaries` MUST be present if summaries were emitted.
* If `summaryOnly = false` and `status = "ok"`:
  * `artifacts.callSites` and `artifacts.riskFlows` MUST be present.

When `emitArtifacts = "none"`:
* `artifacts` MAY be empty, but counts and status MUST still be recorded.

For `ArtifactRef.entrypoint`:
* If non-sharded: the filename (e.g., `risk_summaries.jsonl`)
* If sharded: the meta filename (e.g., `risk_summaries.meta.json`)

## 6) Determinism
The stats artifact MUST be deterministic except for:
* `generatedAt`
* `timingMs` (performance-dependent)

Everything else (counts, capsHit, filenames) MUST be stable given the same repo + config.

## 7) Validation invariants
The validator SHOULD check:
* `schemaVersion === 1`
* `generatedAt` is ISO-like
* required fields exist for each `status`
* if `status = "timed_out"`, then `flowsEmitted === 0` and `uniqueCallSitesReferenced === 0`
* if `emitArtifacts = "jsonl"` and `summaryOnly = false` and `status = "ok"`, `risk_flows` and `call_sites` exist

## 8) Compatibility
Old indexes are **not** supported. If schemas do not match, validation MUST error and instruct the user to rebuild.
