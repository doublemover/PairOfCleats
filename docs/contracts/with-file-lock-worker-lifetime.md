# File-lock worker prerequisites

Status: source and authored regressions are **UNVALIDATED**. No executable
validation, formatter, bootstrap, native or platform qualification has run.

`withFileLock` retains its worker result/error contract, including exact frozen
and falsey rejection identity after ordinary confirmed release. Its existing
`releaseFileLockOrThrow` cleanup now captures object worker errors' original
resource observations before release-options, release-method or diagnostic
getters. An absent/false marker does not override the original observer. The
original captured function and receiver remain authoritative after replacement.

The observation is handed to the same authenticated published owner before a
native release operation. The existing path fence is held; original worker work
must confirm before another metadata lookup/read/removal, and the native owner
continues to check it after awaited phases and before acknowledgement. This is
an append-only prerequisite in the existing owner, not a resource registry or a
second admission/cleanup engine. The shared observation helper exposes a frozen
`isSettled` predicate for this internal purpose; it grants no release capability.

Fence refresh uses the actual owner's full removed/closed/original-settlement
predicate. A worker that already acknowledged successful release and then throws
an ordinary settled error does not reopen the fence when cleanup returns false;
neither does a second wrapper on that acknowledged handle. If newly reported
work remains pending after removal, it still holds the fence. Once every
original observation confirms, a later wrapper can clear that existing fence
without another unlink or an otherwise unnecessary session call.

If the worker is pending before invocation, the structured
`ERR_FILE_LOCK_RELEASE_FAILED` outcome carries `releaseAttempted: false`, the
exact raw `workerError`, no fabricated release cause, and the actual
non-enumerable `fileLockPublicationSession`. Neither the public release getter
nor native metadata removal is invoked. A later predicate cannot erase the
secondary native error thrown by an earlier observer call: the sealed retained
context follows the original error and every independent observer. Ownership
getter failures remain unknown. `releaseAttempted: true` describes a method
invocation, including an actual false release result or thrown rejection.

Reconciliation is explicit: settle the worker's actual original resources, then
reconcile the existing published session and acknowledge its confirmed release
through the handle if needed. The worker is never rerun and its result/error is
not replayed by metadata recovery. An actual failed contained worker descriptor
is available through its original `workerError` and the existing private
contained-file validator; no field-shaped or guessed child gains authority.

Exact same-owner wrapper/publication errors use their private producer identity
to separate already represented metadata from independent native prerequisites.
They cannot feed their own metadata predicate back into the retry that settles
it. A copied error or an actual session placed on another error does not receive
that exception. Independently unknown work remains a prerequisite.

`tests/shared/locks/with-file-lock-worker-lifetime.test.js` authors actual worker,
descriptor and metadata counters for original observation flags/receivers,
withheld release getters/unlink, force refusal, throwing observer secondary,
actual descriptor-before-parent recovery, getter replacement, same cause/worker,
falsey/frozen ordinary errors, exact same-owner nested cleanup and unreadable
original ownership. Earlier release observation fixtures retain actual false
result coverage after prerequisites confirm, and move newly pending worker
observations to their real native failure boundary where release had initially
been authorized. Their original no-retry, metadata and recapture counters remain.

This does not infer settlement from the worker promise alone, adopt unrelated
background work that the worker never reports, or settle arbitrary returned
objects/async logger results. Direct release without a reported worker retains
its existing scope. Opaque diagnostic/stale readers, atomic publishers,
cross-process/alias coordination and native/performance acceptance remain open;
no issue completion is asserted.
