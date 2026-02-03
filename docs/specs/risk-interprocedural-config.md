# Spec: `indexing.riskInterprocedural` configuration (v1.1 refined)

## Status
* **Normative** for Phase 10 implementation.
* Uses RFC 2119 keywords (**MUST**, **SHOULD**, **MAY**) for requirements.

## 1) Purpose
This configuration surface controls the Phase 10 **interprocedural risk pipeline**:

1. Build **per-symbol risk summaries** (`risk_summaries` artifact + compact in-chunk summary).
2. Optionally build **interprocedural risk flows** (`risk_flows` artifact) and **call-site evidence** (`call_sites` artifact).
3. Emit a small **stats** artifact that explains what happened, including cap hits and timeouts.

Primary goals:
* Deterministic output under caps.
* Bounded artifacts suitable for large repos.
* No implicit enablement of unrelated features (e.g., type inference).

## 2) Configuration location
This configuration lives in the repo config object under:

```jsonc
{
  "indexing": {
    "riskInterprocedural": { /* ... */ }
  }
}
```

The config keys **must** be preserved through config normalization and validated in `docs/config/schema.json`.

## 3) Authoritative keys and defaults

### 3.1 Canonical shape (authoritative)
```jsonc
{
  "indexing": {
    "riskInterprocedural": {
      "enabled": false,
      "summaryOnly": false,
      "strictness": "conservative",
      "emitArtifacts": "jsonl",
      "sanitizerPolicy": "terminate",
      "caps": {
        "maxDepth": 4,
        "maxPathsPerPair": 3,
        "maxTotalFlows": 5000,
        "maxCallSitesPerEdge": 3,
        "maxEdgeExpansions": 200000,
        "maxMs": 2500
      }
    }
  }
}
```

### 3.2 Field contract

| Key | Type | Default | Meaning |
|---|---:|---:|---|
| `enabled` | boolean | `false` | Enables the interprocedural risk pipeline. |
| `summaryOnly` | boolean | `false` | If `true`, compute summaries + compact in-chunk summary, but **do not** compute `risk_flows`. |
| `strictness` | enum | `"conservative"` | Propagation policy. See Section 6. |
| `emitArtifacts` | enum | `"jsonl"` | Artifact emission policy. See Section 5. |
| `sanitizerPolicy` | enum | `"terminate"` | How sanitizer-bearing chunks affect propagation. See Section 7. |
| `caps.maxDepth` | integer >= 1 | `4` | Maximum call depth (edges traversed) for propagation. |
| `caps.maxPathsPerPair` | integer >= 1 | `3` | Maximum number of distinct paths per `(sourceChunkUid, sourceRuleId, sinkChunkUid, sinkRuleId)` pair. |
| `caps.maxTotalFlows` | integer >= 0 | `5000` | Hard cap on total `risk_flows` rows emitted for the build. Use `0` to disable flow emission. |
| `caps.maxCallSitesPerEdge` | integer >= 1 | `3` | Maximum number of call-site samples preserved per call edge. |
| `caps.maxEdgeExpansions` | integer >= 10000 | `200000` | Global cap on edge expansions to prevent blowups. |
| `caps.maxMs` | integer >= 10 or null | `2500` | Optional time guard for **flow propagation only**. See Section 8. |

### 3.3 Normalization rules (deterministic)
Implement normalization in `src/index/risk-interprocedural/config.js`:

* `emitArtifacts`:
  * accept `off` or `none` -> `none`
  * accept `jsonl` -> `jsonl`
  * anything else -> default `jsonl`
* `strictness`: unknown -> `conservative`
* `sanitizerPolicy`: unknown -> `terminate`
* numeric caps:
  * coerce to integers
  * clamp to sane ranges:
    * `maxDepth`: 1..20
    * `maxPathsPerPair`: 1..50
    * `maxTotalFlows`: 0..1_000_000 (`0` disables flow emission)
    * `maxCallSitesPerEdge`: 1..50
    * `maxEdgeExpansions`: 10_000..10_000_000
    * `maxMs`: null OR 10..60_000
* `summaryOnly=true` forces **no flows** even if caps allow.
* If `enabled=false`, downstream code must treat the entire feature as disabled and avoid heavy compute.

## 4) Interactions with existing features (required)

### 4.1 Local risk analysis dependency
Interprocedural risk **requires** local risk signals (`src/index/risk.js`).

Normative rules:
1. If local risk analysis is disabled for the build (effective `riskAnalysisEnabled === false`), then `riskInterprocedural.enabled` **must** be treated as `false`.
2. Interprocedural risk **must not** change the local risk detector's regex ruleset or caps, other than enabling cross-file linking and emitting additional artifacts.

