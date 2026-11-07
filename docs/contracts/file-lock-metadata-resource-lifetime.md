# Lock metadata and stale snapshot resources

Status: source and authored controls remain UNVALIDATED. Only the scoped formatter
is eligible to run in this implementation wave; feature acceptance is deferred.

The legacy sync/async `readLockInfo` diagnostic readers borrow the existing exact
descriptor resource owner through the shared bounded JSON text reader. Parse and
ordinary null fallback follow confirmed standard void close. Unknown original
read/stat/close work propagates its real contained-file capability. The generic
owned-removal and stale-check catches cannot suppress that ownership merely
because they historically returned `false` or accepted a force option.

`readLockSnapshot` reads bytes and admitted stat identity from one descriptor,
verifies that same descriptor afterward and waits for close. The internal JSON
borrower's optional synchronous exact-stat observer receives matched BigInt stats
from that same descriptor; async-returning observers remain unknown native work.
Ordinary JSON borrowers add no extra stat calls. Its fingerprint adds exact
device/inode/ctime to the existing size/mtime/content digest. Independent pathname
stat plus read can no longer synthesize one successful snapshot, and replaced
objects with identical bytes/mtime cannot satisfy the stable-snapshot comparison.
This fingerprint is internal stale evidence, not a portable unlink capability.

Open/parent-creation and stale-error classification capture original observations
before code/syscall projection, check again afterward and preserve independent
getter errors. Unknown native work cannot become a benign race, retry, missing
metadata or force-removal decision. Structured stale-removal diagnostics retain
the exact original falsey/frozen cause and original observations. Ordinary missing
or malformed metadata fallback and stale/corrupt lock recovery remain compatible;
the durable settlement-marked lock and process-local publication fences stay.

The actual-consumer fixture
`tests/shared/locks/file-lock-metadata-resource-lifetime.test.js` authors both
diagnostic readers, snapshots, stale checks, force removal and real acquisition
against disposable metadata. It covers short reads and method replacement, failed
close, original pending read, explicit close-only recovery without replay/unlink,
unknown numeric close, safe classification, falsey/frozen structured causes,
unknown open, ordinary missing/malformed behavior and replaced stale snapshots,
including distinct native IDs that round to the same double.

This grants no new resource registry, lease namespace, PID-death authority or
deletion rights. A completed diagnostic reader does not by itself make a later
pathname unlink atomic; the generic legacy removal's compare/unlink race remains
open. Actual failed synchronous close cannot safely retry a numeric descriptor.
The new eager pure descriptor-helper imports, native Windows locks, cross-process
recovery and performance/coupling budgets still require deferred qualification.
