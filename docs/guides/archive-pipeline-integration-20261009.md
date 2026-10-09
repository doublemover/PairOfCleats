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
invented. Reconstruction is bounded to 5,000 fragments and 16,777,216 UTF-16 characters.

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

Seven final integrated no-model checks passed on Windows Node 26.8.1 using the actual existing
better-sqlite3 13.0.3 N-API binding: archive structure, lexical analysis, hybrid source
diversity, redaction idempotence, structural runtime, embedded assets and production SQLite readiness.
Focused worker/scheduler/identity/cancellation/disconnect tests passed in their owning
lane. Lane taxonomy and scoped ESLint passed. Broad private-vault tests were not run
because they inspect ancestors outside the approved roots.

The structural runtime test uses a labeled mock encoder, proves one contextual source
encoding fans out to two exact transport citations, preserves older source text while
admitting only the current snapshot, and invalidates cached context after sibling hiding
or editing. This does not establish new-model relevance, throughput or full-index latency.

Private evidence: `archive-pipeline-audit-20261009/validation-final-v3` (all seven passed), preserved initial `validation`, the count-only workload
receipts, corpus vocabulary readiness receipts and the preserved supplied source audit.
The intermediate count receipt that imported a changing helper is not a final baseline;
it remains preserved while the final paired plan uses frozen generators and source hashes.

## Ordered CPU qualification gate

The verified troublesome Swift target is `onevcat/Kingfisher`. One canonical current
checkout benchmark completed with actual CPU embeddings and production dictionaries;
[exact evidence and limits](kingfisher-cpu-verification-20261009.md) records the
source/model identities, valid persisted vectors and declared sparse-only retrieval
misses. Missing optional SourceKit is explicit degraded coverage. No historical
checkout comparison or unrelated language-wrapper measurements ran.

Fresh original-catalog reprojection now contains 87,973 records across 89 shards,
289,530,708 sanitized UTF-16 characters and 20,390 complete groups, with zero gaps
or conflicts and 614 explicit omission receipts. Current regenerated vocabulary
loads 1,675,434 effective words from corpus identifiers and actual pinned English.
The earlier tiny synthetic packs are excluded. Original sources remain authoritative.

Production derivative import/persistence verification and exact current EG2 token
counts are the next gates. The frozen diagnostic overlay below differs from this
fresh derivative and cannot establish its exact workload or ETA. Qualify actual
current-policy archive relevance, citations, preparation/throughput and scheduling
before the recovered-corpus sequence. Fix/report material failures first. This is
CPU only; no GPU/DirectML, arbitrary software or extra benchmark campaign is implied.

## Fresh production derivative and exact current plan

One production import completed using actual better-sqlite3 13.0.3 / SQLite 3.53.4.
The new derivative contains 87,973 units, records and snapshots in 89 imports;
discovery has 87,973 rows. Native integrity/foreign-key checks, lexical/context and
preserved-original metadata checks passed. Close/reopen retained identical source
and snapshot references and analyzer identity. Original full SHA256, size, mtime,
schema and row-count guards are unchanged. No embeddings or model were loaded.

Captured config-write to final-receipt wall time is 881.66 seconds. The coarse
855.10-second internal marker includes import, discovery and verification; exact
internal stage times were not captured and are not reconstructed.

A single current-policy count pass used the actual production source planner,
unit intersections and complete document prefixes. It covers 20,390 groups and
289,530,708 sanitized UTF-16 characters with no semantic exclusions or gaps:

- 448,784 source spans; 335,158,500 span characters (15.76% overlap).
- 512,831 unit-span occurrences; 422,836 unique complete prefixed inputs.
- 135,932,568 useful tokens; maximum 1,054 tokens; none exceeds 8,192.
- Batch4/lookahead32: 105,709 planned batches, 141,957,164 padded tokens,
  4.24395% padding fraction and attention proxy 60,262,060,452.
- Batch8/lookahead32: 52,855 planned batches, 149,388,420 padded tokens,
  9.00729% padding fraction and attention proxy 65,387,807,652.

Count preparation took 38.194 seconds: 422,787 hash-verified cache hits and
49 new inputs in one actual tokenizer call (0.186 seconds). Cache reuse/counting
is not native model throughput. Scheduling figures describe this traversal and
input packing, not inference time or kernel work. The older frozen overlay below
is preserved diagnostic evidence; it is not the current derivative's exact plan.

Private `archive-derivative-v3-20261009/production-import-receipt.json` SHA256:
`bfb7247108dcff8adc5ad3cc63edd378f84678d1928825bc60f958bd497a8b2a`.
Private `current-token-plan.json` SHA256:
`be2315f77813573046f0b9001a49adf04e224e9040afcd1b2a770ff2f56856a2`.
Current-policy representative CPU qualification is the next inference gate.

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
union of 1,366,684 words, including tiny synthetic common/JavaScript/Python/TypeScript fixture packs. Eleven
observed languages/formats have no corresponding selected pack. File hashes, loaded
counts and source signatures are recorded. This receipt used prior retained bodies;
its wordlist is blocked from current activation until asset-aware reprojection and
regeneration. Large-dictionary relevance and throughput remain unqualified.

Final count receipt SHA256:
`ac8cc5acd8f1db32fb2aff724217cb87e06409f6e6558ca38402e49fefdc0922`.
Original vocabulary receipt SHA256:
`c301ce39242c70be10dbcd21e726af8ecfdd5d0efa34cfa7985e154a43bbbd42`.

Per-unit rebuilding of an entire multi-fragment source would amplify preparation
(11.48 million characters x 2,871 fragments for the largest source). Admission now
uses a deterministic indexed source-group cursor and retains only the current group's
immutable plan. Limits are 65,536 spans and 67,108,864 contextual UTF-16 input characters,
in addition to 5,000 fragments and 16,777,216 source characters. Pathological overlap
fails explicitly before excessive allocation. There is no unbounded all-source cache.
The plan is discarded on group exit and refresh completion; source/generation/config
checks retain stale-result guards.

Dependencies are hashed once per group and each distinct sibling is rechecked once
per transaction before commit. Edited or hidden siblings reject stale outputs and
force a fresh plan on the next refresh. No-model fixtures prove one sibling query,
reconstruction and structural parse per group, exact first/middle/final large-source
ranges, privacy/edit invalidation, newline-splitting equivalence and overlap limits.
The prefix-wide newline search is now bounded to its active window. These checks
establish correctness and bounded reuse, not measured preparation speed. Transactional
dependency revalidation and current-policy throughput remain real-workload gates.

Local closeout repaired generated search-contract drift and active-roadmap size,
preserving completed transcripts in a linked archive. Generator side effects from the
incomplete normal runtime were saved privately; only files proven clean beforehand
were restored. Command-surface and generated-freshness checks passed. This does not
certify a complete normal-repository runtime or hosted CI.
