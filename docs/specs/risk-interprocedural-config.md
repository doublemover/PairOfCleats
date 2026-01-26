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

> Note: PairOfCleats currently validates `.pairofcleats.json` against `docs/config/schema.json`, which does not yet include `indexing.*`. If/when user-configurable exposure is desired, the schema MUST be expanded accordingly. The implementation MUST still accept the config when it is provided programmatically (tests, internal wiring, or future schema expansion).

## 3) Object shape and defaults

### 3.1 Canonical shape
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
        "maxPathsPerPair": 200,
        "maxTotalFlows": 500,
        "maxCallSitesPerEdge": 3,
        "maxMs": null
      }
    }
  }
}
```

### 3.2 Field contract

| Key | Type | Default | Meaning |
|---|---:|---:|---|
| `enabled` | boolean | `false` | Enables the interprocedural risk pipeline. |
| `summaryOnly` | boolean | `false` | If `true`, compute summaries + compact in-chunk summary, but **do not** compute `risk_flows` or `call_sites`. |
| `strictness` | enum | `"conservative"` | Propagation policy. See §6. |
| `emitArtifacts` | enum | `"jsonl"` | Artifact emission policy. See §5. |
| `sanitizerPolicy` | enum | `"terminate"` | How sanitizer-bearing chunks affect propagation. See §7. |
| `caps.maxDepth` | integer ≥ 0 | `4` | Maximum call depth (edges traversed) for propagation. |
| `caps.maxPathsPerPair` | integer ≥ 1 | `200` | Maximum number of distinct paths per `(sourceChunkId, sinkChunkId, sourceRuleId, sinkRuleId)` pair. |
| `caps.maxTotalFlows` | integer ≥ 1 | `500` | Hard cap on total `risk_flows` rows emitted for the build. |
| `caps.maxCallSitesPerEdge` | integer ≥ 1 | `3` | Maximum number of call-site samples preserved per call edge. |
| `caps.maxMs` | integer ≥ 1 or `null` | `null` | Optional time guard for **flow propagation only**. See §8. |

## 4) Interactions with existing features (non-negotiable)

### 4.1 Local risk analysis dependency
Interprocedural risk **requires** local risk signals (`src/index/risk.js`).

Normative rules:
1. If local risk analysis is disabled for the build (effective `riskAnalysisEnabled === false`), then `riskInterprocedural.enabled` MUST be treated as `false` regardless of config.
2. Interprocedural risk MUST NOT change the local risk detector's regex ruleset or caps, other than enabling cross-file linking (§4.2) and emitting additional artifacts.

### 4.2 Cross-file call linking requirement
Interprocedural risk requires resolved call edges (`chunk.codeRelations.callLinks`).

Normative rule:
* If `riskInterprocedural.enabled === true`, the build MUST run the cross-file linking stage at least to populate `chunk.codeRelations.callLinks` (even if type inference is disabled).

Implementation hook (current code):
* `src/index/type-inference-crossfile/pipeline.js` is invoked when:
  * `typeInferenceCrossFileEnabled || riskAnalysisCrossFileEnabled`
* This condition MUST be extended to include:
  * `|| riskInterproceduralEnabled`

### 4.3 Type inference must not be enabled implicitly
Normative rule:
* Enabling interprocedural risk MUST NOT force `typeInferenceEnabled` or `typeInferenceCrossFileEnabled` to `true`.

## 5) Artifact emission policy (`emitArtifacts`)
`emitArtifacts` controls whether on-disk artifacts are written:

* `"none"`:
  * No new `risk_*` artifacts are written.
  * The implementation MUST still attach the compact summary to `chunk.docmeta.risk.summary` (and therefore `metaV2` after rebuild).
  * The implementation SHOULD still write the stats artifact (it is tiny and aids observability), unless explicitly disabled by higher-level "no artifacts" settings.
* `"jsonl"`:
  * Artifacts are written in JSONL form and MAY be automatically sharded (see the artifact specs).
  * Global artifact compression settings (if any) MUST apply consistently.

## 6) Strictness modes (`strictness`)

### 6.1 `conservative` (required)
Propagation rule:
* If a source-bearing chunk is on a path, taint is assumed to potentially flow along **all** resolved outgoing call edges.

This mode prioritizes recall (may over-approximate).

### 6.2 `argAware` (optional but fully specified)
`argAware` adds an additional constraint to edge traversal using call-site argument summaries and source rules:

A call edge `(caller → callee)` is traversable for taint **only if** there exists at least one sampled call-site on that edge where **at least one argument** is considered tainted by either:

1. Identifier-boundary matching against the caller's current taint identifier set (tainted params + locally-tainted variables), **OR**
2. Matching any configured **source rule regex** from the same local risk ruleset used by the local detector (covers direct source expressions like `req.body.userId`).

The implementation MUST:
1. Track a bounded taint identifier set per traversal state.
2. Use identifier-boundary matching (no naive substring matches).
3. When traversing to the callee, derive the callee's initial taint identifier set by mapping tainted argument positions to callee parameter names.

Full details, bounds, and deterministic behavior are defined in the flows spec.

## 7) Sanitizer policy (`sanitizerPolicy`)

Allowed values:
* `"terminate"` (default): sanitizer-bearing chunks terminate propagation (no outgoing traversal from that chunk).
* `"weaken"`: sanitizer-bearing chunks allow traversal but apply a confidence penalty (see flows spec).

Normative rule:
* The pipeline MUST treat sanitizers as a property of a chunk summary (not of a call-site). Policy is applied during traversal.

## 8) Determinism and the time guard (`caps.maxMs`)

### 8.1 Determinism requirements (always)
All outputs MUST be stable across runs given the same repository contents and config.

Minimum required ordering rules:
* Source roots processed in lexicographic order of `sourceChunkId`, then `sourceRuleId`.
* Outgoing edges processed in lexicographic order of `calleeChunkId`.
* Sinks within a chunk processed in lexicographic order of `sinkRuleId`.

### 8.2 Time guard semantics (no partial nondeterministic output)
`caps.maxMs` is a **fail-safe** for flow propagation only. It MUST NOT produce "first N flows" based on runtime speed.

Normative behavior:
1. If the time budget is exceeded during propagation, the implementation MUST:
   * abort propagation entirely,
   * emit **zero** `risk_flows` rows and **zero** `call_sites` rows,
   * record `status="timed_out"` in the stats artifact.
2. Summaries MUST still be produced (they are computed before propagation).

Disallowed behavior:
* emitting a partial prefix of flows that depends on machine speed or scheduling.

## 9) Observability (required)
When `enabled === true`, the build MUST record:
* counts: summaries, edges, flows, call-sites
* cap hits (including which cap)
* whether a timeout occurred (`status="timed_out"`)

The recommended mechanism is the dedicated stats artifact defined in:
* `docs/specs/risk-callsite-id-and-stats.md`


