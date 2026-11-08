# File hash descriptor lifetime

Implementation and new regression coverage remain UNVALIDATED in the parallel
wave. Formatting is recorded separately from feature/runtime qualification.

`sha1File`, `sha256File` and `checksumFile` borrow one exact FileHandle through
the existing contained-file resource owner. Contained reads use its existing
canonical path/no-follow and opened-object verification. Legacy raw paths use
the same descriptor resource owner without acquiring containment authority.
Neither path transfers a numeric descriptor into an independently closing stream.

The hash consumes the admitted regular-file extent in positioned windows of at
most 64 KiB, completes positive short reads and rejects premature EOF, invalid
progress or changed final descriptor identity/size/timestamps. The contained
descriptor is verified again before digest admission. Cancellation is checked
before open and between windows; an actual native read already admitted is
awaited through its original owner. No whole-file copy or model/backend execution
is added. Hash creation, update and digest keep their original receivers and
captured functions. The selected xxhash backend exposes an incremental hasher
using the same create64/formatting as its existing stream path, including its
existing WASM streaming fallback when a native module lacks incremental support.
Algorithm names and checksum bytes remain unchanged.

The digest is withheld until standard void original close confirmation. A failed
read/hash operation with an original native observer blocks actual descriptor
destruction; replacing that observer cannot authorize close. Failed FileHandle
close retains the actual contained-file capability and all original failures,
including falsey/frozen values. Only explicit exact-handle reconciliation may
retry close. It never reopens, rereads, updates, digests or returns a prior value.

`tests/shared/hash/file-resource-lifetime.test.js` authors actual raw/contained
SHA1/SHA256/xxhash API cases for byte parity, bounded positive short reads, failed
and false close, no-replay recovery, pending read/update originals, independent
falsey read/close failures, method replacement, changed stat/invalid progress,
cancellation and empty files. The original delayed-close fixture now observes
actual FileHandle opens/closes and retains every earlier completion/missing/
hash-create/update/digest assertion; its stream-only hook would no longer observe
the adopted owner. The separate xxhash backend parity fixture remains intact.

Final stat and containment checks are not an immutable snapshot against an
external writer that restores the same metadata. No index/category lease,
cross-process authority or atomic publication is acquired by hashing alone.
Raw `hashFileStream` and independently borrowed streams retain their existing
caller lifetime contract. Platform/native/backend/performance qualification and
broader storage issue acceptance remain open.
