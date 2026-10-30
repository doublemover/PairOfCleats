# LMDB readiness after native completion — 2026-10-28

Source `79cb896023555324f9499caec7b43a5a9d90c9b9`, tree
`4daf4fe02bc71b1a0a1453dfae8d613dd864f8bd`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The actual builder published filesystem `ready: true` before opening a second
LMDB handle to write the final embedded index state. A failed write or original
close could leave readiness already published. The builder now prepares its
immutable backend snapshot without changing filesystem readiness, writes the
snapshot and confirms original native closure, then commits readiness through
the existing state publication owner against its original source/LMDB witness.
Native work runs outside the metadata mutex. A native failure cannot reach the
ready commit; ready publication never retries the backend operation or native
close. The commit promise coalesces success and failure, including manifest errors.

Generation, mode/source state, extensions, embedding invocation and competing
LMDB changes invalidate the prepared witness. The independent SQLite namespace
is merged from the latest state. Only SQLite and the root `updatedAt` produced
on every shared publication invocation are excluded; no other provenance is
normalized. The embedded state is the prepared point-in-time snapshot, while
the filesystem commit can include newer SQLite metadata and its commit timestamp.
The ready LMDB namespace retains the planned values. Requests are copied before
waiting; original input observations and successful mutation results remain
required through actual metadata release.

Nineteen `storage/lmdb/ready-publication/*` controls cover preparation without
readiness, immutable requests/snapshots, independent SQLite preservation, source/
LMDB/embedding conflict, root mismatch, invalid producer values, coalesced commit
success/failure, actual native success/write failure/close failure/pending close
result, mutation revocation during write/release, pending request and source/
patch observer revocation. Positive native state content and native once-only
closure remain asserted. The failed-native-close control preserves unknown
metadata evidence after physically cleaning up only its actual fixture handle.
**All nineteen controls and affected existing fixtures are unexecuted.**

Format/ESLint, four JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No native operation,
functional fixture, child or publication gate ran. Dependency inputs are unchanged.
This does not establish crash-atomic state/manifest recovery, concurrent native
writer qualification, custom producer/deletion registration or full CLI/MCP/
Windows acceptance. #1267/#1574 remain partial.
