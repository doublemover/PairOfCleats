DEPRECATED: Replaced by docs/specs/risk-flows-and-call-sites.md Reason: Consolidated into canonical Phase 10 specs Date: 2026-01-31 Commit: (this move)

**Status:** Reconciled spec for PairOfCleats (Phase 10).

This document defines the artifact contracts for:
- `risk_flows.jsonl`
- `call_sites.jsonl`

It is explicitly written to match the current repo reality:
- `call_sites.jsonl` already exists (Phase 6) and is validated by `src/contracts/schemas/artifacts.js` and `src/shared/artifact-io/jsonl.js`.
- Phase 10 must not invent an incompatible call_sites schema; instead it should **reuse** (or version) the existing contract.

---

## 1. Artifact: call_sites.jsonl

### 1.1 Purpose
A repository-wide record of concrete invocation expressions (“call sites”), used for:
- Call graph evidence / explainability
- Linking risk flows to human-inspectable sites

### 1.2 Contract source of truth
The canonical schema is the existing **Phase 6** CallSiteEntry contract:
- `src/contracts/schemas/artifacts.js` (`callSiteEntry`)
- `src/shared/artifact-io/jsonl.js` (`JSONL_REQUIRED_KEYS.call_sites`)

Phase 10 must treat this schema as authoritative.

### 1.3 Minimal required fields (subset)
The full schema contains more fields; Phase 10 only *requires* that each call site row includes at least:

```ts
// Subset that Phase 10 depends on
type CallSiteEntrySubset = {
  callSiteId: string;           // e.g. "sha1:..."
  callerChunkUid: string;
  file: string;
  startLine: number;            // 1-based
  startCol: number;             // 1-based
  endLine: number;              // 1-based
  endCol: number;               // 1-based
  calleeRaw: string;            // raw callee expression string
  calleeNormalized: string;     // normalized callee string
  args: string[];               // truncated stringified args
  snippetHash: string;          // "sha1:..." (hash of normalized snippet)

  // When resolved by cross-file inference:
  targetChunkUid?: string;
  targetCandidates?: string[];
}
```

### 1.4 Stability + determinism requirements
- `callSiteId` must be computed per `risk-callsite-id-and-stats_IMPROVED.md`.
- If call-sites are sampled/capped, selection must be deterministic (sort by `callSiteId` then take first N).

---

## 2. Artifact: risk_flows.jsonl

### 2.1 Purpose
A repository-wide list of **interprocedural** taint flows (source -> … -> sink), derived by propagating summaries across call edges.

### 2.2 Row schema
```ts
type RiskFlowRowV1_1 = {
  schemaVersion: 1;
  flowId: string;               // "sha1:..." stable

  ruleId: string;               // risk rule id
  category: string;             // e.g. "injection"
  severity: "low"|"medium"|"high"|"critical";

  source: {
    chunkUid: string;
    signalId: string;           // stable id local-to-summary
    location?: { file?: string; startLine?: number; startCol?: number };
    snippetHash?: string;       // "sha1:..." if available
  };

  sink: {
    chunkUid: string;
    signalId: string;
    location?: { file?: string; startLine?: number; startCol?: number };
    snippetHash?: string;
  };

  // The ordered call path from source->...->sink
  path: {
    chunkUids: string[];                // length >= 2
    // For each edge i: chunkUids[i] -> chunkUids[i+1]
    callSiteIdsByStep: string[][];      // length == chunkUids.length - 1
  };

  confidence: number;           // 0..1 (see engine spec)
  status: "ok"|"capped"|"timed_out";

  // Optional: explainability + debugging
  debug?: {
    edgesUsed?: number;
    notes?: string[];
  };
}
```

### 2.3 Referential integrity
If `emitArtifacts: "jsonl"` and `status !== "timed_out"`:
- Every `path.chunkUids[*]` must reference a chunk present in chunk_meta.
- Every `callSiteId` in `path.callSiteIdsByStep[*][*]` must exist in `call_sites.jsonl`.

### 2.4 Deterministic ordering
The writer must emit flows in a deterministic order so that reruns on the same input are byte-identical.
Recommended stable ordering:
1. `ruleId` (asc)
2. `source.chunkUid` (asc)
3. `sink.chunkUid` (asc)
4. `path.chunkUids.join("\u0000")` (asc)
5. `flowId` (asc)

### 2.5 flowId
`flowId = "sha1:" + sha1hex( joinWith("\n", [
  "v1",
  ruleId,
  source.chunkUid, source.signalId,
  sink.chunkUid, sink.signalId,
  path.chunkUids.join("->"),
  // include callsite ids but normalized (sorted per step)
  path.callSiteIdsByStep.map(step => step.slice().sort().join(",")).join("|"),
]))`

---

## 3. Implementation mapping

Where this should land in code:
- `call_sites` writer (existing): `src/index/build/artifacts/writers/call-sites.js`
  - extend to support deterministic per-edge sampling and/or filtering by `state.riskInterprocedural.edgesUsed`
- new propagation output + flows writer:
  - `src/index/risk-interprocedural/engine.js` (propagation)
  - `src/index/build/artifacts/writers/risk-interprocedural.js` (write `risk_flows.jsonl`)






