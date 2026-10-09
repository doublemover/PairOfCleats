# Archive acceleration and selective-embedding experiment - 2026-10-09

Full-corpus inference remains stopped. The 100-unit / 555-vector durable checkpoint
is preserved. This continuation used captured receipts, three affected no-model
checks, one small JS comparison and one query-only CPU replay. No document inputs
were re-encoded, no corpus copy or new worktree was created.

## Measured bottleneck

Authentic service admission: 296 unique inputs / 99,077 useful tokens / 48 units.
Actual lengths: min 74, median 373, p90 415, p95 435, max 557; mean 334.72.
Twenty inputs are at most 128 tokens, 38 are 129-256, 236 are 257-512 and two
are 513-557. Forty actual batches have 106,440 padded tokens (6.92% padding).

| Captured stage | Seconds | Scope |
| --- | ---: | --- |
| Service wall | 365.840 | Authentic admission through persisted result |
| Native inference | 348.892 | 95.37% of service wall |
| Parent encode | 350.041 | Includes native; not additive to it |
| Parent prepare | 5.356 | Includes worker preparation/IPC |
| Worker tokenizer | 1.422 | Subset of preparation |
| Transaction publication | 0.839 | Recorded SQLite transaction interval |
| Unattributed remainder | 9.604 | Startup/source/status/check overhead; not separately timed |

Assembly/output cost only 0.0116/0.0579 seconds. Statement and copy optimization
cannot remove the dominant native inference bill. The 139.4-hour token-linear
extrapolation is workload-dependent, not a commitment to embed the complete corpus.

The earlier trial used the same FP32 graph, requested CPU 4/1 threads and batch8,
but 103 inputs / 24,484 tokens, mean237.71 and 29.99% padding. Current mean length
is 40.8% higher. These are different content/shape distributions, not a matched
performance regression. Current captured worker CPU consumption is approximately
1.79 core equivalents over sampled native intervals, versus about four in the
prior trial. Effective thread pool/kernel dispatch was never measured. Lower
parallel utilization is observed; its cause remains unresolved. Kingfisher ended
19:39:12Z before current native inference started20:21:54Z. The known service,
frozen, cancellation and replay jobs were sequential; other machine contention
was not recorded and cannot be claimed or excluded.

## Implemented bounded improvements and correctness

Generation metadata statements are reused per database through a WeakMap, but
values are read again on every guard; stale edits/generation changes still reject
publication. Semantic search also reuses its parameterized query statement.
Normalization removes one validation copy, and query truncation uses a Float32
subarray instead of two array copies. Numeric operation order and output remain
unchanged. Three affected no-model tests and scoped lint passed. The scheduler
fixture asserts one prepared generation statement across live checks and retains
its stale-generation/cancellation/privacy checks.

One matched JS normalization comparison (same768d Float32Array, five samples of
2,000 calls) measured medians140.445ms before /111.867ms after, with exact array
agreement and invalid/zero/nonfinite guards. This is a local JS result, not a model
or whole-pipeline throughput claim. The initial operator heartbeat is cleared
before disposal now; its original file and failure log remain preserved. The
unexecuted resume operator already had this ordering. Both syntax checks pass.

## Missing anchor diagnosis

One newly captured query vector reproduced the authentic service top ten exactly.
The primary progress anchor inputs rank103/114 by raw cosine; their units rank24/22.
Those vectors were admitted and persisted. Transport-alias deduplication alone
cannot recover this anchor at top10. The secondary anchor inputs rank132/144;
its unit ranks3 through a higher-scoring different span at32000-32807, which
intersects only seven anchor characters beyond the600-character snippet.
Source-group recall1.0, anchor-region recall0.875 and frozen-pool input recall0.8125
therefore remain separate measurements. The frozen pool's perfect anchor coverage
is not authentic-path quality. Query and document vectors now support future
read-only counterfactual replay; no corpus model rerun is needed for this diagnosis.

## Deterministic selection prototype

