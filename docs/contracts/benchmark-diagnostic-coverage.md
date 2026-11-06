# Benchmark diagnostic coverage

Benchmark parity observation version 2 requires captured stream coverage in
addition to matching event counts. The authoritative contract lives in
`src/contracts/bench-diagnostic-coverage.js`; rollout comparison inputs reject
version 1 or missing/incomplete coverage and require fresh report generation.
No compatibility path turns old zero counts into observed evidence.

The report reuses its single captured-length stream inventory and read pass.
Every observed raw log needs its diagnostic peer; process-declared diagnostic
paths additionally require the corresponding captured files. Declared paths
outside the admitted inventory are missing evidence, not permission to open
another filesystem location. Coverage distinguishes `complete`, `incomplete`
and `unobserved`, counts exact observed/expected/missing/unpaired sources,
retains bounded missing-source samples and records producer/read/parse errors.
An actually captured empty diagnostic file paired with a quiet log is complete;
two absent files cannot establish zero warnings or parity.

Malformed JSON, non-event objects, unrecognized event types, invalid UTF-8,
oversized/truncated/replaced input, incomplete reads and inventory errors cannot
produce clean parity. Per-file diagnostics retain captured/read bytes and malformed
line counts. A shared fatal UTF-8 decoder avoids a new decoder per line. Valid
stable final lines may still omit a newline. Event/repository presence, repeated
execution costs, truncation and transport completeness keep separate meanings.

Canonical run footer logs are summaries, not independent raw-event sources.
They retain their existing observation by other reducers but do not inject parity
events or require a diagnostic peer. An explicitly declared actual log with that
name remains a source. Existing master/repository event deduplication and every
original event-count/parity assertion remain in place.

The process runner initializes empty diagnostic streams through its existing
ordered write queue even when no events occur. Its returned diagnostic summary
records initialization, actual flush completion and retained write/flush failure
counts. Failure-return summaries are refreshed after the flush. Diagnostic-write
failure does not replace a successfully completed child; the resulting report
is unqualified. The actual benchmark frontdoor flushes its original master/repo
log writers with fatal error handling before capturing report inputs. Periodic
operator flushing keeps its existing nonfatal policy.

An original report-stream close failure propagates instead of returning apparently
usable parse metadata. If reduction already failed, the existing storage failure
context owner preserves both original errors, including frozen and falsey values.
It does not mutate the original error, inspect an unsafe close-error code getter,
retry an unknown close or claim physical release from a parse result.

The comparison contract checks coverage count/state consistency, explicit
incompleteness and the current parity version before normalizing a summary.
Required missing evidence fails the enforce gate; informational mode still
reports it. Timing nulls remain unknown and measured zero stays distinct.
This validates supplied report evidence; it does not establish benchmark origin,
representativeness, final filesystem snapshot continuity or performance gains.

Nine new locally unrun cases cover absent/quiet pairs, malformed/non-event and
invalid-UTF-8 input, out-of-inventory declarations, real quiet/failing stream
producers, footer provenance, and exact close/error retention. Existing rollout,
comparison, waiver-count and single-pass controls retain their original assertions,
count cases and thresholds, with actual quiet source-pair fixtures replacing fabricated healthy
parity. Real campaign/performance and final runtime acceptance remain pending.
