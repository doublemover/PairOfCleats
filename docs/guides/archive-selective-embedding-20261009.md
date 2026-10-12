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

The earlier trial used the same FP32 graph, requested CPU 4/1 threads and batch 8,
but 103 inputs / 24,484 tokens, mean 237.71 and 29.99% padding. Current mean length
is 40.8% higher. These are different content/shape distributions, not a matched
performance regression. Current captured worker CPU consumption is approximately
1.79 core equivalents over sampled native intervals, versus about four in the
prior trial. Effective thread pool/kernel dispatch was never measured. Lower
parallel utilization is observed; its cause remains unresolved. Kingfisher ended
19:39:12Z before current native inference started 20:21:54Z. The known service,
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

One matched JS normalization comparison (same 768-dimensional Float32Array, five samples of
2,000 calls) measured medians 140.445 ms before / 111.867 ms after, with exact array
agreement and invalid/zero/nonfinite guards. This is a local JS result, not a model
or whole-pipeline throughput claim. The initial operator heartbeat is cleared
before disposal now; its original file and failure log remain preserved. The
unexecuted resume operator already had this ordering. Both syntax checks pass.

## Missing anchor diagnosis

One newly captured query vector reproduced the authentic service top ten exactly.
The primary progress anchor inputs rank 103/114 by raw cosine; their units rank 24/22.
Those vectors were admitted and persisted. Transport-alias deduplication alone
cannot recover this anchor at top10. The secondary anchor inputs rank 132/144;
its unit ranks 3 through a higher-scoring different span at 32000-32807, which
intersects only seven anchor characters beyond the 600-character snippet.
Source-group recall 1.0, anchor-region recall 0.875 and frozen-pool input recall 0.8125
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

Actual selection: 255 groups /354 units /3,805 unique inputs /428,951 tokens;
all 51 observed kind/extension strata represented. This is 0.31556% of tokens,
0.89988% of unique inputs and0.40240% of units. A 0.5% token target was not filled
because the input budget reserves 423 further inputs beneath the strict 4,228-input
ceiling. Unit ceiling 879; token reserve ceiling 1,223,393 (0.9%). The three axes
must be enforced separately. Original lexical/discovery coverage and citations
remain complete. At that checkpoint the manifest was selected, not encoded or
activated. The bounded partial encoding below does not activate it.

Baseline denominators: 135,932,568 tokens /422,836 inputs /87,973 units. Token
budgets 0.1%/0.5%/1% are approximately 135,933/679,663/1,359,326 tokens. At the
sample's 270.8 useful tokens/s these imply roughly 8.4/41.8/83.7 minutes, with
workload uncertainty. One 32-token summary per unit already exceeds 2% of the token
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

Initial experiment plan: freeze independently judged held-out natural queries across exact
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
products for approximately 4,000 anchors before choosing ANN. Cross-encoder costs
require their own measurement. The bounded comparison below supplies partial
evidence; sub-1% quality remains a hypothesis. Widen only for evidenced misses.

Private evidence directory: `archive-current-policy-cpu-20261009`, including
`acceleration-breakdown.json`, `vector-copy-comparison.json`,
`progress-anchor-replay-receipt.json` and `semantic-anchor-selection-manifest.json`.

## Held-out comparison and bounded partial encoding

Fourteen new operator-authored questions were frozen before retrieval or inference:
12 answerable, two unanswerable and five rare-tail questions. Source choice used
fixed hashed order independent of anchor membership. This is a small operator
held-out protocol, not an externally independent benchmark; the prior eight
questions were not reused or tuned against. Exact source-SHA variant recall is
separate from answer-equivalent anchor recall. The latter requires the frozen
answer needle in an admitted unit, not necessarily its winning input or snippet.

Full-corpus lexical coverage remains intact. Strict AND retrieval preserves up to
100 candidates. Conservative expansion retains those candidates and adds OR
matches from up to six positive document-frequency-ranked analyzer aliases with a
fixed stopword list. GAR-inspired expansion adds actual lexical/source-adjacent
neighbors from five seeds, eight lexical neighbors and three same-source neighbors
per seed, bounded to 160 candidates. It has neither a corpus-wide document graph
nor the neural adaptive reranker used by published GAR. No framework was added.

