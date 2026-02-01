# Spec: `call_sites` and `risk_flows` artifacts (JSONL) (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Goal
These artifacts provide explainable, bounded evidence for **interprocedural** (cross-chunk) risk:

* `call_sites`: sampled call-site records keyed by `callSiteId`
* `risk_flows`: interprocedural source->sink paths through the resolved call graph, with per-edge call-site references

They are designed to be:
* deterministic under caps
* small enough to load for `risk explain`
* joinable (strict referential integrity)

## 2) Artifact naming and sharding
Logical artifact names:
* `call_sites`
* `risk_flows`

Each MUST be emitted in either single-file or sharded form as described in the summaries spec:
* `<name>.jsonl` (or compressed)
* or `<name>.meta.json` + `<name>.parts/...`

## 3) Common format requirements
* UTF-8
* JSON Lines
* no header row
* each line MUST be <= **32KB** UTF-8

If a record cannot be truncated to fit 32KB deterministically, it MUST be dropped and recorded in the stats artifact.

## 4) `call_sites` schema (normative)

### 4.1 Contract source of truth
The canonical schema is the existing CallSiteEntry contract:
* `src/contracts/schemas/artifacts.js` (`callSiteEntry`)
* `src/shared/artifact-io/jsonl.js` (`JSONL_REQUIRED_KEYS.call_sites`)

Phase 10 MUST treat this schema as authoritative and MUST NOT introduce an incompatible `call_sites` schema.

### 4.2 Minimal required fields (subset)
The full schema contains more fields; Phase 10 only requires that each call site row includes at least:

```ts
// Subset that Phase 10 depends on
type CallSiteEntrySubset = {
  callSiteId: string;           // "sha1:..."
  callerChunkUid: string | null;
  file: string;
  startLine: number;            // 1-based
  startCol: number;             // 1-based
  endLine: number;              // 1-based
  endCol: number;               // 1-based
  calleeRaw: string;            // raw callee expression string
  calleeNormalized: string;     // normalized callee string
  args: string[];               // truncated stringified args
  snippetHash: string | null;   // "sha1:..." (hash of normalized snippet or fallback)

  // When resolved by cross-file inference:
  targetChunkUid?: string | null;
  targetCandidates?: string[];
}
```

### 4.3 `callSiteId` computation (required)
`callSiteId` MUST be computed per the canonical algorithm in:

* `docs/specs/risk-callsite-id-and-stats.md`

### 4.4 Sampling per resolved edge (required)
`call_sites` MUST be bounded by sampling:

For each resolved call edge `(callerChunkUid, calleeChunkUid)`, keep at most:
* `caps.maxCallSitesPerEdge` call sites

Deterministic sampling order:
* Sort candidate call sites by `(file, startLine, startCol, endLine, endCol, calleeNormalized, calleeRaw, callSiteId)`.
* Take the first `maxCallSitesPerEdge`.

Only call sites for edges that appear in at least one emitted `risk_flows` row MUST be written.
(Edges never used in any emitted flow should not inflate artifacts.)

## 5) `risk_flows` schema (normative)

### 5.1 TypeScript-like definition
```ts
type RiskFlowRowV1 = {
  schemaVersion: 1,
  flowId: string,  // "sha1:<hex>"

  source: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "source",
    category: string | null,
    severity: null,
    confidence: number | null
  },

  sink: {
    chunkUid: string,
    ruleId: string,
    ruleName: string,
    ruleType: "sink",
    category: string | null,
    severity: string | null,
    confidence: number | null
  },

  path: {
    chunkUids: string[],             // length >= 2
    callSiteIdsByStep: string[][]    // length == chunkUids.length - 1
  },

  confidence: number,                // 0..1

  notes: {
    strictness: "conservative" | "argAware",
    sanitizerPolicy: "terminate" | "weaken",
    hopCount: number,
    sanitizerBarriersHit: number,
    capsHit: string[]                // e.g., ["maxDepth","maxPathsPerPair"]
  }
};
```

### 5.2 `flowId` computation (required)
`flowId` MUST be computed as:

```
flowId = "sha1:" + sha1(
  source.chunkUid + "|" + source.ruleId + "|" +
  sink.chunkUid + "|" + sink.ruleId + "|" +
  path.chunkUids.join(">")
)
```

### 5.3 Path invariants (required)
For every row:
* `path.chunkUids.length >= 2`
* `path.callSiteIdsByStep.length == path.chunkUids.length - 1`
* Every `callSiteId` referenced MUST exist in the emitted `call_sites` artifact (if present).

### 5.4 Row size cap enforcement (required)
Hard limit: **<= 32KB** per JSONL row.

Deterministic trimming steps:
1. Reduce each `callSiteIdsByStep[i]` to at most 1 id.
2. If still too large, replace `callSiteIdsByStep` with empty arrays (correct length).
3. If still too large, drop the row and record in stats.

## 6) Deterministic ordering
The writer MUST emit flows in a deterministic order so reruns on the same input are byte-identical.

Recommended stable ordering:
1. `source.chunkUid` (asc)
2. `source.ruleId` (asc)
3. `sink.chunkUid` (asc)
4. `sink.ruleId` (asc)
5. `path.chunkUids.join("\u0000")` (asc)
6. `flowId` (asc)

## 7) Referential integrity (validation)
If `emitArtifacts: "jsonl"` and `summaryOnly === false` and `status === "ok"`:
* Every `path.chunkUids[*]` must reference a chunk present in `chunk_meta`.
* Every `callSiteId` in `path.callSiteIdsByStep[*][*]` must exist in `call_sites.jsonl`.

## 8) Implementation mapping
- `call_sites` writer (existing): `src/index/build/artifacts/writers/call-sites.js`
- propagation output + flows writer:
  - `src/index/risk-interprocedural/engine.js` (propagation)
  - `src/index/build/artifacts/writers/risk-interprocedural.js` (write `risk_flows.jsonl`)
