# Asynchronous subprocess callable contract

The current export is `spawnSubprocess` from
[`src/shared/subprocess/runner.js`](../../src/shared/subprocess/runner.js).
Its [JSDoc types](../../src/shared/subprocess/types.js) describe options, capture,
results, failure codes and termination evidence. The synchronous helper has a
separate implementation and does not acquire these asynchronous guarantees.

Pass an executable plus arguments; shell mode is rejected. `cwd`, `env` and stdio
go directly to Node's spawn owner. The runner does not merge a supplied environment
with the parent environment. Windows defaults to attached execution; other
platforms default to a detached process group. Explicit detached/unref children
default out of parent-exit tracking. Other children are registered for existing
signal, before-exit, exit and uncaught-exception cleanup. Those hooks attempt
termination; they are not durable resource-release receipts.

Ownership first uses explicit `ownershipId`/`ownerId`, then a bound AbortSignal,
then the active `withTrackedSubprocessSignalScope` context. Cleanup scope prefers
`cleanupScope`, then `scope`, then that owner. Cancellation and cleanup must target
the exact run's scope. An unscoped global registry operation is not a substitute.

Positive `timeoutMs` enables execution timeout. Abort/timeout termination uses
zero grace when `killGraceMs` is omitted; an explicit nonnegative grace is retained
through tree escalation. Parent-exit tracking independently defaults to 5000ms.
Close observation defaults to effective abort/timeout grace plus 500ms; an
explicit nonnegative `timeoutAbortReapWaitMs` bounds that observation, including
zero for immediate observation. These waits do not retry the operation.

Normal completion resolves on the exact child's `close`, with exit/signal,
elapsed time and selected output. Unexpected exit codes reject `SUBPROCESS_FAILED`
with that result unless `rejectOnNonZeroExit:false`; expected codes default to
`[0]`. Abort rejects `ABORT_ERR` (name `AbortError`); timeout rejects
`SUBPROCESS_TIMEOUT`. Child error, stdin failure or a throwing synchronous hook
rejects `SUBPROCESS_FAILED` with its original cause after owned termination.

An invalid signal or shell request rejects before spawn with a structured result.
An already-aborted valid signal also rejects before spawn. These pre-spawn results
have no capture/termination evidence. Invalid native spawn arguments or decoder
encodings may reject the original exception without a result; callers cannot
assume every thrown error is a `SubprocessFailure`. A missing executable can emit
an asynchronous child error with no PID. No unrelated PID may be inferred.

Termination-path results include `termination.scope='spawned-child-close-only'`,
`closeObserved`, bounded wait and tree-attempt observations. `treeCleanupSettled`
means the termination attempt finished. Signal acknowledgement, an exit event,
fulfilled kill request and direct-child close do not establish an arbitrary
descendant census. Normal success has no termination receipt.

Tracked cleanup separately records `killAudit[].closeObserved` from the exact
registered handle. Async cleanup observes close for at most 500ms after its
termination attempt; targets use that allowance in parallel. Sync cleanup cannot
pump an asynchronous close and preserves unconfirmed registrations. Neither
exit status, PID liveness nor kill success removes them. Cache-writer admission
requires zero remaining exact owners and explicit close in every targeted row;
a rejected tree attempt remains a failure even if the child independently exits.

When close remains unobserved or tree cleanup rejects, the error carries
`cacheOwnershipPending:true`. Tracking stays until that exact child closes.
`cacheOwnershipReleased()` is an exact-handle observation for delayed close and
stays false after tree-cleanup rejection. It does not mutate the original receipt
or release a cache lock. Callers retain cache, installation, scheduler or capacity
authority until their existing resource owner can prove settlement. A timeout
rejection, dead parent PID or later unrelated run cannot authorize cleanup.

Windows command wrappers use the existing CMD invocation owner. Async/sync
resolved-command helpers pass the selected child cwd and environment into wrapper
lookup; relative wrapper/PATH entries resolve there, and COMSPEC/SystemRoot come
from that environment. Explicit file-URL/default cwd retains native behavior.
The LSP client snapshots its argument/cwd inputs, gives each spawn a separate
environment copy and sets `windowsHide: true`. Literal shell metacharacters and
verbatim argument transport retain their existing encoding/negative contracts.

Tracked termination receipts retain a private, identity-bound observation of
their original registered close promises and tree attempts. An unconfirmed
attempt can later acknowledge exact child close through that original observer;
its public audit rows remain the failed attempt's snapshot. Copied/serialized
reports carry no such observer. Rejected tree attempts retain their original
exceptions and stay unconfirmed even after direct-child close. A partial target
selection cannot settle another in-flight cleanup owner's work. The existing
cache/runtime owner still performs explicit lease reconciliation.

Capture defaults to piped output, independently capped at 1000000 retained tail
bytes per stream. `outputCapture` reports observed/retained/dropped/backing/output
bytes, truncation and encoding loss. `outputMode:'lines'` formats the retained
tail; its first line can be partial. Live `onStdout`/`onStderr` receive decoded
chunks independently of capture caps, without a promise of complete lines.
Callbacks are synchronous; their returned promises are not awaited. Consumers
own live framing and bounded retention. Hook throws use the same termination
owner. All listeners precede `onSpawn`, and stdin error ownership remains until
actual close. See [error ownership](subprocess-error-ownership.md).

This typed consumer sketch uses an existing exact resource owner; it does not
invent a new global cleanup mechanism:

```js
/** @type {import('../../src/shared/subprocess/types.js').SpawnSubprocessOptions} */
const options = { signal, ownershipId: resourceId, timeoutMs: 1000,
  timeoutAbortReapWaitMs: 500, stdio: 'pipe', maxOutputBytes: 4096 };
try {
  const result = await spawnSubprocess(executable, args, options);
  await existingOwner.completeChild(result); // resource owner still checks its scope
} catch (error) {
  if (error?.cacheOwnershipPending === true) {
    existingOwner.retainPending(error); // no lock/capacity release here
  } else {
    await existingOwner.recordFailure(error); // not a whole-tree settlement claim
  }
  throw error;
}
```

Existing coverage owners are
[`termination-close-observation`](../../tests/shared/subprocess/termination-close-observation.test.js),
[`tree-failure retention`](../../tests/shared/subprocess/termination-failure-retention.test.js),
[`abort`](../../tests/shared/subprocess/abort-kills-child.test.js),
[`timeout`](../../tests/shared/subprocess/timeout-kills-child.test.js),
[`callback failures`](../../tests/shared/subprocess/output-callbacks-guarded.test.js),
[`capture bounds`](../../tests/shared/subprocess/capture-bounds.test.js),
[`scope inheritance`](../../tests/shared/subprocess/tracked-signal-scope-binding.test.js)
and [`input/error settlement`](../../tests/shared/subprocess/input-and-error-settlement.test.js).
Fresh observations and source identities are recorded in the repair archives;
this contract's coverage links do not imply a full-suite qualification.
