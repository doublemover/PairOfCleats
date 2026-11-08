# Throughput numeric observations

Numeric comparison and workload qualification are separate. A `compared` ledger
status means that numeric current/baseline values support a percent calculation;
it does not establish compatible workloads, independent attempts or runtime
equivalence. Those admissions remain required before performance acceptance.

Ledger comparison consumes finite nonnegative JSON numbers. Zero is observed;
null, absent, string, boolean, negative and nonfinite values are unavailable.
Missing modes/stages stay visible when another cohort member measured them.
The ledger deliberately has no per-stage throughput counters today: an entirely
unobserved non-total metric does not become a failed stage measurement.

A measured zero rate against a positive median is a -100% regression. A zero
baseline median produces a separate `zeroBaselines` observation with signed
absolute delta, `deltaPct: null`, and `both-zero` or `zero-baseline` outcome.
It produces no invented infinity or percentage classification. Existing median,
distribution, confidence, direction and threshold rules remain.

Per-metric states are `compared`, `partial`, `unavailable`, `zero-baseline` or
`no-baseline`. Current availability, missing/zero baseline counts and exclusion
counts remain explicit. Exclusion and zero-baseline detail each retain at most
16 rows; aggregate counts retain the full observed extent. Missing baseline
members cannot silently count as complete samples. JSON and human overview
summaries expose these states; unavailable repo fields/severity remain null.

Feature-metrics and throughput-derived indexing summaries use the existing scan
observation/coverage owner. Counts require nonnegative safe integers; clocks
require finite nonnegative numbers. Whole totals/rates need all declared modes.
Partial matched-subset rates retain their own numerator, clock and excluded
modes in coverage rather than borrowing unrelated time. Empty measured work is
distinct from unknown work. Diagnostic derivation version 3 invalidates older
derived summaries/ledgers without altering native artifact authority.

This is implemented source with unexecuted regression coverage. Compatible
workload/attempt admission, actual serial measurements and historical temporal
qualification retain their separate owners.
