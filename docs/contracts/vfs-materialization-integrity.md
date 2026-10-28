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
regenerated content. A missing requested docHash retains forced materialization.
Semantic VFS routing and LSP binding versions advance so older derived provider
products cannot silently inherit the former disk-content assumption.

The sentinel-preservation oracle was invalid: it asserted that wrong bytes survived
as a hit. Its replacement checks correct restoration and separately proves that
unchanged verified content is not rewritten. Root changes, same-size mutations,
truncation, missing files, concurrent conflicts and publication/close failures have
dedicated coverage; no new symlink creation is needed.

These consumer pins are in-process publication exclusion. Cross-process writers,
category cleanup and migration still need their existing storage-session admission
and producer identity; neither the descriptor receipt nor this pin grants deletion
authority. That remaining #1643 scope and actual provider/runtime qualification
stay explicit. LSP binding producer version 56 separates the new lifetime policy.
