# Experimental bounded evidence-set selection

`evidenceSelection` is an optional context-pack request on CLI, HTTP and MCP.
The CLI takes one JSON string, for example
`--evidenceSelection '{"schemaVersion":1,"algorithm":"mmr"}'`.
It defaults absent and leaves existing context expansion and risk ranking alone.
The prototype requires an explicit single repository, graph candidates, an
[edit-safe file/function task](context-pack-tasks.md) and a pinned local
[exact rendered-token budget](context-token-budget.md). Federation and
exploration-only excerpts are rejected for this opt-in.

Candidate qualification happens after bounded graph assembly and existing
optional response admission. The mandatory primary remains intact. Only unique
chunk identities with verified current source hashes and the selected index
signature can supply optional intact units. Symbol/file references without a
unique chunk source, ambiguous chunk IDs, missing or changed source and units
that cannot fit are explicitly omitted. Aliases of the same file/span/hash
merge their graph roles into one source unit; identical-looking text in distinct
files remains distinct evidence. There is no source clipping or inferred patch
target. Unknown resource/lifetime failures propagate through their original owner.

The controls use the same immutable pool:

| Control | Objective |
| --- | --- |
| `top-k` | Existing-style role priority, then graph-distance relevance, then captured graph order. |
| `mmr` | `lambda * relevance - (1-lambda) * maximum selected lexical similarity`. |
| `role-coverage` | Greedy count of newly covered incident graph roles. |
| `facility-location` | Greedy improvement in summed maximum similarity to the eligible pool. |

Priority is call, usage, export, import, then unknown. Roles come exclusively
from actual incident `callGraph`, `usageGraph`, `exportGraph` and `importGraph`
edges retained in this request; unavailable edge families confer no role.
Relevance is `1/(1+distance)`; missing distance uses the captured rank, explicitly
retained as `distance: null`. Equal gains use priority, relevance, graph order,
then candidate ID. No locale-dependent tie or gold label enters selection.

Similarity is Jaccard overlap of at most 128 unique lowercase Unicode word
terms from the first 4,096 UTF-16 code units of complete source text. This is a
declared lexical heuristic, not embedding or semantic similarity. Empty and
unprepared features are reported separately. Empty sets have zero similarity,
including self-similarity. Missing role evidence remains in `unknownRoleIds`.
Coverage and completeness do not certify behavioral sufficiency.

| Limit | Default | Hard maximum |
| --- | ---: | ---: |
| `maxCandidates` | 16 | 64 |
| `maxSelected` | 4 | 16 |
| `maxPairwise` | 1,024 | 4,096 |
| `maxWorkUnits` | 65,536 | 262,144 |
| `maxWallClockMs` | 3,000 | 10,000 |
| `maxPoolBytes` | 262,144 | 524,288 |
| `maxMeasurements` | 64 | 128 |
| `lambda` | 0.5 | 1 |

All count/byte/work/time limits accept zero except measurements (minimum one
for the mandatory envelope). The optional selection deadline begins after that
mandatory exact measurement; source/parser and tokenizer operations have their
existing bounds. Work/deadlines are cooperative between bounded operations.
The complete tokenizer invocation, including all controls and cleanup, still
has its independent ten-second maximum and original queue/worker owner. A
tokenizer timeout or unknown count fails the request; it is not a partial success.

Pool bytes bound retained candidate entries. Features, pair memoization and
decisions have fixed cardinality bounds. Full source reads and parser heaps
retain the existing file/function limits; this is not a process-RSS ceiling.
The complete native and decorated CLI responses must each fit 128 KiB.

Every trial measures the actual final `context-text-v1` string, including the
fixed selector header and complete selected source units, using one captured
tokenizer profile/worker. Decisions, coverage, stop reasons, observations and
pool diagnostics are JSON metadata outside that exact text envelope. They are
still covered by payload identity and the independent response byte ceiling.
The returned `renderedContext` is the exact string covered by the receipt.
Token deltas are actual successive-envelope differences; they may be negative.
No additive approximation determines admission.

Resource-cap exhaustion returns an explicit partial prefix when exact counting
succeeded. Marginal gains, selected/deferred/omitted reasons, signed token
deltas, source identity, available/covered/missing roles and work counters remain
visible. If final JSON diagnostics exceed the response ceiling, whole optional
units are removed from the selected tail, reusing only a previously counted,
byte-identical rendered prefix. A mandatory envelope that cannot fit fails.
Cancellation and schema/lifetime failure prevent successful count publication.

Selector (`evidence-set-v1`), role (`graph-incident-v1`), similarity
(`source-prefix-terms-v1`), normalized policy, exact profile and rendered/payload
identities are explicit. Shared candidates never acquire query-specific scores.
There is no selected-result cache; the existing bounded scalar token cache
includes selector identities and publishes only after successful final admission.

The existing risk-pack evaluator accepts dataset cases with `evidenceControls:
true` and an explicit request policy with `maxMeasurements <= 32`. Its internal
comparison path qualifies one frozen source pool, runs all four controls through
one counter invocation and charges the same source work/time to each control.
All other policy and token limits remain equal. The report rejects changed pool,
profile, mandatory unit, versions or declared budgets. Source qualification is
shared; per-control elapsed time and before/after process memory are observations,
not isolated cold latency, peak RSS or worker-heap measurements.

Optional `expected.evidence.goldChunkUids` are post-hoc recall labels only.
Reports include heuristic role coverage, lexical redundancy, exact tokens, gains,
work and measured invocation observations. Real-model/task outcomes explicitly
remain unmeasured. Run comparisons serially at low and high token budgets.
Hand-enumerated complementary/redundant and relevance-favoring fixtures, actual
source/parser/worker and CLI/HTTP/MCP controls are authored; execution is pending.
Promotion requires passing bounded controls, original acceptance, representative
budget/quality comparisons and useful latency/memory evidence on one final source
identity. The prototype makes no default-ranking or model-quality claim.
