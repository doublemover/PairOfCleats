# Bounded index producer work

These implementation notes describe resource and parity contracts. They are not
benchmark results or runtime acceptance evidence.

Sparse binary writers use bounded data and sidecar blocks, preserve exact codec
bytes, complete positive short writes, and keep existing fsync/publication owners.
The packed writer records its digest while consuming encoded blocks. Generic JSON
traversal batches punctuation and scalar output, awaits actual backpressure and
cooperative yields, and never splits a UTF-16 surrogate pair across UTF-8 writes.
Compression processes start on demand; gzip does not create unused workers.

A process-pool submission starts only missing idle/initializing capacity. Ready
children run independently, while reservations remain held until confirmed child
termination. Producer-capacity waits subscribe to settlement-owned notifications,
not repeatedly to every outstanding task; byte/count caps and callback settlement
remain the release authority. Pressure telemetry selects one deterministic victim
without sorting its full cache for each ordinary overflow.

Structural match enrichment uses a file-owned interval index preserving original
match order and inclusive overlap for arbitrary query order. Lexicon filtering
uses constant-size category membership views rather than copied token sets.
Token MinHash updates once per distinct token while IDs, multiplicity, order and
frequency statistics retain their existing meaning. Symbol cache overflow evicts
LRU capacity independently of insertion-time expiry; fresh overflow does not scan
the full cache. SQLite vocabulary caches incrementally evict persisted LRU entries
after flushing pending identities, preserving SQL-backed IDs across cap crossings.

Discovery canonicalizes candidates through bounded asynchronous stat workers and
still requires real-root containment. Deferred queue claims build one running-job
alias lookup while holding the existing claim locks. Alias matching remains direct
and queue ordered; it does not turn transitive identity groups into duplicates.

Qualification must compare exact artifacts, identities, coverage and failures,
then report raw worker starts, byte/read/write counts, CPU, peak retained memory
and supported-platform timings. Cancellation, corruption and teardown failures
remain required controls. No bounds, coverage checks or performance verdict
thresholds are raised by these implementation changes.