One query-independent partial manifest slice selected 300 inputs /50,812 tokens /
265 referenced units. Three matching vectors were reused; 297 new inputs /49,997
exact document tokens were encoded once under the 50,000-token, 512-input,
600-second internal /660-second outer and 8 GiB bounds. Fourteen query vectors
were persisted; their document-wrapper measurement is a conservative 384-token
query budget upper bound, not an exact query-prefix token count. The full
3,805-input /428,951-token manifest was not encoded. The task-only vector database
contains 300 selected vectors; production still has 100 complete units /555 vectors /
589 occurrences across 87,973 lexical units. No production refresh ran.

### Measured quality

All values are means over the answerable queries; semantic-only rows exclude the
unsupported exact-path query (11 rather than 12 questions). Tail recall uses five
questions. The broader cached reference contains 1,265 compatible inputs from
biased earlier pools plus this slice; it is not a full-corpus dense reference.

| Mode | Candidate anchor recall | Exact-source recall@10 | Anchor recall@10 | Anchor MRR@10 | Tail anchor recall@10 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Strict lexical | 0.167 | 0.167 | 0.167 | 0.125 | 0.000 |
| Expanded lexical | 0.917 | 0.500 | 0.583 | 0.362 | 0.400 |
| Cheap graph expansion | 0.917 | 0.500 | 0.583 | 0.362 | 0.400 |
| Selected semantic, 300 inputs | 0.182 | 0.182 | 0.182 | 0.182 | 0.400 |
| Broader cached semantic | 0.273 | 0.273 | 0.273 | 0.273 | 0.600 |
| Strict + selected RRF | 0.333 | 0.333 | 0.333 | 0.229 | 0.400 |
| Expanded + selected RRF | 0.875 | 0.583 | 0.667 | 0.363 | 0.600 |
| Graph + selected RRF | 0.875 | 0.583 | 0.667 | 0.363 | 0.600 |

Binary anchor nDCG@10 is 0.435 for expanded/graph fusion, 0.255 for strict fusion
and 0.182/0.273 for the two semantic pools under this operator protocol. Fusion
caps each ranked input list at 100, losing one half of a judged cross-source
candidate compared with expanded lexical; this loss was retained in the results.
The exact original target unit is in the full prepared manifest for only two of
12 answerable questions (the two RNS header questions). Equivalent answer variants
can still be admitted, so this is an exact-target admission limit, not a logical
answer-coverage upper bound. Partial inference cannot resolve excluded targets.

Expanded fusion's per-class anchor recall@10: exact-symbol, dependency,
implementation, exact-path, rare-exact, rare-conceptual, rare-shell and history-version
1.0 each; conceptual 0.0; rare-implementation 0.0 across two questions; cross-source
0.0. The small class counts prevent broad generalization. Cheap graph expansion
added no judged recall gain. Selected vectors offer a modest complementary gain
over expanded lexical (0.583 to 0.667, tail 0.4 to 0.6), while semantic alone is
weak. This does not establish a production replacement for broader coverage.
Both unanswerables return zero strict candidates but irrelevant expansion, graph,
semantic and fusion candidates. No answer-generation or calibrated abstention was
measured. All cited unit/snapshot pairs validated; source-version correctness still
requires the separate exact-source metric.

### Span recovery through the existing guarded context API

Winning-input and displayed 600-character anchor recall are zero in the semantic
and fusion measurements. Lexical input recall is inapplicable. Expanded lexical's
displayed-anchor recall is 0.083, despite unit anchor recall 0.583. Unit recall is
therefore insufficient evidence that the returned snippet answers the question.

A bounded follow-through used `readVisibleContext` for each existing top-ten hit:
`before: 0`, `after: 0`, `top: 1`, `messageChars: 4000`. The cap is ten hits /
40,000 UTF-16 characters per query. No ranks changed, no query-aware target was
inserted, no inference ran, and existing visibility/snapshot/privacy guards remained
in force. Expanded fusion context recovers anchor recall 0.667 /tail 0.6; expanded
lexical recovers 0.583 /tail 0.4. Selected/broader semantic recover 0.182/0.273.
Context adds roughly 11 ms median per query in this task (first/repeated application
reads, not OS cache cold).

