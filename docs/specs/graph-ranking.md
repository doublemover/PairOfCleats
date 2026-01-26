# Spec -- Graph-Aware Ranking Signals (Refined, Implementation-Ready)

**Status:** Draft / implementation-ready  
**Phase:** GigaRoadmap Phase 11 -- Graph-powered product features  
**Primary goal:** Introduce bounded, explainable graph-based scoring signals that improve retrieval quality without destabilizing core lexical/vector relevance.

---

## 0. Non-negotiable properties

1. **Bounded influence**: graph signals must contribute **≤ 20%** of final score by default.
2. **Explainable**: `--explain` must show:
   - which graph signals were used,
   - their values,
   - and their contribution to final ranking.
3. **Capability gated**: if required artifacts/capabilities are missing, graph ranking is disabled (no silent partial usage).
4. **Deterministic**: same inputs → same ordering. Tie-breakers are stable.
5. **Backwards compatible**: disabling graph ranking yields identical behavior to pre-phase 11 ranking.

---

## 1. Terms and scope

Graph-aware ranking is an augmentation layer applied after base provider scoring (sparse/fts/ann/hybrid). It does not replace:
- FTS ranking (`bm25`)
- sparse/postings scoring
- vector ANN similarity
- existing hybrid merge (RRF, blending)

Instead it computes a **GraphBoost** multiplier/offset under strict constraints.

---

## 2. Inputs

### 2.1 BaseHit

```ts
type BaseHit = {
  chunkUid: string;
  symbolId?: string;
  baseScore: number;          // normalized to [0,1] before graph boost
  providerBreakdown: { [provider: string]: number };
  fileRelPath: string;
  lines?: { start: number; end: number };
};
```

### 2.2 GraphSignals

Graph signals are derived from precomputed or on-demand cheap graph queries:

- `exportedness`: whether a symbol is exported or a module boundary symbol
- `fanIn`: number of inbound call edges (callers)
- `fanOut`: number of outbound call edges (callees)
- `centralityApprox`: bounded approximation, e.g., log-scaled fanIn/out
- `distanceToSeed`: if using context packs / graph expansion, proximity to seed nodes
- `testAffinity`: whether a result is in a test path (used only as a penalty/neutral, never a strong boost)

**Important:** For v1, avoid expensive global algorithms (PageRank). Use cheap local metrics.

---

## 3. Configuration

```ts
type GraphRankingConfig = {
  enabled: boolean;                 // default false until stabilized; can be auto-enabled for certain intents
  maxContribution: number;          // default 0.20 (20%) hard max 0.35
  signals: {
    exportednessWeight: number;     // default 0.08
    fanInWeight: number;            // default 0.06
    centralityWeight: number;       // default 0.04
    distanceWeight: number;         // default 0.02
    testPenaltyWeight: number;      // default 0.04
  };
  caps: {
    maxFanIn: number;               // default 2000 (clamp)
    maxFanOut: number;              // default 2000
  };
  strictness: "strict"|"warn"|"loose";
};
```

**Hard rules**
- `maxContribution <= 0.35`
- weights sum does not imply contribution; contribution is clamped separately

---

## 4. Scoring model

### 4.1 Normalization

- Normalize base provider score into `[0,1]`:
  - for ANN cosine similarity: map from `[-1,1]` or `[0,1]` depending on backend; store details in explain
  - for bm25: use rank-based normalization by topN window (deterministic)
  - for sparse: normalize by max score in result window

### 4.2 Signal computations

- exportedness: `1` if exported else `0`
- fanInNorm: `log1p(min(fanIn,maxFanIn)) / log1p(maxFanIn)`
- centralityApprox: `0.5*(fanInNorm + fanOutNorm)`
- distanceToSeedNorm: `1/(1+distance)` else `0` if unknown
- testPenalty: `1` if in tests else `0`

### 4.3 Boost computation (bounded)

Compute raw boost:

`raw = wE*exportedness + wF*fanInNorm + wC*centralityApprox + wD*distanceToSeedNorm - wT*testPenalty`

Map to contribution:

`contrib = clamp(raw, -maxContribution, +maxContribution)`

Final score:

`finalScore = clamp01(baseScore + contrib)`

**Why additive rather than multiplicative**
- Keeps influence bounded and easy to explain
- Avoids amplifying high baseScore too much

---

## 5. Explain contract

When `--explain` is enabled, each hit should contain:

```json
{
  "score": {
    "base": 0.71,
    "graph": {
      "enabled": true,
      "signals": {
        "exportedness": 1,
        "fanIn": 120,
        "fanInNorm": 0.64,
        "centralityApprox": 0.51,
        "distanceToSeed": 1,
        "distanceToSeedNorm": 0.5,
        "testPenalty": 0
      },
      "weights": { "...": 0.08 },
      "raw": 0.11,
      "contribution": 0.11,
      "clampedBy": null
    },
    "final": 0.82
  }
}
```

If graph ranking is disabled:
- `graph.enabled=false`
- include reason:
  - missing artifacts
  - strictness gating
  - user disabled

---

## 6. Capability gating

Graph ranking requires:
- Graph artifact availability (`graph_relations` or equivalent)
- Symbol identity mapping (SymbolId or stable fallback)
- (optional) export graph if exportedness is used

**Strictness rules**
- strict: if graph signals requested but artifacts missing → error
- warn: disable graph ranking and emit warning in explain
- loose: silently disable (NOT recommended; only for internal tools)

---

## 7. Tests

### 7.1 Unit tests
- normalization functions stable
- clamp invariants (contribution never exceeds max)
- explain payload correctness and stability

### 7.2 Integration tests
Fixture repo:
- one exported API symbol
- one internal helper
- multiple callers to create fanIn
- a test file under `tests/` calling helper

Assertions:
- exported API ranks above internal helper when baseScore close
- testPenalty prevents tests dominating results
- disabling graph ranking produces baseline ordering identical to pre-phase 11

Golden snapshot:
- `--explain` JSON for top 5 hits stable.

---

## 8. Implementation checklist

Minimum touchpoints:
- `src/retrieval/ranking/*` (or wherever ranking is implemented today)
- `src/retrieval/pipeline.js` options plumbing
- `src/retrieval/output/*` explain rendering
- `src/shared/capabilities.js` gating
- `docs/contracts/retrieval-ranking.md` updated after implementation

Non-goals (v1):
- global centrality algorithms
- graph ML models
- cross-repo ranking signals (belongs in federation phase)
