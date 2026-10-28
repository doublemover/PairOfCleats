# VFS disk materialization integrity

Project-relative VFS paths remain mutable paths under the requested document
root. Their reuse policy is a current contained-descriptor observation, not an
immutable lifetime grant. File-based LSP collection additionally pins the actual
materialization through its original pooled or single-use client session. External writes after return cannot be prevented
by a cached receipt.

`ensureVfsDiskDocument` resolves the current root and virtual origin before using
cache candidates. A persisted absolute path is metadata, never an alternative
authority. Both cold and warm reuse qualify the requested path, UTF-8 byte length
and a SHA-256 of the supplied text. A cold/unknown identity reads and hashes current
descriptor bytes; an unchanged warm file may reuse that verified digest only while
device, inode, link count, size and nanosecond modification/change/birth times match.
All descriptor work and close must settle before a hit is returned. Missing or
changed content is materialized from the supplied text. Unsafe paths and original
resource failures retain their strict owners.

An active provider pin prevents this materializer from replacing that origin with
different content even after collection returns. Same-content consumer admission
requalifies the current descriptor; changed external bytes are refused while
readers remain. A request finishing, didClose notification, cancellation or an
unconfirmed kill does not release these pins. The existing pool's confirmed
original client disposal and all started publication/cache work precede retirement.
Shared consumers must all close. Retirement admits no further materializations,
and explicit release never repeats a failed write or changes its command outcome.

File-based collection supplies a source epoch derived from the selected root,
actual UTF-8 source bytes, virtual origins and document/dialect labels. Different
epochs turn over the actual client through the existing pool's creation and
disposal owners. Already-reserved requests finish in FIFO order before turnover;
confirmed old client/file/metadata retirement precedes a new client or replacement
write. Equal epochs retain healthy reuse. Cancellation withdraws its own turn,
and an unconfirmed old exit blocks replacement without an automatic retry.
Reservation occurs inside the existing creation barrier, so a newly created
session cannot be retired before its first borrower reserves a turn. Queued
borrowers remain protected from idle/capacity eviction.

Publication uses the shared atomic text owner and requalifies the published file.
The old direct overwrite cannot expose partial document bytes. Identical concurrent
in-process requests join one owner; conflicting active requests reject with that owner's
settlement observation. A failed close remains retained after the JavaScript job
finishes and prevents a later operation until explicit original settlement.
Existing queued last-write-wins coalescing retains its ordered prepublication
contract; it does not authorize retrying a conflict with another active publisher.
Batch failure stops new claims and joins active siblings before returning errors.

Returned materialization evidence records root, origin, requested hash, actual
SHA-256, bytes, descriptor identity and verification work. Sources distinguish
verified memory/cold candidates, independently verified existing files and created/
regenerated content. A missing requested docHash still requires actual expected
content qualification; it cannot admit stale bytes as a cache hit.
Semantic VFS routing and LSP binding versions advance so older derived provider
products cannot silently inherit the former disk-content assumption.

The sentinel-preservation oracle was invalid: it asserted that wrong bytes survived
as a hit. Its replacement checks correct restoration and separately proves that
unchanged verified content is not rewritten. Root changes, same-size mutations,
truncation, missing files, concurrent conflicts and publication/close failures have
dedicated coverage; no new symlink creation is needed.

These consumer pins provide in-process publication exclusion. Canonical build
tooling also supplies its actual repository, effective configuration and captured
launch environment. Before materialization, the same consumer acquires the existing
native-reader storage owner for the selected build root. Its repository/category
leases persist through idle client use, outstanding files and failed metadata
release; reuse keeps one owner per root/launch namespace. All admitted owners are
attempted during retirement. Semantic and legacy tooling routes carry this context
through generic, dedicated, Clangd, Pyright and SourceKit LSP adapters.

Cross-process publication now uses the existing file-lock and scoped resource
session owners. An exact-document writer guard serializes current descriptor
qualification, shared pin admission and atomic publication. Equal verified content
can share durable pins across processes. Replacement requires zero existing
exact-file pins; unknown or dead initiating owners do not prove resource closure.
The original client, every accepted materializer and cold-cache publication must
settle before pin retirement. Leaf metadata retires before category admission;
failed metadata recovery does not rewrite source or repeat provider shutdown.

Coordination is beneath the actual materialization root at `.poc-vfs-access`,
so callers with different application homes still share document arbitration.
That internal namespace, including canonical aliases, is unavailable as a
virtual-document target. It contains protocol metadata, not published source.
Unknown writer records remain protected; stale removal is limited to the exact
existing producer's definitely dead local lock. Standalone callers use the same
document guard/pin through their original operation; actual provider sessions
retain pins until client closure, including idle reuse.

Custom/external producer registration and category cleanup remain separate. A
configured path outside the canonical cache acquires no guessed category or
deletion authority. Uncooperative OS writers remain outside this protocol.
LSP binding version 58 invalidates products admitted under the earlier lifetime
policy. Ten cross-process/observer/namespace cases are authored and unexecuted;
existing root/content, provider, storage, native and full #1643 acceptance remain.
