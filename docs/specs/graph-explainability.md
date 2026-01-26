# Spec -- Unified Graph Explainability Contract (Refined, Implementation-Ready)

**Status:** Draft / implementation-ready  
**Phase:** GigaRoadmap Phase 11 -- Graph-powered product features  
**Primary goal:** A single shared, versioned explainability schema used by:
- Context Packs
- Impact Analysis
- Graph-aware ranking
- Any future graph-driven UX (contracts, architecture reports, risk explain, etc.)

---

## 0. Non-negotiable properties

1. **Single schema** used everywhere; no per-feature bespoke explain blobs.
2. **Versioned** with strict compatibility posture.
3. **Composable**: explain entries can reference each other by ID.
4. **Evidence-addressable**: every claim can reference evidence records by stable IDs.
5. **Deterministic**: stable ordering and stable IDs.

---

## 1. ExplainEnvelope

```json
{
  "formatVersion": 1,
  "schema": "ExplainEnvelope",
  "schemaVersion": "1.0.0",
  "indexSignature": "...",
  "createdAt": "...",
  "requestId": "...",
  "notes": [ "..." ],
  "capabilities": { "...": "ExplainCapabilities" },
  "items": [ { "...": "ExplainItem" } ],
  "evidence": [ { "...": "EvidenceRecord" } ],
  "limits": { "...": "ExplainLimits" }
}
```

### 1.1 ExplainCapabilities
- declares which evidence kinds were available
- declares which graph artifacts participated

```json
{
  "graph": { "available": true, "schemaVersion": "1.0.0" },
  "callSites": { "available": false },
  "riskFlows": { "available": true, "schemaVersion": "1.0.0" }
}
```

### 1.2 ExplainLimits
- bounded sizes for explain payloads

```json
{
  "maxItems": 2000,
  "maxEvidence": 5000,
  "maxBytesTotal": 5000000,
  "truncated": false
}
```

---

## 2. ExplainItem

ExplainItem is the core record: "why was this included / ranked / considered impacted".

```json
{
  "id": "ex:sha256:...",
  "kind": "contextItem" | "impactPath" | "rankingHit" | "graphEdge" | "warning",
  "subject": {
    "symbolId": "...",
    "chunkUid": "...",
    "fileRelPath": "src/...",
    "range": { "start": 0, "end": 10 }
  },
  "summary": "Included because it is a direct caller of foo()",
  "causes": [
    {
      "type": "graphTraversal",
      "edgeTypes": ["call"],
      "direction": "in",
      "distance": 1,
      "pathRef": "path:sha256:...",
      "confidence": 0.82
    }
  ],
  "refs": {
    "evidenceIds": ["ev:callsite:..."],
    "relatedExplainIds": ["ex:..."]
  },
  "metrics": {
    "seedScore": 0.7,
    "hybridScore": 0.75
  }
}
```

**Invariants**
- `id` is stable: `sha256(normalized(kind + subject + causes))`
- `confidence` is always in `[0,1]`
- `summary` is bounded (<= 256 chars) and must not include raw code blocks

---

## 3. EvidenceRecord

EvidenceRecord is a normalized proof primitive.

```json
{
  "id": "ev:callsite:sha256:...",
  "kind": "callsite" | "importStmt" | "identifier" | "span" | "tooling" | "risk",
  "subject": {
    "fileRelPath": "src/a.js",
    "range": { "start": 123, "end": 160 },
    "lines": { "start": 10, "end": 12 }
  },
  "snippet": {
    "text": "foo(bar)",
    "truncated": false,
    "maxBytes": 2048
  },
  "confidence": 0.85,
  "source": {
    "artifact": "call_sites",
    "artifactVersion": "1.0.0",
    "recordId": "callsite:12345"
  }
}
```

**Rules**
- Snippets are bounded by byte length and explicitly marked as truncated.
- Evidence must reference its source artifact.
- Evidence IDs must be stable: `sha256(kind + fileRelPath + range + snippetHash + sourceRecordId)`.

---

## 4. Warnings and degradations

Explain must include structured warnings when:
- graph artifacts missing
- evidence missing
- budgets truncated output
- ambiguity prevented traversal

Represent warnings as `ExplainItem.kind="warning"` with:
- `code`
- `message`
- `severity`
- `remediation`

Example:
```json
{
  "id":"ex:warn:...",
  "kind":"warning",
  "summary":"Graph ranking disabled: graph_relations artifact missing",
  "causes":[{"type":"capabilityMissing","confidence":1}],
  "refs":{},
  "metrics":{"missing":"graph_relations"}
}
```

---

## 5. Determinism rules

- `items` must be stable-sorted by `id` (or by an explicit stable ordering then id).
- `evidence` stable-sorted by `id`.
- All numeric values rounded to a fixed precision for JSON output:
  - scores: 6 decimals
  - confidence: 4 decimals
  (This prevents float jitter from breaking determinism tests.)

---

## 6. API usage patterns

### 6.1 Context Packs
- ContextItem.why references `ExplainItem.id`
- Evidence referenced via `EvidenceRecord.id`

### 6.2 Impact
- ImpactPath.pathId references `ExplainItem.id` for that path
- Each hop edge references `EvidenceRecord.id` when available

### 6.3 Ranking
- Each hit includes a `ExplainItem.id` describing graph signals and contribution

---

## 7. Tests

### 7.1 Unit tests
- stable id generation
- stable rounding rules
- truncation metadata correctness

### 7.2 Integration tests
- `--explain` output stable across two runs
- When artifacts missing, explain contains a warning and disables relevant features
- Evidence snippet extraction respects maxBytes

---

## 8. Implementation checklist

- `src/shared/explain/ids.js` -- stable id helpers (sha256, canonical stringify)
- `src/shared/explain/schema.js` -- runtime guards/validators
- `src/shared/explain/builders.js` -- helper constructors for items/evidence/warnings
- Integrate into:
  - context pack builder
  - impact analyzer
  - ranking layer
  - CLI/MCP renderers

Non-goals (v1):
- natural language "story" formatting; explain is structured and terse
- UI rendering layer; that belongs in later operator UX phases