The historical secondary progress hit at unit rank 3 is independently recovered:
its chosen input covers source 32000-32807 and overlaps the frozen anchor
32800-33800 by seven characters, none within the displayed 600 characters. The
existing 4,000-character context returns the complete original anchor with matching
SHA256 `2fe60e05f31de96adeb56885b5a20a885f7bf758ca6f66c892f9baf6dce76b8b`.
This supplies an evidence-recovery route for an admitted unit without falsely
attributing the answer to its higher-cosine input. Production snippet selection was
not changed. The primary progress inputs remain ranks 103/114 and units 22/24;
context over top ten cannot recover an absent candidate. Candidate admission or
reranking requires separate evidence before promotion.

### Latency and CPU diagnosis

Application first/repeated queries were measured in one process; these are not OS
page-cache-cold runs. Stages below are incremental, so graph and expansion costs
must be added to lexical retrieval rather than hidden behind dot-product time.

| Stage | First median /p95 ms | Repeated median /p95 ms |
| --- | ---: | ---: |
| Strict lexical | 3.736 /3420.308 | 3.454 /574.785 |
| Alias expansion | 436.915 /1028.939 | 352.971 /1357.508 |
| Cheap graph expansion | 108.540 /321.056 | 41.935 /91.501 |
| Exhaustive 300-input scoring | 0.645 /114.640 | 0.654 /33.475 |
| Exhaustive 1,265-input scoring | 2.321 /108.448 | 2.206 /7.166 |
| Expanded-fusion context | 11.446 /15.871 | 10.790 /11.407 |

The scoring first-call outlier includes JIT/unit hydration. No approximately
4,000-input scoring experiment or ANN comparison ran; extrapolation is not proof.

The partial encoding took 88.368 seconds wall: query encoding 2.408 seconds,
parent preparation 0.435, document encoding 83.806 and persistence 0.206. Actual
native inference totals 84.152 seconds across 52 finished calls (14 queries and
38 document batches); worker tokenizer preparation is 0.432, tensor assembly 0.002
and output processing 0.105 seconds. Native inference remains the dominant cost.
Sampled peak RSS was 2,196,668,416 bytes. Cooperative worker exit was confirmed.

The task-owned worker consumed 3.224 core equivalents from sampled process CPU,
with CPU FP32 and requested intra-op 4 /inter-op 1 /sequential execution unchanged.
Effective native thread-pool size and kernel execution remain unreported. The prior
qualification consumed about 1.79 core equivalents. Inputs are unmatched: current
mean 168.34 tokens versus prior 334.72, current median 142 /p90 341 /p95 498 /max550.
Saved batch reconciliation yields 49,997 useful /57,078 padded tokens (12.406% padding)
and 15,898,964 attention work. Known earlier native work did not overlap; other
machine contention was not recorded. These figures do not prove a thread fix or
matched speedup. No global setting, tuning grid or further inference campaign ran.

### Receipts and remaining scope

Private evidence lives in `archive-current-policy-cpu-20261009/selective-heldout-20261009`.
The immutable checkpoint/source receipts are retained. SHA256:

| Receipt | SHA256 |
| --- | --- |
| `heldout-judgments.json` | `543b4aea311a7ad2b3fc52efaa97f326519cd364dfc70f5bdc536c680bab7531` |
| `lexical-graph-receipt.json` | `5eef0f771f443679133f5077cceb19d370cc05634e6d3375808b6a2b422fe897` |
| `inference-receipt.json` | `70f94175d87cbba26db5969ee9411465dcdda517afdb42b811d1da9f84f9beee` |
| `selective-comparison-receipt.json` | `f12a8b6af94032d2b41f13f7fb47d9d91d242a3c1f76f51ef6e91f0534e93918` |
| `context-expansion-receipt.json` | `31c18fbee2b45d0a90bf5b8db8bb9c358edbbf63588a819cfdba994e679c6f0b` |
| `saved-diagnostics-receipt.json` | `9edff3650c6a70b51f251d44b8e898f39c47093299cb01d0546f0a42cd3d3640` |

Whole-manifest inference, a matched stratified-random anchor comparison,
external judgments, full-corpus dense reference, neural cross-encoder costs,
calibrated abstention and production selector/update-invalidation qualification
remain unmeasured. Do not activate the prototype or resume full-corpus inference
from these small results. Completed checks and measurements were reused; this
continuation added bounded context reads and saved-data reconciliation only.
