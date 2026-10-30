# VFS provider consumer lifetime — 2026-10-28

**Unvalidated source:** `d8e6d540f5b4e1729b00ae91dc354eda3931d51b`, tree
`38a0391bdc2232bf73e73375dba5e822d632752d`; Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

The materializer previously forgot a successful publication when its write
finished, while a pooled LSP client could remain alive and lazily read that URI.
Another in-process request could then replace the same virtual origin with
different content. Current-descriptor verification alone did not own that reader.

The existing materialization owner now retains consumer references supplied by
the actual LSP pool session. Batched and direct fallback file URI preparation
carry that same session. Single-use and pooled clients retain publications
through outstanding work, idle pooling, cancellation and unconfirmed disposal.
Different-content writes reject while any consumer remains. Same-content reuse
requalifies the current contained file; changed external bytes reject without
rewriting a file still used by a provider.

Consumer retirement stops admission. Release requires the captured original
client's confirmed closure and all started publication/cache resource observers.
Failure retains the actual session and original file/cache prerequisites. The
pool retires these references only after its existing transport disposal checks;
recovery after confirmed transport closure does not run shutdown/kill again.
No write is replayed by retirement. Shared consumers all have to retire before
replacement is allowed. LSP binding producer version advances to 56.

Eight **unexecuted** `tooling/vfs/provider-session-lifetime/*` cases combine the
actual materializer and pool with tiny real files and an inert client. They cover
idle reuse, single-use disposal, cancellation, unconfirmed exit, shared consumers,
external content mutation, outstanding publication and an independently pending
cache owner. They assert original file content, conflicts after collection,
readmission after actual retirement and no repeated confirmed transport disposal.
Existing VFS integrity, cold-cache, batching, disposal/run-ownership and actual
provider checks remain required. No child or native binding ran in these authored
controls or during this source wave.

Format/ESLint, changed JavaScript syntax, config budget, generated command
inventory and whitespace checks pass. Shared-module analysis reports zero cycles.
No functional fixture, benchmark or publication front gate ran.

**Remaining source work:** these references provide in-process materializer
exclusion. Cross-process publishers, category cleanup/migration and external
backend roots still require the existing storage-session/category and producer
registration owners. A consumer pin gives no deletion authority and cannot
prevent external OS writers from changing a mutable project-relative path.
#1643 remains partial; actual source/provider/current-candidate qualification
and #1267/#1574 broader lifetime adoption remain.

Subsequent [canonical storage admission](vfs-storage-implementation-2026-10-28.md)
addresses the category seam for runtime-selected roots. The preceding remaining
list records this receipt's original checkpoint; external/cross-process and
current-candidate qualification limits remain.
