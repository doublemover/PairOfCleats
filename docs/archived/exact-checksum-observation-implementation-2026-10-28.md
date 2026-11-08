# Exact checksum descriptor observation — 2026-10-28

**UNVALIDATED source:** `9995cd60e65dc6087b4a0910e6beeeeba0b3796a`, tree
`8583463dccfe5ca48c83ca018853d713f7906ecf`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The internal checksum observation retained numeric inode values, which can round
native Windows IDs. Its final stat also preceded awaited digest completion,
leaving a file change during asynchronous digest work outside that check.

Observation mode now reads exact BigInt descriptor identities/timestamps before
and after hashing. It rejects inode or nanosecond changes even when Number
representations collide. Immutable `fileIdentity` strings bind dev/ino to the
same original descriptor as hash and byte extent; the existing numeric diagnostic
identity remains for compatibility. Final stat/verification follows actual digest
completion. Cancellation awaits that accepted digest before descriptor closure.
Ordinary checksum-only and SHA callers keep their return types and add no exact
stat calls. Existing contained-file ownership controls actual close and recovery.

Eleven `shared/hash/exact-file-observation/*` controls are authored,
**unexecuted**: real plain/contained IDs, high native IDs and numeric collisions,
nanosecond changes, actual asynchronous digest mutation/cancellation, pending
exact-stat ownership/recovery, rejected untyped fallback, unchanged SHA call
counts and frozen observations. Existing hash resource/close, native state and
manifest checksum controls remain required. This supplies precise identity for
subsequent evidence-retirement work; it does not grant deletion authority.

Format/ESLint, two JavaScript syntax checks and whitespace passed. No functional
fixture, child, native operation or benchmark ran. #1663 still needs reference-safe
retirement and capacity implementation; #1267/#1574 retain wider source and
runtime qualification. Counts remain **480 pending, 145 partial, 93 unresolved**
of 718 open issues. Source is local/unpublished; publication gate remains deferred.
