# SQLite FTS work qualification

The existing row cap bounds the eligible native candidate window. Native
tokenizer, Boolean and literal eligibility remain inside SQL before LIMIT.
Stable SQL ties use document ID; weighting and normalization still run across
the admitted qualified rows before final top-N selection.

The existing time allowance now governs cooperative dispatch of candidate SQL,
cursor steps, metadata hydration and term-membership queries. Chunk size controls
real qualification/hydration batches, clamped to the row cap. One cursor retains
the SQL ordering and is disposed on completion, limit, deadline, cancellation or
error. Term membership is accumulated across batches for the returned matcher.
An unfinished qualification batch does not contribute candidates.

This is a synchronous SQLite route. A step may scan/sort or execute a phrase
callback before returning. No JavaScript timer interrupts it. Receipts explicitly
report `mechanism: cooperative-dispatch`, `hardDeadline: false` and
`nativeInterruption: false`. Once a call overruns, no further budgeted dispatch
starts. Cleanup always runs. Pure bounded scoring can finish already qualified
rows. An overrun is measured, not hidden or called a hard latency bound.

Receipts include policy version, requested allowance, effective chunk size,
rows scanned/qualified, batches/cursor steps, termination, elapsed/overrun time
and SQL/metadata/term/scoring/cleanup phase measurements. Scoring and cleanup are
included in total observed time. Route/table/tokenizer preflight precedes this
allowance and is outside its declared scope. Counts describe emitted cursor rows,
not SQLite VM operations. A full row-cap window is conservatively truncated;
known exhausted allowed-ID scope can prove completion without probing another
row. A short array alone cannot prove dispatch completion.

Deadline termination is partial even when the result is empty or sparse fallback
finds hits. The shared retrieval execution owner records `sparse-budget` and
refuses query-cache admission. The cache policy identity includes this work
version, separating older report-only semantics. Query errors retain unavailable
diagnostics; cancellation and unconfirmed native disposal cannot become healthy
empty results. Defaults remain max(5000, 10 * topN), 150 ms and a chunk size at
most 512 (with the existing tail-latency profile overrides).

Pure injected-clock and tiny real SQLite fixtures cover dispatch boundaries,
actual batch sizes, weighted/Boolean/literal order, zero/one/multiple batches,
row caps, native errors, disposal and partial cache qualification. Measurement
acceptance remains serial Windows work; these contracts do not claim a measured
latency improvement or native cancellation capability.
