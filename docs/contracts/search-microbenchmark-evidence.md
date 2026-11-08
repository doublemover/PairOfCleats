# Search microbenchmark evidence

The search microbenchmark owners in `tools/bench/micro/` distinguish retrieval
work from result-cache replay. These measurements describe the selected fixture
and process. They do not establish release performance or native lifecycle
qualification. The source regressions introduced with this contract are authored
but unrun while backlog implementation is frontloaded.

## Work modes and query inputs

Both runners accept `--work-mode retrieval|result-cache`, defaulting to retrieval.
Retrieval bypasses result-cache lookup and persistence using a private in-process
symbol. It does not change quality, ranking weights or stored cache entries.
`--quality auto|fast|balanced|max` selects the same search policy in either mode;
without the flag the normal policy applies. Result-cache mode preserves normal
cache policy and records misses as unqualified cache-hit samples. It cannot turn
an unavailable or disabled cache into a successful cache experiment.

`--query` supplies one query. `--queries` captures an explicit text/JSON query file
through the shared admitted-input owner before any build. Its exact ordered
queries form an immutable cyclic schedule with a content identity. Limits are
4 MiB input/schedule bytes, 10,000 queries and 65,536 UTF-16 code units per query;
ill-formed Unicode and empty queries are rejected. A schedule retains duplicate
occurrences and resets its cursor at each measurement phase. Complete measured
cycles are necessary for comparison; an incomplete cycle remains visible and
incomparable. Help/preflight uses no measured sample and its explain query does
not prove that an ordinary result-cache entry has been primed.

The ordinary runner records initial, warmup and measured phases separately.
`initialMs` names the first observed call after index/SQLite handles are cleared;
the compatibility `coldMs` field contains that same value. Process/model state
is not reset and filesystem cache state is uncontrolled. Tinybench clears handles
before its task loop and separately records warmup/run observations. Neither
runner promises a cold filesystem, model or query-result cache.

## Observed work and resource ownership

Stats-enabled searches add version 1 `stats.work` diagnostics owned by the whole
search invocation. The existing query-embedding resolver counts requests, actual
query-embedding API calls and process-cache hits, including reuse of a pending
promise. An API call is not a native inference-kernel counter. Native computation
counts remain unknown. Four canonical modes bound the model observations. Actual
vector dimensions, provider/stub state, verified artifact digest or immutable
revision, and a hash of the canonical formatting/normalization/profile inputs
identify observed model work. Missing artifact evidence remains unqualified;
configured names alone cannot qualify a model.

Benchmark receipts also retain canonical execution outcome, selected generation,
score-policy identity, ordered output identity, result-cache state/strategy/hot
path, candidate stages and actual vector-provider result stages. Disabled ANN
stage labels and non-vector fallbacks cannot count as vector work. FTS selection
requires an observed FTS candidate stage. Cache-hit work requires zero retrieval
and embedding requests. Missing, partial, unavailable or conflicting work is
explicitly unqualified. Sparse and result-cache workloads label model inference
not applicable to the measured work rather than inventing a model identity.

Each phase conserves every call in aggregate counters and retains its first 64
sample receipts with an exact omitted count. Per-query controls detect drift.
Tinybench retains up to 10,000 raw samples in the report with an exact omitted
count. The timer encloses the search call; receipt projection runs afterward.
SQLite caches close through their existing disposal/lease owner before report
publication, including on failures. Cleanup failures preserve any primary error.

## Baseline admission

Tinybench writes version 2 `search-microbenchmark` reports. Before producing any
delta, the pure comparator checks exact query order, repository, selected mode,
generation, score mode/policy, output identity, cache work/strategy, effective
backend, model evidence and Node/ABI/platform/architecture/CPU identity. Measured
samples must have complete qualified work counts, complete query cycles and no
control drift. Unknown or malformed metrics are not measured zeros.

Code revision and dirty-source evidence remain separate provenance, allowing
before/after code experiments with the same controlled workload. Explicit
`--comparison-axis backend` permits only a storage-backend change and requires
both requested backends to be exercised while the remaining controls match.
The ordinary runner applies the same admission owner to its explicit ANN-provider
comparison. An unexercised provider or unknown model produces no speedup ratio.

Legacy reports remain readable historical input. Missing, malformed, unknown or
incompatible baselines yield structured `incomparable` reasons and no numeric
deltas. Comparison never overwrites a baseline; only explicit `--write-baseline`
writes one. Workload eligibility is separate from statistical qualification:
single-process results do not establish independent trials, confidence intervals
or a general production recommendation.

Coverage owners: `perf/tooling/bench/search-micro-evidence`,
`perf/tooling/bench/search-micro-baseline`,
`perf/tooling/bench/search-micro-runner`, and
`retrieval/cache/embedding-work-observation` in the ordered ci-lite lane.
