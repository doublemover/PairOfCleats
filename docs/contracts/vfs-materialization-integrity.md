# VFS disk materialization integrity

Project-relative VFS paths remain mutable paths under the requested document
root. Their reuse policy is a current contained-descriptor observation, not an
immutable lifetime grant. A caller needing a stable document set must retain its
existing session/root isolation; external writes after return cannot be prevented
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

Cross-process publishers and readers that need a URI to remain stable after this
operation still need a session/generation lifetime owner. The descriptor receipt
does not provide that lease. That remaining #1643 scope stays explicit rather than
promoting current-file verification into immutable reader-lifetime qualification.
