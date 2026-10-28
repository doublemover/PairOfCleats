# Recorded benchmark measurement sources

Historical reconstruction uses the saved report's observations. It does not load
current user configuration, `metrics/index-*.json`, mutable feature metrics or a
current build pointer to fill absent historical timings. Embedded native ledgers
remain preferred. Embedded scan-profile modes, throughput and indexing summaries
remain available without access to the original repository.

The shared pure ledger/timing builders accept explicitly supplied observations;
they no longer resolve mutable repository files themselves. Each modality selects
one counter-and-clock family. Known counts with unknown duration retain a null
rate. Missing/null/string values do not become observed zero. Timing derivations
identify observed and unavailable stages; an entirely absent profile stays null.
An already observed embedding stage is not counted again from a summary duration.

Diagnostic derivation version **3** records the original source digest, recorded
timestamp, per-mode sources and optional attempt evidence. Materialization retains
that derivation in the ledger and section provenance. A later read preserves its
fallback classification. Older fallback ledgers lacking source qualification are
reconstructed from saved observations; they are never promoted to native simply
because they occupy the ledger slot. Explicit materialization preserves genuine
native ledgers. Unchanged source observations produce stable derived content.
Version 3 also invalidates older derived numeric summaries so null/zero and
matched-subset coverage repairs cannot reuse their earlier meaning. The
[numeric observation contract](throughput-numeric-observations.md) defines those
states without claiming workload or independent-attempt qualification.

An optional internal `artifacts.measurementSnapshot` receipt can fill absent
historical facts. Its version-1 fields are `schemaVersion`, `attemptId`, `path`,
`bytes` and lowercase hexadecimal `sha256`. The attempt must equal the saved
report's explicit `run.attemptId`. The referenced UTF-8 JSON envelope contains the
same version/attempt and `metricsByMode` and/or `featureMetrics`. A declared ID or
filename alone is insufficient: exact extent and digest must match.

Only a canonical relative path beneath the actually read report's directory is
admitted. That directory is supplied by the report reader, not by the receipt.
The existing contained reader rejects link/escape authority and limits the source
to 8 MiB before allocation and during verification. Missing, malformed, changed,
out-of-bounds, mismatched-attempt and unqualified sources remain unavailable.
Original pending I/O ownership is propagated rather than converted to absence.
No mutable mtime cache, public enrichment knob or alternate index format is added.

The same source resolver serves the language aggregate, throughput renderer and
explicit materializer. Their default read paths retain their no-write contract.
Mutable feature-metrics inspection remains a separately named current-state
utility with independent invalidation coverage; historical callers do not use it.
This contract qualifies recorded measurement reconstruction. It does not qualify
real-model performance, historical environment equivalence or live structural
build-state analysis as an immutable attempt snapshot.

Live structural analysis keeps its recorded materialization provenance on later
reads. Explicit refresh reconstructs before comparing all semantic fields.
Only this analysis producer's invocation-dependent `generatedAt` is excluded
from that comparison; equal content retains the original object and timestamp,
including its key order. Changed content receives a new reconstruction time.
Measurement/source timestamps are never normalized. An unavailable refresh of
previously derived analysis preserves the stored evidence, returns
`analysis-reconstruction-unavailable`, and makes the materializer exit nonzero.
It is not a successful no-op and does not promote the old analysis to native.

Small fixtures retain a saved A report while mutating/removing current B metrics
and configuration. They exercise actual aggregate and ledger callers, qualified
snapshot admission, counter/clock pairing, native priority, unknown duration,
invalid source authority and materialization round trips. No corpus indexing or
model execution is required.
