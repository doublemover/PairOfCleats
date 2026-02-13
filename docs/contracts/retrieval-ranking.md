# Retrieval ranking and explain contract (0.0.2)

This document defines the ranking/explainability surface for retrieval and the semantics of optional post-processing steps.

Phase 11 adds:
- hardened, bounded **context expansion** behavior,
- opt-in **graph-aware ranking** (ordering only; membership invariant),
- and new explain payload fields for graph ranking.

---

## Ranking modes
- Sparse ranking uses BM25/FTS over token/posting artifacts.
- Dense ranking uses ANN when available (HNSW or sqlite extension).
- When both sparse and ANN are active, results combine via RRF or blend.

## Explainability

### `scoreType`
`scoreType` is one of:
- `bm25`, `bm25-fielded`, `fts`, `ann`, `rrf`, `blend`, `context`, or `none`.

### `scoreBreakdown`
`scoreBreakdown` includes `selected`, plus the component blocks used:

- `sparse`: sparse score and weighting metadata (when available)
- `ann`: dense similarity score and source (when available)
- `rrf`: fusion details when enabled
- `blend`: blended score details when enabled
- `symbol`: definition/export boosts (when available)
- `phrase`: phrase/chargram boosts (when available)

#### Phase 17: Prose FTS explain additions
When SQLite FTS is selected for prose modes and explain is enabled, hits SHOULD include:

- `scoreBreakdown.sparse.match`: compiled FTS5 `MATCH` string.
- `scoreBreakdown.sparse.variant`: selected tokenizer variant (`trigram|porter|unicode61`).
- `scoreBreakdown.sparse.tokenizer`: tokenizer config label.
- `scoreBreakdown.sparse.variantReason`: precedence reason path.
- `scoreBreakdown.sparse.normalizedQueryChanged`: whether NFKC changed the query.
- `scoreBreakdown.sparse.ftsFallback`: true when desired FTS routing fell back to sparse.
- Controlled unavailability diagnostics use code `retrieval_fts_unavailable`.

#### Phase 11: Graph ranking breakdown (optional)
When graph ranking is enabled and explain is requested, hits SHOULD include:

- `scoreBreakdown.graph`:
  - `score` (number): additive score applied for graph-aware reordering
  - `degree` (number): combined in+out degree across call/usage graphs
  - `proximity` (number): seed proximity (1 for seed hits, 0.5 for neighbors, else 0)
  - `weights` (object): `{ degree, proximity }` weights used to compute `score`
  - `seedSelection` (`top1|topK|none`)
  - `seedK` (number|null)

Graph ranking MUST NOT change membership (see below).

### `--explain` and `--why`
These flags must render identical content and differ only in presentation.

Phase 17 also requires routing visibility in explain stats:
- `stats.routingPolicy`
- `stats.routing`

---

## Context expansion (post-ranking; optional)

Context expansion is computed after initial ranking and may append additional hits with `scoreType=context`.

Phase 11 hardens expansion to be:
- bounded (explicit caps, no unbounded candidate arrays),
- deterministic (stable ordering and reason precedence),
- and identity-first when graph artifacts exist.

### Phase 11 expansion semantics (normative)
- Expansion MUST be opt-in (default off).
- Expansion MUST enforce caps during candidate generation:
  - `maxPerHit`, `maxTotal`, per-source examination caps, and `maxWorkUnits`.
- Expansion MUST NOT build unbounded intermediate arrays (no “candidate explosion”).
- Expansion MUST dedupe candidates deterministically and select the “best reason” by a documented precedence order.
- Expansion MUST NOT assume `chunkMeta[id]` is a stable array dereference; use maps keyed by `docId`/`chunkUid`.
- If `graph_relations` exists, expansion SHOULD prefer identity-first edges (chunkUid) over name joins.
- Name-based joins MUST be treated as fallback:
  - low confidence markers in explain output,
  - bounded candidates, and
  - warnings when used.

### Default caps (recommended starting point)
Phase 11 will calibrate defaults, but safe starting values:
- `maxPerHit = 4`
- `maxTotal = 40`
- `maxWorkUnits = 20000`
- per-source caps: `maxCallEdgesExamined`, `maxImportLinksExamined`, etc.

---

## Graph-aware ranking (Phase 11; opt-in)

Graph ranking is a post-selection reordering step that uses bounded graph features.

### Membership invariant (normative)
When graph ranking is enabled:
1. The pipeline MUST compute the baseline membership set (the returned top-N results) without graph features.
2. Graph ranking MAY reorder **only within** that baseline set.
3. The returned result membership MUST be identical with graph ranking off/on.

### Performance and bounding
- Graph feature computation MUST have a deterministic work cap (`maxGraphWorkUnits`).
- A wall-clock fuse MAY exist but must emit truncation when it triggers.

---

## References
- `docs/contracts/search-contract.md`
- `docs/contracts/search-cli.md`
- `docs/specs/graph-product-surfaces.md`


