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

Context-expansion work admission counts relation-edge visits, every attempted
candidate examination (including primary, duplicate, filtered and missing rows),
and repository-name file-bucket lookups. Candidate checks occur before membership
or metadata access. Time is checked at least every 16 admitted work ticks, with
at most 15 intervening ticks; cancellation is checked at every admission. A zero
work/time allowance performs no traversal. Budget exhaustion reports explicit
partiality without scanning the omitted tail to invent a count. Existing output
and eligible-name caps retain their meanings. Context lookup preparation and the
mode adapter's filtered-set preparation are reported separately from traversal;
these preparation observations do not imply a whole-query latency bound.

Filters are ANDed together unless explicitly documented otherwise.

Lazy chunk-author hydration uses request-owned metadata/filter pairs. Shared
artifact-cache rows remain unchanged, and equivalent warm requests reuse the
completed pair. SCM evidence is qualified by repository, index generation,
selected provider, pinned revision and effective provider policy. Successful
files are reusable; unavailable, empty, timed-out or partial file evidence is
retried on a later request under the existing provider backoff. No healthy empty
author map is inferred from an unavailable provider. Retention is bounded to 16
entries and 16 MiB of accounted author evidence.

Unresolved line-author predicates retain typed per-mode coverage and the
`chunk-author-unavailable` execution reason. They produce partial, non-cacheable
execution even when filtering returns no candidates. Existing file-author
fallback remains available but does not prove complete line-author coverage.
Cancellation and unsettled resource ownership propagate instead of becoming
negative author evidence; cancellation cannot publish a half-enriched pair.
The final query-result cache includes the admitted author-evidence identity and
refuses lookup/publication when that evidence is incomplete. Public coverage
copies cannot grant that private cache identity.

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

Current producer fields in `scoreBreakdown` are:

- `sparse`: lexical score, provider, normalization and field-weight observations.
- `ann`: dense score, selected backend and candidate policy.
- `rrf`: reciprocal-rank contributions when rank fusion is selected.
- `phrase`: matched phrase count and its signed relative adjustment.
- `symbol`: symbol-match adjustment evidence.
- `blend`: configured sparse/dense blend evidence outside reciprocal-rank fusion.
- `relation`: relation-match adjustment evidence.
- `selected`: the final selected score and score type.

These fields can be null when their producer is ineligible. This inventory does
not make the key set closed; optional graph diagnostics remain additive.

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

The opt-in [local reranker pool contract](experimental-local-reranker.md) separates
candidate, model-pool and final-output caps. It preserves production eligibility
and membership, immutable request/fallback snapshots, source scores and explicit
late-work ownership. Its caller-pinned local BERT adapter and authored regressions
remain unvalidated; no quality/resource promotion or default change is implied.

Search CLI presets: --preset fast disables ANN and context expansion; hybrid uses independent ANN discovery; investigate enables at most ten context hits (two per primary hit) with bounded work/time. --match auto preserves ordinary semantic intent, all enforces implicit conjunctions, and any widens only ordinary positive terms within an implicit adjacency region; phrases, exclusions, authored groups and explicit Boolean expressions retain their gates. --candidates limits the candidate window separately from --top. --deadline-ms supplies cooperative cancellation across supported providers; synchronous native work may finish before cancellation is observed. --output-bytes bounds JSON packets, reports omitted hits, and fails explicitly if required identity metadata alone cannot fit. Compact output retains chunk/segment/repository/generation identities, source spans and declared followup actions.

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

Metadata value filters preserve false and zero, including typed JSON and string
scalar equivalents. Missing/null fields never satisfy a false/zero constraint.
Existing case-insensitive substring and nonempty existence rules remain in force.
Query parser identity is 4 and plan schema is 3; result-cache identity includes
parser and metadata-predicate meaning. Explicit ANN intent follows the canonical
Boolean parse, including equals and repeated forms before the option terminator.

Strict federation requires every requested mode in selected enabled repositories
unless a repository was intentionally excluded by cohort selection. Missing
indexes reject before ranked cache reuse or fanout. Healthy zero-hit members are
complete. Non-strict requests keep their degradation diagnostics. Federation
cache schema 2 prevents reuse of earlier contradictory strict-success envelopes.

Graph symbol candidates remain possible references. One sorted, deduplicated,
cap-admitted projection drives outgoing, reverse and witness expansion. Candidate
witnesses carry uncertain candidate provenance; recorded resolved witnesses keep
their authoritative route. A zero candidate cap retains source evidence and
omission accounting without visiting any ambiguous destination.

Code scoring tokenization admits the first 20,000 punctuation matches per chunk.
Direct, file-line reuse and worker routes share that allowance and preserve the
same ordered scoring tokens, TF/doc-length inputs and synonym sequence. Per-line
storage retains a bounded prefix plus a truncation bit, so an earlier chunk cannot
spend a later chunk's allowance. `stats.punctuation` records the fixed limit,
emitted matches and whether additional matches were observed; it does not claim
the total number omitted. Literal phrase tokenization remains independent. The
scoring analyzer is `unicode-identifiers.v3` with the existing ICU identity, and
the shared lexical producer is 3. Incremental tokenization signatures and lexical
checkpoints invalidate older scoring products. Authored parity coverage compares
all ordered tokens/IDs, statistics, postings, exact production span selection and
a real worker; execution remains deferred.
