# File-lock failure presence

Worker and lock-release rejection are explicit outcomes, independent of the
truthiness of a thrown value. A worker rejection of `undefined`, `null`, `false`,
zero or an empty string remains a rejection after successful lock release.
Fulfilled work returning those values retains its success result.

When release fails, the existing `ERR_FILE_LOCK_RELEASE_FAILED` error preserves
the exact release rejection as its cause and the exact worker failure in
`workerError`, including an explicitly supplied `undefined`. A false release
result remains unconfirmed and has no fabricated thrown cause. Release options,
lock identity and exclusion authority retain their existing contracts.

`releaseFileLockOrThrow` captures the original release method once with its
receiver and uses the supplied release options unchanged. A throwing method
getter is also an exact release rejection. Before reading diagnostic fields,
the wrapper captures the release cause's and object worker failure's original
native-resource observers through the existing pure storage error composer.
Original functions and receivers remain authoritative even if `code`, `name`,
or the lock's `lockPath` getter replaces them. The wrapper reads each selected
diagnostic once, accepts string codes/names without coercing arbitrary objects,
and retains falsey/frozen diagnostic rejections with independent original
observers. Read-only outward ownership fields prevent replacement of the
captured composition. Unreadable original observations remain unknown.

The structured release error still has the exact raw release rejection as its
top-level cause, the canonical `ERR_FILE_LOCK_RELEASE_FAILED` code, and the
exact `workerError`. Diagnostic composition does not invent a cause for a
false release result. Existing bounded context history retains inspection
failures thrown later by original observers. No original error is mutated.

These composed observers describe independent native work only. A true
observer does not certify that metadata was removed, and a failure does not
grant an automatic release retry. The actual write-reservation owner combines
the observation with its existing exact coordinator and reservation lifetime:
while the original native removal or diagnostic owner is pending, it retains
the coordinator and refuses a second metadata operation. Once independent work
confirms, explicit reservation reconciliation retries only the retained metadata
owner, without reading/unlinking an already removed reservation again.

The authored regression covers actual disposable lock admission and denied
metadata removal, frozen unlink errors and inert exact release controls. It is
**UNVALIDATED**. No test, formatter, bootstrap or Windows fault qualification has
run for this change; it grants no cleanup or retry capability.

`tests/shared/locks/file-lock-release-observation.test.js` additionally authors
actual lock and reservation controls for observer capture before diagnostics,
replacement resistance, independently pending diagnostic/observer failures,
single original method/receiver capture, falsey causes, and metadata-only
coordinator recovery without free-space or reservation operation replay.
The successful lock owner now bridges its privately retained original release
observations to the wrapper, before diagnostics. The wrapper privately captures
its independent cause/worker/inspection observation separately from the owner
predicate. Only an actual wrapper for that exact handle is recognized if thrown
back into the owner; copied fields or an actual session on another error do not
receive that treatment. This prevents a same-owner predicate cycle while
preserving independent prerequisites. The handle's actual session remains a
separate metadata settlement capability, described in
[the publication lifetime contract](file-lock-publication-lifetime.md).

Published release now adopts its metadata descriptor through the existing owner,
with actual failed-close capabilities projected non-enumerably through the
authenticated handle context. `withFileLock` worker settlement before its first
release, other diagnostic/stale lock-info callers' swallowed read/descriptor
failures, raw descriptor/atomic publication owners, and cross-process/native
qualification remain separate open work.
The bridge reuses the existing publication/failure owner associations and fence;
it adds no filesystem namespace or metadata proof to arbitrary wrapper errors.
