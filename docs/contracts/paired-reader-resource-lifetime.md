# Paired positioned reader resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual `readJsonlRowAt` and `validateOffsetsAgainstFile` scopes now borrow
their exact data/offset descriptors through the existing contained-file owners.
Parallel admission is preserved. A failed peer admission waits for every actual
open to resolve and disposes its successful peer before rejecting; failed close
and independent original work retain the exact descriptors. Strict validation
uses `withContainedFile` through admission and cleanup, so its FileHandle and
original methods are never detached and recaptured between owners.

The small scoped compositor opens no separate resource registry or group ID.
Each descriptor keeps its original scheduler/native drain, read/stat/close
methods, receiver and original-work prerequisite. Original action or admission
failure is captured before the lifetime gates close and reaches every admitted
owner before native destruction. All admitted operations drain. Original falsey,
frozen and independent peer close failures remain composed; successful rows and
validation results are withheld until both owners confirm close.

When retained, nonenumerable `containedFileSessions` contains only the actual
individual private capabilities, with the first also available as the existing
`containedFileSession`. Each capability grants only its exact descriptor's
original close-only recovery. There is no combined settlement receipt: callers
must explicitly reconcile every actual session and preserve the composite
original observation. Releasing one descriptor cannot settle another. Original
admission failures appear first so an exact failed-admission owner can settle
before a peer whose cleanup is gated on it. Unknown external dependencies and
cycles are not inferred or automatically settled. No path, PID, cause-chain scan
or serialized ID grants release authority.

Safe offset/length/read limits and the bounded newline-validation windows remain
unchanged. The authored actual pair/public-consumer fixture covers normal scopes
and strict validation, falsey/frozen partial opens, actual missing-peer plus close
failure, two independent open/close errors, read-plus-both-close composition,
withheld valid rows, original observer replacement, strict failed-admission
recovery and admitted dual-read drain without replay. Original bytes remain
unchanged, and external fixture teardown is not a settlement receipt.

The persistent `openJsonlRowReader`, verified snapshot transition and its batch
facade now reuse this same compositor; see
[persistent reader resource lifetime](persistent-reader-resource-lifetime.md).
Stream and compression ownership, category/index/coordinator leases and durable
cross-process native settlement remain outside this scope. No tests,
syntax/lint/format, bootstrap, native/platform/full-index or performance checks
have run; no completed issue or executable acceptance is claimed.
