# Exact reservation metadata identity

Status: UNVALIDATED implementation and source-authored focused controls.

The 2026-10-23 installer consumer failure reported
`ERR_STORAGE_ADMISSION / write-reservation-file-changed`. Source tracing found
that settlement compared an exact BigInt `lstat` inode with default numeric
FileHandle stat values. Native Windows file IDs may exceed double precision, so
stringifying a rounded numeric inode cannot recover the original identity.

Reservation sealing and current-record reads now retain the existing verified
reader's descriptor-bound `fileIdentity` strings. Those strings were produced
from exact BigInt opened-object checks, after byte/hash/final containment checks
and confirmed close. Final pathname identity must match both exact seals; no
rounded fallback, tolerance or authority relaxation is added. Byte hash, logical
reservation fields, single-link regular-file checks, coordinator ownership and
explicit resource settlement remain required.

`tests/shared/storage/write-reservation-exact-file-identity.test.js` controls only
native identity observations around real disposable reservation/coordinator and
descriptor owners. It authors legitimate large-ID settlement plus duplicate
acknowledgement, and a same-bytes physical replacement whose distinct exact IDs
round to the same double. The replacement is preserved and no unlink is attempted.
Only explicit fixture restoration of its original object permits reconciliation;
production recovery never discovers a renamed record or adopts matching bytes.

The archived Windows runner failure identifies the real consumer but does not
itself record both inode representations. The precision mechanism is source
evidence and the new controlled fixture is authored, not executed. The original
ast-grep installer fixture, native Windows acceptance, generic compare/unlink
races and whole storage qualification remain deferred. No vendor recipe, global
cache, user toolchain, reservation namespace or cleanup authority changes.
