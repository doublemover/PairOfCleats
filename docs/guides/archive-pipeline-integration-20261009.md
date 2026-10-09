# Recovered archive pipeline integration — 2026-10-09

Source audit: https://chatgpt.com/space/page_24f3f779777c81918c5ddaae3bf0d30c .
The implementation stays on PR547 and preserves the original recovered corpus.

## Current production policy

The store format is `inference-history.v7`; text projection is `history-text.v7`.
Structural/context policies are v3 and artifact projection is v3. Explicit data URLs
and named base64 asset fields become hashed omission facts; surrounding code syntax
and source evidence remain preserved. Old retained bodies require explicit reprojection.
Previous stores and changed lexical identities fail closed. Rebuilding a selected
DERIVED collection is explicit; no startup migration or corpus write is performed.
Current artifact projections require `sanitized_utf16` offsets and a validated
transformation map. Identity transforms map the recovered text directly; redacted
transforms retain coarse recovered-text and sanitized-text extents. These offsets
are UTF-16 coordinates, not original binary byte offsets. Original hashes, catalog
lineage and exact source/snapshot citations remain the authority for original reads.

Archive classification uses the existing language registry plus bounded opaque-text
heuristics, with language confidence and fallback reasons. Structural segmentation
reuses the repository language/Markdown dispatch, fills uncovered text, retains
comments/docstrings and preserves fences/headings. Contiguous sanitized transport
fragments are reconstructed only from current visible source units; gaps are never
invented. Reconstruction is bounded to 5,000 fragments and 16 MiB.

Document computation identity versions classification, structural chunking, contextual
formatting and `latest-snapshot.v1` scope. Historical snapshots and old vector generations
remain preserved; current semantic admission/coverage describes latest visible redacted
projected text. Historical lexical/citation reads remain available, without claiming
full historical semantic coverage. Query policy and dimensional representation retain
separate identities.

The exact `title: <bounded source/function/section context> | text: <span>` input
is the cache key and encoder input. A tokenizer-only measurement uses the fixed pinned
EG2 tokenizer without truncation before deterministic division of oversized spans.
The final model input must fit 8,192 tokens. Projection v3 and asset policy v1 are explicit document-identity inputs. A shared source span fans out to exact
unit-local citation ranges. Different contextual inputs cannot share a cached vector.
Changes, deletion, exclusion, new fragments and latest-snapshot changes invalidate
cross-fragment vectors; generation and every source dependency are revalidated before
commit. Cancellation and durable batch replay retain their owned-worker contracts.

Metadata, tool activity and generated material remain preserved and semantically
eligible by default. Lexical-only treatment is a counted proposal, not an automatic
coverage reduction. Broad hidden-trace exclusions remain unchanged and are recorded
as policy omissions rather than relaxed to improve coverage counts.

## Lexical discovery and source diversity

One versioned analyzer serves body/discovery indexes and query matching. It retains
whole Unicode/underscore identifiers and acronyms, adding camel/acronym/dictionary
aliases. Literal phrase and exclusion checks still use canonical original-text tokens.
Discovery snippets retain original metadata rather than analyzed text.

Dictionary selection uses explicit project-contained paths. Receipts distinguish
loaded and unavailable files, byte hashes, word counts, source languages and effective
content signatures. Recovered vocabulary extraction consumes guarded sanitized source
content, never wrapper JSON. EG2 token IDs and model vocabulary are unchanged.

Hybrid body search fuses lexical, metadata references and semantic ranks after local
body rehydration and privacy/role/date/path/snapshot checks. Default limits allow three
results per original and three per conversation; original grouping allows one per
original. Metadata-only fields remain lexical in auto mode. Exact citations and facets
remain distinct evidence even when diversity limits suppress repeated originals.
The persistent semantic adapter supplies no reranker: availability is reported and an
unavailable rerank request fails before a semantic callback/model invocation.

## Focused acceptance

Six initial integrated no-model checks passed on Windows Node 26.8.1 using the actual existing
better-sqlite3 13.0.3 N-API binding: archive structure, lexical analysis, hybrid source
diversity, redaction idempotence, structural runtime and production SQLite readiness.
Focused worker/scheduler/identity/cancellation/disconnect tests passed in their owning
lane. Lane taxonomy and scoped ESLint passed. Broad private-vault tests were not run
because they inspect ancestors outside the approved roots.

