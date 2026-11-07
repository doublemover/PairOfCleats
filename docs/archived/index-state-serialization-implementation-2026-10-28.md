# Native index-state serialization — 2026-10-28

**UNVALIDATED source:** `b51a60c2e65a6e5109669716c762f608eb66edfa`, tree
`2b60597aead04aca7331c535ff7f77c50c6d2686`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

SQLite and LMDB previously read the same state independently before atomic
replacement, allowing one producer to overwrite another's namespace. Their
manifest checksum refreshes also ran outside a shared mutation interval.

The actual helpers now use `src/shared/index-state-publication.js`: the existing
file-lock owner serializes the contained state read, producer mutation, atomic
write and actual checksum/manifest refresh. A bounded five-second contention
wait uses the existing lock protocol. Known local dead owner cleanup requires
the complete known payload and exact original ownership; unknown, live and
unsettled owners are not retired. There is no new lease or authority system.

Producer patches are cloned before awaiting another writer. Validated namespace
updates merge the latest state and preserve other backend/extensions fields.
Required read/shape/UTF-8/write/hash/manifest failures propagate. Pending work
and independent release errors retain both original causes and actual lock
recovery capabilities. SQLite also sheds its unnecessary utility-reader import.

Cancellation before write performs no state replacement. Once a state write has
started, manifest refresh completes before cancellation is reported. This is
**cooperative native-writer serialization**, not a crash-atomic two-file commit:
manifest failure retains the actual already-written state and fails the command;
a later explicit mutation can repair its manifest. Embedding/initial-generation
writer adoption and wider publication recovery remain separate source scope.

Twelve `shared/index-state-serialized-publication/*` controls are authored,
**unexecuted**: parallel/queued actual SQLite/LMDB namespace updates, patch
snapshot, invalid namespace/state/JSON, actual manifest writer failure/recovery,
pending mutation, cancellation before/during publication, and two controlled
Node processes. The peer-process fixture observes actual lock contention before
releasing the first writer, then checks both native namespaces and final checksum.
All helper windows are hidden; message/exit waits are bounded at five seconds.
Filesystem fault/cancellation hooks target the actual JSON writer's synchronous
open, not a guessed asynchronous boundary. No native database, model, symlink,
elevation or indexing job is needed.

The twelve original native-state cases retain their assertions and now require
actual publication-metadata recovery after original writer settlement. No source
failure is converted to success by dropping a pending guard. These controls and
the existing artifact/bundle/incremental/replay/category/CLI and original issue
acceptance remain unexecuted for this source.

Format/ESLint, six JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture or child process ran.
#1267/#1574/#284 remain open with broader source/qualification scope. Counts
remain **480 pending, 145 partial, 93 unresolved** of the latest 718-open
inventory. This source is unpublished; the publication gate remains deferred.
