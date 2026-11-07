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

Discovery reads entries incrementally through the existing storage-directory
owner, which awaits its original reads and close. Per invocation it admits at
most 65,536 visited entries, 4,096 discovered directories, depth 64, 8 MiB of
retained path bytes and 1 GiB of captured selected-stream bytes. Its five-second
work allowance is cooperative at read/close boundaries; it cannot cancel an
outstanding native read. Internal test limits may only tighten these maxima.
An entry boundary may conservatively stop before the final EOF probe.

Limit stops record the exact reason and make coverage incomplete. A narrower
existing run-suffix selection reduces selected bytes; no partial inventory is
reported as a complete campaign. Error samples are capped at 128 with exact
total/omitted counts. Unconfirmed original directory closure propagates through
the shared observation policy before diagnostic fields can be inspected. No
retry, lease release or cache cleanup follows from that classification.

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

The same process-runner instance retains run-wide execution, unconfirmed-flush
and write/flush-failure counters. A later successful command cannot erase an
earlier delivery failure, and a write queued while an older generation drains
remains unconfirmed. Counters retain constant-size state without keeping every
command or path. The actual frontdoor supplies this snapshot to the report;
`runProducerState` distinguishes complete, incomplete and not-supplied evidence.
Raw captured-file report generation may omit this observation and cannot claim
run-wide producer delivery. This metadata does not grant resource retirement.

Report streams borrow original read/stat/verification operations through
`withContainedFile`. The existing descriptor owner awaits admitted operations,
retains original error observations and refuses native close while independent
work is pending. A failed close propagates with its original close-only recovery
capability; parsing is never replayed by recovery. Frozen/falsey consumer failures
and exact original close errors remain in the retained cause graph.

Only confirmed settled errors can become incomplete-input diagnostics. Before
and after each diagnostic getter, the reader checks the captured original resource
observation. Pending work and fallible/falsey inspections retain the exact report
path and propagate. No automatic retry, physical-release inference or partial
report follows from an unconfirmed original read/close.

The comparison contract checks coverage count/state consistency, explicit
incompleteness and the current parity version before normalizing a summary.
Required missing evidence fails the enforce gate; informational mode still
reports it. Timing nulls remain unknown and measured zero stays distinct.
This validates supplied report evidence; it does not establish benchmark origin,
representativeness, final filesystem snapshot continuity or performance gains.

Ten new locally unrun cases cover absent/quiet pairs, malformed/non-event and
invalid-UTF-8 input, out-of-inventory declarations, real quiet/failing stream
producers, failure followed by a separate successful command, footer provenance,
and exact close/error retention. Existing rollout,
comparison, waiver-count and single-pass controls retain their original assertions,
count cases and thresholds, with actual quiet source-pair fixtures replacing fabricated healthy
parity. Real campaign/performance and final runtime acceptance remain pending.

Four further unrun cases exercise the original discovery owner with actual quiet
files, entry/byte/path/directory/depth bounds, cancellation and an explicit
unconfirmed-close owner model. The original diagnostics-summary fixture now
rejects its deliberately malformed row, then removes only that row to retain
the matching-event clean positive control and all original counts.
Two descriptor-owner cases additionally retain a pending read without native
close and a late falsey diagnostic failure after physical close. Explicit original
recovery waits for the captured prerequisite and never repeats a read or consumer.
These are finite owner models, separate from actual native retirement acceptance.
