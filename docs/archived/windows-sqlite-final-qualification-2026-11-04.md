# Windows SQLite final qualification — November 4, 2026

All **324 fresh child processes pass** at clean source
`1d53c5262a478708b5b9e9ac33bf905d5a07a45e` on Windows x64, Node 26.13.0, ABI 147.
The [machine receipt](windows-sqlite-final-qualification-2026-11-04.json)
retains every invocation, exit, full result, phase trace and chronological sample.
There are no failures, timeouts, native crashes, retries or unexplained omissions.
Every child keeps its original 30-second deadline. Execution is serial, with one
indexing thread and native-status redo disabled.

## Complete workload and content acceptance

Five explicit cohorts conserve all **30 paired trials, 60 arms and 132 measured
samples**. Running cohorts independently requires 318 children instead of the
canonical 307: the extra 11 are fresh preparation/seed lifetimes, with no duplicate
measured arm or omitted assertion. Both large shapes independently prove their
initial manifest identity. Each native mutation stays atomic and reaches
checkpoint/close before its separate, complete independent validation.

| Cohort | Children | Paired trials | Samples | Longest child |
| --- | ---: | ---: | ---: | ---: |
| large-low-build | 28 | 6 | 12 | 23.321 s |
| large-high-update | 88 | 6 | 36 | 21.420 s |
| large-low-update | 88 | 6 | 36 | 15.644 s |
| small-low-update | 87 | 6 | 36 | 2.504 s |
| small-low-build | 27 | 6 | 12 | 4.179 s |

Small inputs contain 16,384 rows in 32 files; large inputs contain 167,936 rows
in 328 files, with eight tokens per row and a4096-token vocabulary. Every update
arm retains the same database through all three original rounds. Low-change
rounds insert 2048 rows and high-change rounds 53,248; added/deleted/shrinking/
growing files remain covered. Full chunks, postings, file identities, lengths,
filter facts, expected FTS hits and applicable lane observations agree in each
paired result. Mutation-only completion cannot qualify an output.

The separate artifact campaign passes six fresh alternating paired trials:
12 complete builds, each with 32,768 wide rows and **157,934,386 actual input
bytes**, above the unchanged 134,217,728-byte threshold. Actual optimization
pragmas are present in the current arm and absent in the baseline. All 65,536
postings, ten file identities, content digests, filter/FTS/lane observations and
source admission agree. Longest whole child:17.263 s.

The original first artifact child completed successfully, but its consumer
incorrectly required empty stderr: canonical publication prints the exact
165-entry pieces-manifest progress message. The consumer now asserts that exact
message and rejects other stderr. Its saved successful result was re-admitted;
that child was not rerun. Both original expectation and correction remain in
the receipt. Row cohorts admit 6552 typed phase records with no unexpected
messages. Progress is preserved as evidence, not labeled a warning.

## Measured observations

These are native-operation medians in milliseconds. Build groups have six
samples per arm; update groups have 18, spanning six independent databases and
three rounds each. Raw chronological samples, extrema and nearest-rank p95
remain in the machine receipt.

| Workload | Baseline median | Current median |
| --- | ---: | ---: |
| large-low-build | 17433.871 | 12313.443 |
| large-high-update | 14280.576 | 8246.340 |
| large-low-update | 1192.807 | 933.903 |
| small-low-update | 494.521 | 417.711 |
| small-low-build | 2049.348 | 1526.998 |
| Above-threshold artifacts | 4728.392 | 4076.767 |

Baseline/current are the benchmark's declared optimization controls on the same
repaired implementation, not a checkout of the historical defective owner.
Imports, source generation and complete validation have separate clocks. Builds
use fresh databases; updates use independent native backups and retain their
three-round database. Process/JIT warmth resets between children; OS cache is
uncontrolled. These lexical workloads establish actual admitted work and bounded
correctness, with descriptive paired costs. They do not establish a universal
speedup or dense/semantic/optional-backend capacity.

The existing strengthened latency case also passes: both original indexed
source hits precede all 20 warm samples; p95 is 104.3004 ms against the unchanged
7500 ms Windows limit. Its [original receipt](windows-sqlite-fact-batching-repair-2026-11-04.json)
records a concurrent formatter, so that observation qualifies the retained
correctness/latency bound, not isolated comparative timing.

## Repairs and retained failures

The [boundary/deletion repair](windows-sqlite-boundary-repair-2026-11-04.md)
conserves complete lifetimes and removes repeated native stale-postings scans.
The [fact-writer repair](windows-sqlite-fact-batching-repair-2026-11-04.md)
uses one bounded native write per 128-row page instead of 128 writes. Original
failed campaigns, their successful prefixes and fail-before owner regressions
remain independently recorded. No earlier campaign pass is imported into this
candidate's qualification. Production authority, format, transactions, positive
queries, negative controls, workloads and thresholds remain unchanged.

This completes the Windows acceptance for #1733. Optional sqlite-vec, non-Windows
execution, editor work and broader release qualification remain separate.
Generated work is reclaimed only through its verified run owner; caller indexes
are retained. All scratch paths in these receipts are historical author-workspace
locations, not files promised in a clean checkout. The lossless receipt encoding
includes its reconstruction rules and round-trip assertion; each raw file has
its original SHA 256 and byte count.

All eight publication checks pass for this receipt batch, including 41 gate cases
with zero failures, timeouts or skips. Their complete command/status/log receipts
are retained with the unchanged tested implementation identity.
