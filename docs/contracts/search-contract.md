# Search contract (0.0.2)

This document defines the expected search semantics across backends and modes.
It is the correctness reference for the search pipeline.

Phase 11 extends the contract with:
- hardened, bounded context expansion semantics (still post-ranking),
- opt-in graph-aware ranking hooks that **must not change membership**,
- and explain payload extensions for graph ranking.

## Ranking components

Search uses a blended ranking model:
- **Sparse (BM25/FTS)** over token postings.
- **Dense similarity** over embedding vectors (when enabled).
- **Minhash similarity** for near-duplicate signals.
- **Symbol boosts** for definitions/exports (configurable).
- **Field weights** for name/signature/doc/comment/body.

When both sparse and dense are enabled, results are blended using RRF or a
weighted sum depending on config (`search.rrf`, `search.scoreBlend`).

## Filters and precedence

Filters are applied before ranking. Supported filters include:
- `--lang`, `--ext`, `--file`, `--path`, `--type`, `--signature`
- `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`
- `--inferred-type`, `--return-type`, `--param`, `--uses`, `--calls`

Filter ordering and top semantics:
- File/path prefilters (chargram/regex) only narrow candidates; the final exact filter always runs.
- Metadata filters are evaluated before ranking, and the allowed IDs gate sparse + ANN ranking.
- `--top` applies after ranking/fusion within each mode; the pipeline over-fetches to improve fulfillment but returns fewer results when filters or candidate sets are too small.
- Context expansion runs after the primary top-N selection and may append extra context hits when enabled.

Filters are ANDed together unless explicitly documented otherwise.

## Multi-mode fusion

Search supports code, prose, records, and mixed modes. Mixed-mode results are
fused using RRF by default; each mode can be weighted independently via config.

## Track IQ: Bundle-style result assembly

JSON output includes a deterministic `bundles` object:
- `schemaVersion` (number, current `1`)
- `groups` (array) where each group contains:
  - `bundleId`
  - `file` (nullable)
  - `hitCount`
  - `totalScore`
  - `topScore`
  - `modeCount`
  - `modes` (stable mode ordering)
  - `hits` (stable in-bundle ordering)

Grouping + ordering contract:
- Primary grouping key is `file`.
- Hits without `file` are isolated into synthetic bundles.
- Bundle ordering tie-breakers are deterministic:
  1. `totalScore` descending
  2. `topScore` descending
  3. `modeCount` descending
  4. `file` lexicographic
  5. `bundleId` lexicographic
- In-bundle hit ordering tie-breakers are deterministic:
  1. `score` descending
  2. mode precedence (`code`, `extractedProse`, `prose`, `records`)
  3. source index ascending
  4. stable text key (`id`)

## Explain schema

`--explain` emits score and intent diagnostics, but field-level payloads are
intentionally backend- and profile-dependent. Consumers must treat explain
objects as extensible and ignore unknown keys.

Canonical stability requirements:
- explain payloads must remain valid JSON and deterministic for identical inputs.
- consumers must not assume a fixed `scoreBreakdown` key set.
- parser compatibility is forward-only: unknown fields are non-breaking.

### Track IQ: Intent confidence semantics
For explain output, `stats.intent` now carries a calibrated confidence surface:
- type remains the dominant class from intent classification.
- effectiveType is the class applied to retrieval knobs; when confidence is low (`confidenceBucket=low`), implementations MUST abstain and set `effectiveType=mixed`.
- confidenceByType is a deterministic, normalized per-class map over `code|prose|path|url|mixed`.
- confidence, confidenceMargin, and confidenceBucket summarize the selected class confidence.
- abstain=true and state=uncertain indicate a low-confidence intent decision.

### Track IQ: Trust surface contract
Explain output MUST include `stats.trust` with `schemaVersion=1` and:
- confidence.value, confidence.margin, confidence.bucket
- explicit confidence.buckets definitions for low|medium|high
- signals booleans for trust-relevant degradations
- reasonCodes for machine-readable trust diagnostics

Reader compatibility rule:
- Consumers MUST ignore unknown forward fields in `stats.trust` and continue parsing known fields.

### Phase 11: Graph ranking explain additions (optional)
When graph-aware ranking is enabled, explain SHOULD include:

- scoreBreakdown.graph:
  - score (number): additive score applied for graph-aware reordering
  - degree (number)
  - proximity (number)
  - weights (object; degree, proximity)
  - seedSelection (top1|topK|none)
  - seedK (number|null)

## Phase 11: Graph-aware ranking (membership invariant)

Graph ranking is an opt-in reordering step using bounded graph-derived features.

**Membership invariant (required):**
- With graph ranking enabled, search may change ordering but MUST NOT change which hits are returned (membership), compared to graph ranking disabled under the same filters/top parameters.

Implementation guidance:
- Select baseline membership (`topN`) first, then reorder within it.

## Phase 11: Context expansion hardening (post-ranking; optional)

Context expansion remains post-ranking and may append additional context hits, but Phase 11 requires:
- explicit caps and deterministic truncation behavior,
- identity-first joins when graph artifacts exist,
- and no unbounded intermediate candidate sets.

See:
- `docs/contracts/retrieval-ranking.md` (Phase 11 section)
- `docs/specs/graph-product-surfaces.md`