The structural runtime test uses a labeled mock encoder, proves one contextual source
encoding fans out to two exact transport citations, preserves older source text while
admitting only the current snapshot, and invalidates cached context after sibling hiding
or editing. This does not establish new-model relevance, throughput or full-index latency.

Private evidence: `archive-pipeline-audit-20261009/validation`, the count-only workload
receipts, corpus vocabulary readiness receipts and the preserved supplied source audit.
The intermediate count receipt that imported a changing helper is not a final baseline;
it remains preserved while the final paired plan uses frozen generators and source hashes.

## Ordered CPU qualification gate

The verified troublesome Swift target is `onevcat/Kingfisher`. It was in the historical
small set but is currently medium (44,207 observed code lines); historical logs show
SourceKit timeouts/degraded coverage despite exit zero. No existing checkout was found
inside the approved roots. The individual normal repository benchmark is distinct from
archive indexing and must use CPU real embeddings with judged retrieval/citation checks,
bounded owned-process supervision and explicit project-contained caches/resources.
The language wrapper adds seven unrelated guardrail measurements, so it is not the
scoped command unchanged. Existing normal-repository dependency/tooling/dictionary
readiness and cached MiniLM model qualification remain prerequisites; the normal model
is distinct from archive EG2. No historical checkout comparison is planned.

Finish the final count-only archive plan and current integration acceptance before that
normal repository run. Material coverage, relevance, dependency or workload failures
must be fixed/reported before a costly corpus job. The owner authorized this sequence;
no GPU/DirectML, new arbitrary software, or unrequested extra benchmark campaign is included.

## Exact count-only evidence

The final diagnostic used the fixed local EG2 tokenizer with no truncation or model
session. It reconstructs 20,388 contiguous runs from 20,386 representations of 18,008
original hashes. Five existing partial runs remain explicit gaps; none was bridged.
Original schema, row counts, size, mtime and SQLite SHA256 remained unchanged.

| Policy | Unique inputs | Actual prefixed tokens | Planned padded tokens | Planned attention proxy |
| --- | ---: | ---: | ---: | ---: |
| Frozen legacy 1000/200 | 345,299 | 124,674,572 | 143,321,648 | 70,460,737,336 |
| Initial structural v2 diagnosis | 579,662 | 164,223,438 | 180,313,350 | 80,273,222,830 |
| Final structural/context v3 diagnostic | 422,794 | 135,924,462 | 147,553,178 | 63,724,324,594 |

V3 metadata packing reduces JSON spans from 136,003 to 11,309 and occurrence tokens
from 10.25 million to 2.44 million. It retains semantic eligibility. Compared with
legacy, useful tokens increase 9.02%, planned padded tokens 2.95% and batches 22.44%,
while the attention proxy decreases 9.56%. Different deterministic scan orders and
input shapes affect packing; these are counts and scheduling estimates, not actual
throughput, new relevance results or a certified ETA. Largest final input: 1,054 tokens.
No final input exceeds 8,192 tokens.

The diagnostic asset overlay replaces five payload occurrences totaling 4,373,896
encoded characters in two retained runs. Candidate text is 289,514,137 UTF-16 characters
versus 293,887,026 retained legacy characters. This overlay is not original-catalog
reprojection and its changed coordinates are not treated as original citations.
The eight sources exceeding the former global span cap pass 24 first/middle/final
unit admission checks; per-unit intersection now precedes the span budget.

A separate vocabulary pass generated/loaded 1,366,675 recovered words and an effective
union of 1,366,684 words, including common/JavaScript/Python/TypeScript packs. Eleven
observed languages/formats have no corresponding selected pack. File hashes, loaded
counts and source signatures are recorded. This receipt used prior retained bodies;
its wordlist is blocked from current activation until asset-aware reprojection and
regeneration. Large-dictionary relevance and throughput remain unqualified.

Final count receipt SHA256:
`ac8cc5acd8f1db32fb2aff724217cb87e06409f6e6558ca38402e49fefdc0922`.
Original vocabulary receipt SHA256:
`c301ce39242c70be10dbcd21e726af8ecfdd5d0efa34cfa7985e154a43bbbd42`.

One further preparation concern was found without inference: per-unit rebuilding of
an entire multi-fragment source would amplify work (11.48 million characters × 2,871
fragments for the largest source). Bounded source-plan reuse is being implemented
before any costly corpus run; count-only input totals do not certify preparation speed.
