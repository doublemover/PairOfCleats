# Experimental count-aware stored-vector routing

`createSearchPipeline` accepts an optional programmatic `countAwareAnnPolicy`.
It requires independent vector discovery and explicit `exactRows`,
`coordinateWork`, `maxAttempts`, `requestedHitWork`, `maxTopN` and `maxMs` values.
No tuned threshold/default, CLI/config knob or automatic production route change
is introduced. Absolute admission bounds are 512 exact rows, 8 Mi coordinate
work, four total provider attempts, 16,384 requested hits, a 4,096 per-attempt
limit and a 2,000 ms cooperative deadline. These are containment bounds, with no
latency, memory or quality acceptance implied.

Eligible cardinality comes from the authoritative Boolean/phrase/filter ID domain,
or the selected document domain when no such constraint exists. Lexical candidate
count is never an input. An unsupported/missing cardinality remains null; an
explicit empty domain is zero. The existing pipeline may return an empty filter
result before reaching the vector stage. Within the ANN stage a proved empty
domain performs no provider or model work.

A small eligible domain can select exhaustive stored-vector scoring only when
the selected dense payload is already loaded. The planner does not authorize a
whole-corpus lazy load because a filter happens to be small. Exact admission
requires complete ordinal coverage, declared affine uint8 dimensions/range/levels,
consistent scale and valid selected row shapes/values. A bounded snapshot copies
only eligible vectors and retains original ordinal mappings and tie order.
Explicit absent channels stay absent. Incompatible or unknown coverage and
quantization fall back to ANN rather than gaining an exact label.

The temporary scalar owner calls the existing dense ranker. Its completed result
is exact for that declared stored affine uint8 dot-product representation and
reports vectors/coordinates scored and unscorable eligible rows. It does not
establish original-FP32 or another backend metric's exactness. Loaded artifact
validation, provider preflight/model acquisition and upstream generation admission
remain their existing owners; the route receipt does not relabel them as measured
per-query work.

The normal provider owner adopts one shared attempt/requested-effort/deadline
ledger. Only a provider explicitly declaring progressive effort can retry an
underfilled window, and retries increase top-N within the same eligible domain.
Returned IDs are bounded/deduplicated and checked against the domain; hard
constraints remain authoritative in the production final rank gate as well.
Duplicate source rows cannot count as output fill. Output fill never certifies
ANN recall. Missing capability, work exhaustion and underfill retain approximate
or unknown completion metadata; this opt-in vector experiment does not substitute
MinHash results for unavailable vector scoring.

The capability metadata describes candidate pushdown versus postfiltering,
stored exhaustive scoring, progressive effort, cancellation and score space.
Native internal work is explicitly unknown. Requested top-N is a bounded effort
control, not proof of an internal native-work or hard wall-clock bound. A native
call that ignores cancellation is awaited to settlement by the existing backend
lifetime; the planner cannot preempt it or release its resources early. Caller
cancellation propagates, and planner deadline expiration does not mark a healthy
provider failed. Exact deadline interruption publishes no partial exact heap.

The actual LanceDB owner now receives the existing request signal, checks it
between candidate-ID partitions and count/query calls, and cooperatively checks
materialized source rows, including excluded rows. In-flight native calls remain
awaited until settlement before lease release; cancellation cannot publish a
partial result or poison provider health. Per-partition projected hits enter the
existing shared top-k reducer immediately rather than accumulating every batch's
top-N rows and a second full hit projection. Returned IDs are checked against the
original eligible domain even when the native builder accepted a predicate.
This bounds the retained result heap
by requested N; candidate-ID admission and native result materialization retain
their existing bounds and the no-pushdown path still requests a complete table
scan for filtering correctness. No native memory or speedup claim follows.

The stage receipt includes versioned policy key, route/reason, actual known count,
provider attempts, requested effort, stored scalar work, omissions and exactness.
There is no new result cache or automatic replay activation. Programmatic callers
that persist their own outputs must include the policy key alongside existing
query/filter/model/generation identity. This opt-in cannot be promoted through
shared CLI/query caches until those public request identities explicitly carry it.

Authored regressions cover null/zero counts, copied source ordinals, missing
channels, invalid representations, actual pipeline exact dispatch and bounded
underfill attempts with an inert provider. They have not run. Independent #1119
oracle comparisons, filter-correlation recall, native deadline/retained-memory
behavior and representative cost/quality evidence remain separately scoped.
