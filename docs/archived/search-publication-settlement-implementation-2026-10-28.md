# Search publication waits for request settlement

Windows-only solo implementation for the common #1267/#1574 lifecycle owners.
Source head `bf0bfffafca79758b0df9422045420b4a7aec276`, tree
`573356a77689925a520837db4e3d590a182e92ae` (checkpoint 238).
Commits 234–238 are functionally unvalidated until checkpoint 240.

Source review found two defects: the outer search runner discarded backend
disposal errors, and successful output could be emitted before that disposal.
The early branch-mismatch response also bypassed the normal emission owner.

The shared disposer now captures both invocation and fulfilled-result resource
observations before later disposers/reporting can change them. Rejected work,
falsey failures and returned pending resources remain required; healthy siblings
still close. The original coalesced cleanup promise is never replayed.

One request settlement owner captures original work before reporting, attempts
backend cleanup followed by independent telemetry/cache steps, and preserves
primary plus cleanup failures. Ordinary plan-cache persistence misses remain
optional; resource-bearing persistence failures cannot be hidden as cache misses.
Cleanup/reporting runs once on success, failure, cancellation and publication
failure. This capability conveys no new native-close or metadata-release rights.

Output preparation snapshots index-backed metadata/counts while backends remain
live. The request persists its existing search artifacts, awaits settlement,
checks cancellation, then emits the prepared result once. The existing synchronous
renderer retains its interface/output. No output buffering or new public knob
was introduced. Output stream failure after a partial write remains a failure;
prepared emission cannot be replayed.

Branch mismatch now awaits the same settlement before emitting successful empty
results; matching branches retain their backends for retrieval. Its empty payload
includes all four canonical mode arrays, allowing the native operator to admit a
legitimate branch-filter empty response. No stale-index explanation is guessed.

Authored controls include generic fulfilled/rejected disposal observations;
falsey/frozen work plus close errors; original observers and sibling completion;
prepared JSON/human parity and metadata reads after closure; six actual SQLite
runner cases; and branch mismatch/cancellation/publication controls. The actual
SQLite cases discriminate failed physical-close results, simultaneous work/close
failure, returned pending results, pending cache resources, ordinary optional
cache failure and success. They assert one actual close per opened DB, closed
physical handles before cache work, and no successful output on failed settlement.
Their synthetic failure injection is explicit; no native crash reproduction is
claimed. Pending evidence stays in its disposable fixture, not author caches.

Static format/ESLint, JavaScript syntax, generated script inventory, shared-module
cycle scan (zero) and whitespace checks passed. No functional case, native
operation or benchmark ran during this batch. Node 26.12.1 / Windows x64 remains
selected; package and lockfile hashes match the prepared checkpoint-102 inputs.

Required closeout remains execution of new controls and existing retrieval,
backend, cancellation, CLI/API/MCP/federation and native search contracts on the
frozen candidate. This does not complete custom-root deletion authority, other
backend lifetimes, native-crash attribution or measured latency qualification.
Historical `.tmp` receipts are author-workspace evidence only.
