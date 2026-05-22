# Spec -- Graph-Aware Ranking Signals (Active Contract)

**Status:** Active implemented contract v1.0
**Last audited:** 2026-05-21
**Roadmap area:** Graph-powered product features; current status is tracked in `docs/roadmap.md`.
**Implementation anchors:** `src/retrieval/pipeline/graph-ranking.js`,
`src/retrieval/pipeline/rank-stage.js`, `src/retrieval/cli/normalize-options.js`,
and `src/retrieval/output/explain.js`.
**Primary goal:** Introduce bounded, explainable graph-based scoring signals that improve retrieval quality without destabilizing core lexical/vector relevance.

---

## 0. Non-negotiable properties

1. **Bounded traversal**: graph signals must use explicit depth, width, visited-node, work-unit, and wall-clock caps.
2. **Explainable**: `--explain` must show:
   - which graph signals were used,
   - their values,
   - and their contribution to final ranking.
3. **Capability gated**: if required artifacts/capabilities are missing, graph ranking is disabled (no silent partial usage).
4. **Deterministic**: same inputs → same ordering. Tie-breakers are stable.
5. **Backwards compatible**: disabling graph ranking yields identical behavior to pre-phase 11 ranking.

---

## 1. Terms and scope

Graph-aware ranking is an optional augmentation layer applied after base provider scoring (sparse/fts/ann/hybrid). It does not replace:
- FTS ranking (`bm25`)
- sparse/postings scoring
- vector ANN similarity
- existing hybrid merge (RRF, blending)

Instead it computes an additive graph score from bounded degree/proximity signals.

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

- `degree`: combined call/usage graph in/out degree for the result chunk.
- `proximity`: inverse distance from selected seed hits after deterministic bounded graph expansion.

**Important:** For v1, avoid expensive global algorithms (PageRank). Use cheap local metrics only.

---

## 3. Configuration

```ts
type GraphRankingConfig = {
  enabled: boolean;
  weights: {
    degree?: number;
    proximity?: number;
  };
  maxGraphWorkUnits?: number;       // default 500
  maxWallClockMs?: number;
  seedSelection?: "top1" | "topK" | "none";
  seedK?: number;
  expansion: {
    maxDepth?: number;              // default 2; hard max 4
    maxWidthPerNode?: number;       // default 12; hard max 64
    maxVisitedNodes?: number;       // default 192; hard max 2048
  };
};
```

**Hard rules**
- Graph ranking is a no-op unless `enabled=true`, graph relations are loaded, and at least one supported weight is non-zero.
- The ranking stage must preserve result membership; it may reorder and adjust scores only for the existing candidate set.
- Expansion caps are clamped in `src/retrieval/pipeline/graph-ranking.js`.

### 3.1 Track IQ bounded expansion policy (implemented)

Graph reordering uses deterministic multi-hop expansion from selected seed hits with explicit bounds:

- `expansion.maxDepth` default `2`, hard max `4`
- `expansion.maxWidthPerNode` default `12`, hard max `64`
- `expansion.maxVisitedNodes` default `192`, hard max `2048`

Traversal is deterministic BFS over lexicographically sorted neighbor IDs.
Stop/truncation reason is explicit and stable:

- `maxWorkUnits`
- `maxWallClockMs`
- `maxVisitedNodes`
- `maxWidthPerNode`
- `maxDepth`

---

## 4. Scoring model

### 4.1 Normalization

- Normalize base provider score into `[0,1]`:
  - for ANN cosine similarity: map from `[-1,1]` or `[0,1]` depending on backend; store details in explain
  - for bm25: use rank-based normalization by topN window (deterministic)
  - for sparse: normalize by max score in result window

### 4.2 Signal computations

- `degree`: combined in/out degree from call and usage relation indexes.
- `seedDistance`: deterministic BFS distance from the selected seed hits.
- `proximity`: `1` for selected seed chunks, `1 / (seedDistance + 1)` for reached neighbors, and `0` for unknown distance.

### 4.3 Boost computation

Compute raw boost:

`graphScore = (weights.degree * degree) + (weights.proximity * proximity)`

The current implementation adds `graphScore` to the existing score, then sorts by
score descending with original index as the stable tie-breaker.

Operators should keep configured weights small enough for the desired relevance
profile; traversal and runtime remain bounded independently of score weights.

---

## 5. Explain contract

When `--explain` is enabled, each hit should contain:

```json
{
  "score": {
    "base": 0.71,
    "graph": {
      "score": 0.11,
      "degree": 2,
      "proximity": 0.5,
      "seedDistance": 1,
      "weights": { "degree": 0.03, "proximity": 0.1 },
      "seedSelection": "top1",
      "seedK": null,
      "expansion": {
        "maxDepth": 2,
        "maxWidthPerNode": 12,
        "maxVisitedNodes": 192
      },
      "stopReason": null
    },
    "final": 0.82
  }
}
```

If graph ranking is disabled or cannot run, no `scoreBreakdown.graph` entry is
added and the input entries are returned unchanged.

---

## 6. Capability gating

Graph ranking requires:
- Graph artifact availability (`graph_relations` or equivalent)
- Stable chunk identities on ranked hits (`chunkUid` or `metaV2.chunkUid`)
- At least one configured supported weight (`degree` or `proximity`)

If those requirements are not met, graph ranking is a no-op and returns the input
entries unchanged with no graph-ranking stats.

---

## 7. Contract Coverage

- `tests/retrieval/ranking/graph-ranking-contract-matrix.test.js`
- `tests/retrieval/expansion/multihop-bounded-policy.test.js`
- `tests/retrieval/pipeline/artifact-gating.test.js`
- `tests/retrieval/pipeline/retrieval-stage-checkpoints.test.js`

---

## 8. Implementation Touchpoints

- `src/retrieval/pipeline/graph-ranking.js`: score adjustment, bounded expansion, and stats.
- `src/retrieval/pipeline/rank-stage.js`: pipeline integration.
- `src/retrieval/cli/normalize-options.js`: config and CLI option normalization.
- `src/retrieval/cli/required-artifacts.js`: graph artifact dependency closure.
- `src/retrieval/output/explain.js`: graph score explanation rendering.

Non-goals (v1):
- global centrality algorithms
- graph ML models
- cross-repo ranking signals (belongs in federation phase)
