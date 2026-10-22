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

Governance refresh owns one immutable discovery/input snapshot. Manifest generation,
evidence, taxonomy and audit share physical/logical case discovery and source
order/timing text while retaining their independent parsers and comparisons.
Generated manifests are captured only after writing; comparisons still use the
authoritative order IDs independently. A fresh refresh discovers source, rules and
case-sidecar changes again. Shared-module ledgers likewise inventory the union of
approved roots once per generation, derive boundary-aware subsets, and retain
independent fresh inventories for reproducibility generations. Explicit root files
authorize only themselves, never a recursive parent walk.

## Ordered source contracts

JSONL byte hints never control output lengths: encoded row bytes plus the newline own batching. Ignore files are ordered rule programs; repeated rules are retained and canonical parser whitespace/escape semantics are preserved. Generated ancestor traversal openings retain preceding child exclusions so selected descendants do not admit siblings.

PDF EOL flags terminate their own item, including empty markers. DOCX text/separator tokens remain in source order across styled runs; both extraction backends obtain physical paragraph ordinals and direct paragraph styles from the same bounded XML owner. Custom/inherited Word styles are retained as source style IDs rather than invented heading levels.

## Selected roots and evaluation receipts

Validation, stats and health capture published mode roots once. Explicit validation roots discover their own declared/present modes, including declared missing artifacts, independently of the current pointer. Stats exposes per-mode provenance; combined build/config fields are null for mixed generations. Health checks selected file families and recorded backend capabilities, distinguishing not-built/not-selected/unknown from a broken ready backend; zero-state waivers use the existing independent proof validator.

Setup forwards the explicit target repository to restore and all indexing stages. Huge-repository profile resolution reads only the canonical indexing.hugeRepoProfile path. Its leaf overrides supply defaults, with explicit repository leaf values taking precedence.

Evaluation uses canonical search mode expansion and independent ranking cohorts. Combined-mode judgments must name their mode; ambiguous unqualified judgments are refused before search. Metrics are macro means of judged cohorts and judged cases; unjudged cohorts remain null. Scores from separate lists are never concatenated into an invented global rank. Bakeoff resume identity version 2 binds canonical dataset content, query bytes, matching/metric producer sources, repository identity, and per-model selected generation manifests/index-state. Missing inputs fail before resume; old receipts cannot authorize reuse.

Benchmark waivers require an explicit supported schema, unique ID, owner, justification, finite expiry and exact failure/diagnostic scope. One invalid row invalidates the complete policy. Run watchdog interruption is terminal evidence before termination; a zero exit or retry cannot erase it. All controls here are authored and unexecuted.
