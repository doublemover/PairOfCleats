# LSP source epoch turnover — 2026-10-28

**Unvalidated source:** `489e067e630333429ca35a6d0cf3f3ab6e38843f`, tree
`d2daa96f9bdcb695a143721b4d7e8ebb774add53`; Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

The [VFS consumer lifetime](vfs-consumer-implementation-2026-10-28.md) and
[canonical category admission](vfs-storage-implementation-2026-10-28.md) now have
orderly content-revision turnover. Keeping the old client pinned is necessary for
an active URI; a later request with different bytes also needs a usable new client.

File-based collection hashes its selected root, actual UTF-8 source bytes,
virtual origins and document/dialect labels with length framing. Hashing streams
source strings without concatenating the complete document set. Claimed hashes
alone cannot identify an epoch. Stable origin ordering permits reuse across
equivalent input order; duplicate-origin order remains significant.

The existing pool creation barrier holds later epoch admission while all already
reserved predecessor turns finish. Actual old client/file/metadata disposal must
succeed before a new client or replacement file is admitted. Equal epochs reuse
the healthy client. Unknown exit retains its existing disposal barrier and causes
replacement to fail; no native-status retry or backend switch occurs.

Queue reservation now happens inside that same creation owner before the session
is exposed. Previously a new session could be observed between creation and its
first caller's queue reservation. Cancelled creation/queued calls withdraw only
their own turn after its predecessor; live/queued turns prevent idle/capacity
eviction. Confirmed transport disposal is not repeated during later file/metadata
recovery, including kill-first paths. LSP binding producer version advances to 57.

Nine **unexecuted** `tooling/lsp/materialization-generation/*` cases combine the
actual pool/materializer with tiny real files and an inert original client. They
cover digest/root/byte identity, edited content with an unchanged reported hash,
same/distinct queued epochs, cancellation during epoch wait and creation,
unconfirmed exit, different roots and invalid internal identities. Existing FIFO,
queued-cancellation, pooling/health/disposal, native provider and canonical lease
checks remain required. Hashing and retirement have no measured performance claim.

Format/ESLint, changed JavaScript syntax, config budget, command inventory and
whitespace checks pass; shared-module analysis reports zero cycles. No functional
fixture, native binding, child, benchmark or publication front gate ran.

#1643 remains partial for cross-process writer arbitration, external/custom
producer registration and complete original/follow-up execution. #1267/#1574
retain their broader category/backend requirements. This does not qualify a whole
compiler invocation's file/environment read closure or attribute a native crash.
