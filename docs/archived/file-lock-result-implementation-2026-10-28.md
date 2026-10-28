# Original file-lock worker results — 2026-10-28

**UNVALIDATED source:** `5df6cdf6bd5d3c1e8bd555a1e9037b5486598bae`, tree
`7adaa3a48239177241fb33e366f3b28fd114718f`. Branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The existing `withFileLock` owner retained original thrown-worker resource
prerequisites but ignored successful returned values carrying pending work.
That allowed promise fulfillment to retire lock metadata before actual original
resource settlement. The actual wrapper now requires the returned value's
original observation inside its worker boundary, routing any unconfirmed result
through the existing original publication-session recovery protocol.

Six `shared/locks/with-file-lock-result-lifetime/*` controls are authored,
**unexecuted**: marked and unmarked pending results, independent observer work,
replacement callback, confirmed resource result and unchanged plain/falsey
returns. They publish real locks, assert force-removal refusal, retain exact
receivers/independent causes and actual original-session metadata recovery, and
assert the worker runs once. Recovery cannot re-read a replacement observer.
The following documentation/coverage checkpoint corrects error-graph assertions
to inspect the existing release error's `workerError` field; it does not invent
a new standard cause edge. Existing thrown-worker, descriptor, falsey and lock
contract coverage remains.

Format/ESLint, two JavaScript syntax checks and whitespace passed. No functional
fixture, child, native operation or benchmark ran. The lock format, stale-owner
policy, timeouts, retries and deletion authority are unchanged. #1267/#1574 and
their broader source/qualification requirements remain open. This is a shared
prerequisite for further index-state publication work, not paired-publication or
whole-storage acceptance. Source remains unpublished.
