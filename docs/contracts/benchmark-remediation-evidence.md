# Benchmark remediation evidence

The language report's version 2 `remediation` surface retains availability
diagnostics and an explicitly unaccepted inspection loop. `hitRate` and the
legacy `bestHitRate` display field mean nonempty-result frequency. They do not
measure relevance or recall. The best backend never qualifies another backend
or removes its misses from inspection.

The benchmark records version 1 `queryOutcomeEvidence` for actual selected
primary-mode searches, grouped by backend, mode and query stratum. The current
backend key denotes the benchmark invocation; effective backend observations and
unknown-backend counts remain separate, so a fallback cannot borrow its requested
backend's identity. The default stratum is explicitly unclassified. The current
throughput query-file contract supplies no relevance labels, so those searches
have unknown expectations. It does not infer expected positives from a query
string or synthesize expected negatives from empty output. An internal collector
also supports explicit canonical evaluation judgments: positive target matching
uses the existing distinct-document evaluation owner; an explicit empty judgment
array denotes an expected-negative control. No new CLI/config input is added.

Known positives, expected negatives, unknown expectations and unavailable
responses have separate conserved counts. Finding an arbitrary irrelevant hit
can improve nonempty frequency but cannot improve positive-target success.
Target-found frequency is not full recall, precision or a calibrated probability.
Malformed outcome receipts remain explicitly invalid; legacy summaries retain
availability-only scope with unknown mode, stratum and judgment coverage.

Remediation rows preserve each observed cohort and its workload identity. Low
availability alone produces inspection hypotheses about workload validity, source
coverage and query interpretation. Judged misses justify investigating those
misses; they still do not identify a tokenizer, chunking or ranking cause. Cause
flags and miss-taxonomy labels do not authorize production tuning. Suggestions
retain evidence, missing evidence, contradicted inferences, applicability and
abstention reasons. Numeric priorities are heuristics; every loop remains
unaccepted, with null post-change measurements and deltas.

The per-query `stats.elapsedMs` observation is retrieval service elapsed time,
retained with sample coverage, cache-state counts and effective concurrency.
It can justify inspection, not rerank attribution. Batch wall-per-completion
includes concurrent pool lifecycle and is throughput cost; it never substitutes
for query latency. Legacy latency averages without this cohort receipt do not
qualify a latency recommendation. Rerank tuning requires its own stage evidence.

Changing intent weights or generated queries is workload design. Version the
workload and freeze an independent matched holdout before reporting product
quality changes. A changed denominator never establishes a post-change gain.
This report makes no automatic quality-delta claim and does not require relevance
judgments for throughput-only work.

Miss taxonomy retains separate per-backend total and zero-hit counts. Zero-hit
counts are a subset of total occurrences, never added to them. Unknown totals
stay null; contradictory subset counts are marked inconsistent. Aggregate scope
is backend-search occurrences, not unique queries or independent relevance
judgments. Four total occurrences with three zero-hit occurrences remain 4 / 3.