Private `semantic-anchor-selection-manifest.json` uses existing source-group
metadata and exact full-prefixed tokenizer counts. Rare kind/extension strata
receive initial coverage, then path-based explanation signals and encoder cost
prioritize complete bounded source groups. Exact input hashes deduplicate globally
once; source/unit/snapshot/range aliases remain attached. No evaluation query,
judgment or embedding score was used to select anchors. This heuristic is not
proof that a heading, docstring or rare extension benefits most from embeddings.

Actual selection:255 groups /354 units /3,805 unique inputs /428,951 tokens;
all51 observed kind/extension strata represented. This is0.31556% of tokens,
0.89988% of unique inputs and0.40240% of units. A0.5% token target was not filled
because the input budget reserves423 further inputs beneath the strict4,228-input
ceiling. Unit ceiling879; token reserve ceiling1,223,393 (0.9%). The three axes
must be enforced separately. Original lexical/discovery coverage and citations
remain complete. The manifest is selected, not encoded or activated.

Baseline denominators:135,932,568 tokens /422,836 inputs /87,973 units. Token
budgets0.1%/0.5%/1% are approximately135,933/679,663/1,359,326 tokens. At the
sample's270.8 useful tokens/s these imply roughly8.4/41.8/83.7 minutes, with
workload uncertainty. One32-token summary per unit already exceeds2% of the token
baseline before prefixes. Existing dedup savings cannot be counted again.

## Code hooks and next bounded experiment

`archive-unit-spans.js` supplies exact full-input/source-local links;
`document-input.js` and the document identity fence define canonical hashes.
`persistent-semantic-index.js` currently admits pending source groups in SQL order:
maxUnits is a batch bound, not a quality selector. A manifest selector needs explicit
source/generation/identity validation and separate budget/status accounting before
production activation. Changing group admission must retain sibling revalidation,
visible-source authorization and every occurrence citation. No such public API was
silently added in this continuation.

`reader.js`/`query.js` search the full lexical corpus;
`lexical-analyzer.js` preserves identifier/acronym/Unicode aliases.
`hybrid.js` performs independent semantic candidate retrieval, metadata authorization
and fusion; `ranking.js` enforces source diversity and reranker containment.
Existing same-source spans, snapshot/ancestry links and repository symbol relations
are useful expansion signals, not an already-built BM25 similarity-neighbor graph.
A bounded expansion must add actual candidates before reranking; the current rerank
hook may reorder supplied evidence only, and no local cross-encoder is configured.

GAR demonstrates BM25-initial retrieval with a BM25-built neighbor graph and neural
adaptive reranking without offline dense corpus embeddings. Its reported results
justify a competing experiment, not a PoC latency/quality claim. Use existing
lexical/structural primitives; do not import PyTerrier or a new framework.
[Primary paper](https://arxiv.org/pdf/2208.08942),
[reference API](https://pyterrier.readthedocs.io/en/latest/ext/pyterrier-adaptive/index.html).

Next action: freeze independently judged held-out natural queries across exact
symbols/errors/paths, conceptual paraphrases, implementation/dependencies,
history/version, cross-source, rare/minority and unanswerable strata. Do not derive
all queries from selected anchors or tune against the prior eight queries. Compare
full lexical, conservative query alias expansion, bounded candidate reranking,
lexical-neighbor GAR, stratified-random anchors and proposed anchors at explicit
budgets. Preserve exact-query candidates. Use the existing small dense reference
only in its actual scope; full-corpus dense reference is unavailable.

Report candidate/final recall, MRR/nDCG, tail strata, input/source/anchor recall,
citation validity, cold/warm latency, RSS, graph/preparation/native/persistence
costs and update invalidation. On-demand encoding needs cumulative unique-token
and latency bounds, including evicted/recomputed inputs. Benchmark exhaustive dot
products for approximately4,000 anchors before choosing ANN. Cross-encoder costs
require their own measurement. No held-out comparison or selection inference ran
here; sub-1% quality remains a hypothesis. Widen only for evidenced misses.

Private evidence directory: `archive-current-policy-cpu-20261009`, including
`acceleration-breakdown.json`, `vector-copy-comparison.json`,
`progress-anchor-replay-receipt.json` and `semantic-anchor-selection-manifest.json`.
