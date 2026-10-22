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

Each supplied file or author argument is one value, including internal spaces
and commas. Repeated arguments form alternatives within that filter. Filename
prefilters must retain every exact match; an unprovable regex or short alternative
disables that optimization for the entire alternative set. Effective extension,
language and visibility facts are shared by exact matching and persisted filter
indexes (`factsVersion: 2`); stale persisted facts are rebuilt.

Import and usage filters require complete relation evidence from the selected
generation, or complete inline facts. Unavailable or corrupt required relations
are errors, rather than an empty measured relation set. Query-cache identities
include the match policy and every control-flow minimum filter.

Literal phrase evidence uses `literal-unicode.v3:preserve-case`, separately from
the normalized sparse scoring analyzer. Default phrases fold case at comparison;
case-sensitive phrases require current case-preserving source evidence and reject
older indexes with `ERR_LITERAL_ANALYZER_REBUILD`. Hashed chargram pruning requires
the complete current hash identity (version 2); stale or absent identity requires
rebuilding rather than mixing position-dependent old hashes with corrected ones.

## Filter-only search

Without query text, at least one structured filter is required. The pipeline enumerates eligible indexed chunks in stable indexed order, independently of sparse/ANN candidates, relevance, and context expansion. Pagination uses per-mode offsets bound to the exact filter and generation signature. Every indexed match is reachable by following `pagination.nextCursor`; the metadata reports total matches and continuation separately. See [Search CLI](search-cli.md#filter-only-enumeration) for coverage and type-expression identity semantics.

Return-type filters are exact and case-sensitive at the recorded type-expression token level. Compiler/tooling return facts take precedence over declared fallbacks; substring matches and heuristic guesses cannot satisfy them. Symbolic display labels are presentation only. This contract does not equate a declared type with a proven runtime value or promise universal alias/structural equivalence.

## Multi-mode fusion

Search supports code, prose, records, and mixed modes. Mixed-mode results are
fused using RRF by default; each mode can be weighted independently via config.

## Track IQ: Bundle-style result assembly

JSON output includes a deterministic `bundles` object:
- `schemaVersion` (number, current `3`)
- `groups` (array) where each group contains:
  - `bundleId`
  - `file` (nullable)
  - `hitCount`
  - `rankScore`
  - `bestRankContribution`
  - `modeCount`
  - `modes` (stable mode ordering)
  - `hits` (stable in-bundle ordering)

Grouping + ordering contract:
- Primary grouping key is `file`.
- Hits without `file` are isolated into synthetic bundles.
- Bundle ordering tie-breakers are deterministic:
  1. `rankScore` descending
  2. `bestRankContribution` descending
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



Bundle rankScore is the sum of 1/(60 + native rank) contributions, not a sum of native backend scores. Each hit retains its native score/type. Federated hits label their score federated_rrf and preserve sourceScore/sourceScoreType. A supplied createSearchPipeline reranker adapter (id and rerank) may score at most 64 existing members within two seconds; it must return one finite score per index and cannot add evidence. No model is acquired automatically. Overlapping source spans may yield to a comparable alternative within the bounded rerank window before graph ranking fixes membership.

Search CLI presets: --preset fast disables ANN and context expansion; hybrid uses independent ANN discovery; investigate enables at most ten context hits (two per primary hit) with bounded work/time. --match auto preserves ordinary semantic intent, all enforces implicit conjunctions, and any converts implicit conjunctions to disjunctions; authored Boolean operators and quotes retain their gates. --candidates limits the candidate window separately from --top. --deadline-ms supplies cooperative cancellation across supported providers; synchronous native work may finish before cancellation is observed. --output-bytes bounds JSON packets, reports omitted hits, and fails explicitly if required identity metadata alone cannot fit. Compact output retains chunk/segment/repository/generation identities, source spans and declared followup actions.

Bundle schema 3 uses JSON tuple identities: `["file", path]` for a real path and
`["missing-file", mode, ordinal]` for a pathless hit. A literal filename cannot
alias a synthetic group. Bundle scores and deterministic tie policy are unchanged.
Unicode context keeps lines containing Unicode letters or numbers. Highlighting
matches NFKD spelling and maps matches back to whole original graphemes, preserving
source bytes and the selected case policy.

Federated selection verifies each local stream under the complete global
comparator before a stable head merge. Rounded RRF ties that violate local order
use the full-sort fallback. Full hit payloads are copied only after selection;
source scores, all four modes, admitted provenance and duplicate candidates remain.
No production timing or memory qualification is implied by these operation changes.
