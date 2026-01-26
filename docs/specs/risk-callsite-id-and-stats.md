# Spec: callSiteId algorithm + `risk_interprocedural_stats` artifact (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Scope
This document is the canonical definition for:

* the deterministic `callSiteId` algorithm used by `call_sites` rows
* the `risk_interprocedural_stats.json` schema and invariants

Other specs MUST reference this document rather than re-specifying these rules.

---

## 2) `callSiteId` algorithm (normative)

`callSiteId` MUST be computed as:

```
callSiteId = "sha1:" + sha1(
  file + ":" +
  startLine + ":" + startCol + ":" +
  endLine + ":" + endCol + ":" +
  calleeName
)
```

Constraints:
* `file` MUST be the repo-relative POSIX path for the call site location.
* Line/col MUST be **1-based**.
* `calleeName` MUST be the raw callee string recorded by the language relations collector (e.g., `"runQuery"` or `"db.query"`).
* The SHA1 hex MUST be lowercase, prefixed with `sha1:`.

Notes:
* `callSiteId` is referenced by `risk_flows.path.callSiteIdsByStep` and MUST be stable across repeated identical builds.
* If required input fields are unavailable, the producer MUST NOT synthesize a `callSiteId` from alternate fields; instead, it MUST omit the call-site row or correct the collector to provide the required fields.

---

## 3) `risk_interprocedural_stats` artifact (normative)

### 3.1 Goal
Provide a single, small, human-readable summary of the interprocedural risk pipeline execution:

* whether it ran
* whether it timed out
* which caps were hit
* counts of emitted rows
* pointers to emitted artifacts (single or sharded)

This avoids "hidden failure" where flows are missing but users cannot tell why.

### 3.2 Artifact naming
Logical artifact name: `risk_interprocedural_stats`

Recommended filename:
* `risk_interprocedural_stats.json`

This file is not sharded.

### 3.3 Schema (normative)

```ts
type RiskInterproceduralStatsV1_1 = {
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
      maxMs: number | null
    }
  },

  counts: {
    chunksConsidered: number,
    summariesEmitted: number,
    sourceRoots: number,
    resolvedEdges: number,

    flowsEmitted: number,
    callSitesEmitted: number
  },

  capsHit: string[], // e.g., ["maxTotalFlows","maxPathsPerPair"]

  timingsMs: {
    summaries: number,
    propagation: number,
    total: number
  },

  artifacts: {
    riskSummaries?: ArtifactRefV1_1,
    callSites?: ArtifactRefV1_1,
    riskFlows?: ArtifactRefV1_1
  },

  droppedRecords: {
    artifact: "risk_summaries" | "call_sites" | "risk_flows",
    count: number,
    reasons: { reason: string, count: number }[]
  }[]
};

type ArtifactRefV1_1 = {
  name: string,              // logical name
  format: "jsonl",
  sharded: boolean,
  // If sharded: the meta filename; else: the artifact filename
  entrypoint: string,
  totalEntries: number
};
```

### 3.4 Status rules (required)
* If `riskInterprocedural.enabled` is false (or forced off due to local risk disabled): `status="disabled"`.
* If propagation exceeds `caps.maxMs`: `status="timed_out"`.
* If an unhandled exception occurs: `status="error"` and `reason` MUST be set.
* Otherwise: `status="ok"`.

Normative: `timed_out` MUST imply `flowsEmitted === 0` and `callSitesEmitted === 0`.

### 3.5 Artifact references
When `emitArtifacts="jsonl"`:
* `artifacts.riskSummaries` MUST be present if summaries were emitted.
* If `summaryOnly=false` and `status="ok"`:
  * `artifacts.callSites` and `artifacts.riskFlows` MUST be present.

When `emitArtifacts="none"`:
* `artifacts` MAY be empty, but counts and status MUST still be recorded.

For `ArtifactRefV1_1.entrypoint`:
* If non-sharded: the filename (e.g., `risk_summaries.jsonl`)
* If sharded: the meta filename (e.g., `risk_summaries.meta.json`)

### 3.6 Determinism
The stats artifact MUST be deterministic except for:
* `generatedAt`
* `timingsMs` (performance-dependent)

Everything else (counts, capsHit, filenames) MUST be stable given the same repo + config.

### 3.7 Validation invariants
The validator SHOULD check:
* `schemaVersion === 1`
* `generatedAt` is ISO-like
* required fields exist for each `status`
* if `status="timed_out"`, then `flowsEmitted===0` and `callSitesEmitted===0`
