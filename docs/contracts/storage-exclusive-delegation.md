# Exclusive native child ownership

Source and authored regressions are **UNVALIDATED**. No native child, cache
mutation, cleanup, migration or acceptance measurement has been executed.

`prepareRepoCacheAccessHandoff(root, {drain})` suspends new parent readers and
requires the existing resource owner to close its exact retained reader handles.
The original reader lease stays present until the existing cleanup exclusion
has been acquired. A JSON copy of the process-local token is invalid.

`startDelegatedRepoCacheOwner(root, {localAccessHandoff, resourceId,
commandIdentity, entry, args, cwd, env, stdio})` owns the real Node ChildProcess
and one dedicated IPC channel. It prepends an internal `--import` gate. The
requested command entry and its cache-path imports run only after admission.
`NODE_OPTIONS` is rejected because user import/require hooks could precede that
gate. Canonical repository children use the established default coordination
directory, matching their existing normal readers. Three ordinary stdio
channels are preserved; the owner adds a fourth IPC channel.

The exchange binds the exact cleanup lock ID, parent PID and drained lease ID,
canonical root object (device/inode), resource ID, canonical command identity,
spawned child PID and random startup nonce. Executable, arguments, execArgv,
working directory and environment are bound by an invocation digest. Raw
environment values and capability secrets are not written to disk. A one-use
random capability travels only over the actual spawned child's IPC channel;
only its digest is recorded. The child publishes a bound lease and receives
authenticated admission acknowledgement before the entry is imported.

The native command entry reads `getDelegatedRepoCacheOwner()`. Its actual
SQLite/LMDB handle and descendant closure owner calls:

```js
await settleDelegatedRepoCacheOwner({
  resourceId: owner.resourceId,
  handlesClosed: true,
  descendantsSettled: true,
  pending: false
});
```

Those booleans are the existing resource owner's actual disposition receipt;
fulfilling a command promise, requesting cancellation, reaching a deadline or
observing IPC disconnect cannot substitute for it. `controller.completion`
waits for both this exact authenticated receipt and the actual child `close`
event. It returns the existing exclusion wrapper result containing the exit
code/signal and settlement receipt. The wrapper then restores the parent reader
before releasing exclusion.

The child stops admitting reads when settlement transmission starts. Its local
`settled` state remains false until the actual IPC send callback fulfills.
Concurrent closure callers join one original transmission. Failed transmission
retains that rejected flight and the blocked reader state: delivery is unknown,
so another call cannot replay the authenticated one-use receipt or claim local
settlement. A fulfilled send still does not independently release parent
exclusion; the parent requires its authenticated receipt and actual child close.

Missing/forged/stale/wrong-child receipts, an unconfirmed child lifetime or any
changed lock/root/lease record retain exclusion. The exact parent reader lease
is restored while local admissions remain suspended. An unresolved delegation
record blocks **ordinary readers before stale-parent lock recovery**, as well as
collectors. Parent death or elapsed time never establishes child settlement.
Unknown records and failed publication evidence are retained for explicit owner
reconciliation. There is no timeout-based fence removal or serialized force
override.

The authored fixture uses a real `node:sqlite` database handle behind the import
gate and includes wrong-child/stale grants, forged closure, missing settlement,
stale-parent reader admission, and in-flight/rejected settlement transmission.
The latter uses the actual admitted child/native owner with a controlled IPC
send callback, requires the child's assertion-success marker and zero exit, and
retains parent exclusion. These authored controls are unrun. LMDB and the existing
TUI service's actual SQLite/LMDB closers require their owner integration and
deferred runtime proof.