### 4.2 Cross-file call linking requirement
Interprocedural risk requires resolved call edges (`callDetails[].targetChunkUid`).

Normative rule:
* If `riskInterprocedural.enabled === true`, the build **must** run the cross-file linking stage at least to populate resolved call edges (even if type inference is disabled).

Implementation hook (current code):
* `src/index/type-inference-crossfile/pipeline.js` is invoked when:
  * `typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`
* This condition **must** be extended to include:
  * `|| riskInterproceduralEnabled`

### 4.3 Type inference must not be enabled implicitly
Normative rule:
* Enabling interprocedural risk **must not** force `typeInferenceEnabled` or `typeInferenceCrossFileEnabled` to `true`.

## 5) Artifact emission policy (`emitArtifacts`)
`emitArtifacts` controls whether on-disk artifacts are written:

* `"none"`:
  * No new `risk_*` artifacts are written.
  * The implementation **must** still attach the compact summary to `chunk.docmeta.risk.summary` (and therefore `metaV2` after rebuild).
  * The implementation **should** still write the stats artifact (it is tiny and aids observability), unless explicitly disabled by higher-level "no artifacts" settings.
* `"jsonl"`:
  * Artifacts are written in JSONL form and may be sharded.
  * Global artifact compression settings (if any) must apply consistently.
  * `call_sites` emission is independent of `summaryOnly` and uses the call details available in `codeRelations`.

## 6) Strictness modes (`strictness`)

### 6.1 `conservative` (required)
Propagation rule:
* If a source-bearing chunk is on a path, taint is assumed to potentially flow along **all** resolved outgoing call edges.

This mode prioritizes recall (may over-approximate).

### 6.2 `argAware` (optional but fully specified)
`argAware` adds an additional constraint to edge traversal using call-site argument summaries and source rules:

A call edge `(caller -> callee)` is traversable for taint **only if** there exists at least one sampled call-site on that edge where **at least one argument** is considered tainted by either:

1. Identifier-boundary matching against the caller's current taint identifier set, **or**
2. Matching any configured **source rule regex** from the same local risk ruleset used by the local detector.

The implementation must:
1. Track a bounded taint identifier set per traversal state.
2. Use identifier-boundary matching (no naive substring matches).
3. When traversing to the callee, derive the callee's initial taint identifier set by mapping tainted argument positions to callee parameter names.

Full details, bounds, and deterministic behavior are defined in the flows spec.

## 7) Sanitizer policy (`sanitizerPolicy`)

Allowed values:
* `"terminate"` (default): sanitizer-bearing chunks terminate propagation (no outgoing traversal from that chunk).
* `"weaken"`: sanitizer-bearing chunks allow traversal but apply a confidence penalty (see flows spec).

Normative rule:
* The pipeline **must** treat sanitizers as a property of a chunk summary (not of a call-site). Policy is applied during traversal.

## 8) Determinism and time guard (`caps.maxMs`)

### 8.1 Determinism requirements (always)
All outputs must be stable across runs given the same repository contents and config.

Minimum required ordering rules:
* Source roots processed in lexicographic order of `sourceChunkUid`, then `sourceRuleId`.
* Outgoing edges processed in lexicographic order of `calleeChunkUid`.
* Sinks within a chunk processed in lexicographic order of `sinkRuleId`.

### 8.2 Time guard semantics (no partial nondeterministic output)
`caps.maxMs` is a **fail-safe** for flow propagation only. It must **not** produce "first N flows" based on runtime speed.

Normative behavior:
1. If the time budget is exceeded during propagation, the implementation must:
   * abort propagation entirely,
   * emit **zero** `risk_flows` rows,
   * record `status="timed_out"` in the stats artifact.
2. Summaries must still be produced (they are computed before propagation).

Note: `call_sites` is written from call details and is not currently gated on timeout; it may still be emitted when `status="timed_out"` if enabled.

Disallowed behavior:
* emitting a partial prefix of flows that depends on machine speed or scheduling.

## 9) Incremental build signature + index_state
Turning interprocedural risk on/off (or changing its effective behavior) must invalidate incremental build caches.

Update:
- `src/index/build/indexer/signatures.js` to include the normalized effective config (or a stable hash of it).
- `src/index/build/indexer/steps/write.js` to record `riskInterprocedural` state in `index_state.json`.

## 10) Implementation references
- Runtime: `src/index/build/runtime/runtime.js`
- Relations step: `src/index/build/indexer/steps/relations.js`
- Signature: `src/index/build/indexer/signatures.js`
