# Contained-file resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The bounded async and sync verified readers now own the exact opened descriptor
from admission through native close. The small shared resource owner captures
the original close, read and stat methods with their receiver before admission
verification. It retains original operation and independent cleanup failures,
including frozen errors, readonly fields and every falsey thrown value. Native
stat/read progress and descriptor containment/hash checks remain mandatory.

Async operations keep the existing scheduler CPU suspension. The actual native
open/read/stat/close promise is observed independently of the scheduler wrapper;
a wrapper result cannot stand in for native completion. Already admitted reads
drain before close, and the captured original resource observations must confirm
settlement before native destruction. Later replacement of a marker, method or
diagnostic getter cannot replace those original observations. Inspection failures
remain independent blockers, including ones exposed by later diagnostic reads.

Failed admission or close exposes nonenumerable `containedFileSession`. The
actual process-local capability is recognized through a private identity, never
a copied resource ID, code, cause chain or serialized object. Failed resources
stay strongly retained in this process until their actual owner settles them.
There is no filesystem lease namespace, parent discovery, metadata unlink or
cross-process resource census in this owner.

For an async FileHandle, `releaseAfterClose()` explicitly invokes its captured
original close when needed and when independent original work is confirmed.
It never rereads, rehashes, reopens, publishes a witness or resumes the failed
consumer. Concurrent recovery shares the same close attempt. The producer emits
`{resourceId, settled:true, pending:false}` only after its own native void close
fulfills and all original independent observations confirm settlement. A known
close failure is never retried automatically.

The synchronous iterator adapter now keeps this same owner active across yields,
return and throw. Its actual borrowed iterator is recognized by the existing
private capability map; a yielded generator is not treated as a completed
`runSync` callback. Normal exhaustion alone may run a post-close publication
callback. See [binary frame iterator resource lifetime](binary-frame-resource-lifetime.md)
for the actual decoder adoption and JavaScript external body-throw limits.

Synchronous fd numbers have a stricter limit. If original work blocked the first
close, `releaseAfterCloseSync()` can attempt that first captured close after
settlement. Once `closeSync` throws or returns an unexpected nonvoid value, this
owner cannot prove the fd generation remains the same. Recovery therefore keeps
that resource unknown and refuses another numeric close, even if inode, path and
fd number appear unchanged. External cleanup or descriptor disappearance does
not manufacture a settlement receipt. Permanent unknown retention is deliberate
until a stronger native owner protocol exists.

Verified artifact-read witnesses are recorded only after the bounded read owner
confirms close. A close failure cannot publish a successful verification witness,
and later close-only recovery does not replay that publication. The physical
byte/stat identity and nonenumerable `fileIdentity` projection are unchanged.
Successful legacy `openContainedFile{Sync}` still transfers its descriptor to
the caller, whose subsequent lifetime remains that caller's responsibility.

The actual dictionary reuse reader now borrows immutable operations through
`withContainedFile`. Its bounded streaming, exact final object check, checksum
and one-final-LF normalization remain in place. Captured operations and verify
are admitted only during the callback; borrowers must not retain the raw fd or
start unrelated native work outside that callback. Failed-close recovery never
replays dictionary inspection. Only a missing file before callback admission
remains the existing reusable-dictionary miss.

The authored `contained-file-resource-lifetime` and
`contained-file-sync-resource-lifetime` fixtures use actual disposable handles
and inert filesystem/scheduler adapters. They cover original-method replacement,
falsey/frozen primary plus independent close errors, pending native read and
diagnostic observers before actual close, explicit FileHandle recovery, sync
generation refusal, admission failure, witness suppression, dictionary reuse,
admitted read drain, late borrowed-operation rejection and unchanged bytes.
Existing bounded/hash/pinned-identity fixtures remain. No tests, syntax checks,
format, bootstrap, native or platform qualification has run for this batch.

This does not repair every existing successful raw-open borrower's own finally,
retain category/coordinator exclusions on their behalf, or establish durable
cross-process native settlement. Cache reader/writer, migration and archive
owners still need their own exact coordination and resource adoption. No issue
completion or executable acceptance is claimed.
