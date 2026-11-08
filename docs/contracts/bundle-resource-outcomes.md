# Bundle resource outcomes and patch admission

Status: UNVALIDATED source and authored actual-consumer controls. Runtime, native,
worker, cross-process, import-budget and performance acceptance remain deferred.

Bundle readers keep settled malformed, absent and oversized-artifact behavior,
but first capture the original failure and enforce the existing descriptor owner.
A bundle, checksum, patch or patch-hint FileHandle with failed/unconfirmed close
cannot become an optional invalid/too-large/absent result. Diagnostic code getters
use the existing capture-once artifact observation policy; cancellation does not
erase independent original pending ownership.

MessagePack publication now checks retirement of its obsolete JSON checksum.
The checksum-unavailable branch likewise requires the old sidecar removal to
succeed. A failed sidecar removal therefore cannot return successful publication
or a successful unavailable-checksum receipt while stale metadata survives.
This is error propagation through the existing removal owner, not new deletion
authority or an atomic transaction across all bundle sidecars.

Patch metadata and fallback patch content use bounded verified descriptor reads.
An initial patch stat failure is only ignored for a confirmed ordinary ENOENT.
The supported append fast path owns the actual FileHandle through captured stat,
writeFile, sync and close, validates the original exact patch identity, and checks
its written pathname before close. Atomic rewrite revalidates the selected old
patch or admitted absence at its existing commit hook. New metadata/checksum work
starts only after append closure is confirmed.

The existing patch lock remains held while an original worker/descriptor outcome
is pending. Falsey/frozen worker failures survive. Release errors carry both the
actual contained-file close capability and the existing publication-lock session;
no capability is reconstructed from a pathname, PID, cause or serialized field.
Explicit recovery first closes the exact FileHandle, then releases that exact lock.
It never replays append, metadata/checksum writes or patch computation.

The authored fixture exercises real write/read/patch consumers, failed main,
checksum, patch and hint read close, failed append close with unchanged later
sidecars, actual lock retention/reconciliation, falsey stat failures and failed
checksum retirement. Existing checksum tamper, patch equivalence and read-admission
fixtures remain unchanged. No JSON-stream, token-postings loader, compiler,
semantic or map caller is edited by this batch.

Patch data, hint and checksum still have separate publication boundaries; this
change does not invent a whole-generation journal or claim portable compare/commit
atomicity. Cooperative lock users must still exclude external writers. Worker
termination and arbitrary caller admission remain their independent owners.
