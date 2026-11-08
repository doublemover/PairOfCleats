# Initial state publication and sealed observations — 2026-10-28

**UNVALIDATED source:** `cdc6ab2c44b37a2b87c39b23b9ae49cfc19b4049`, tree
`020afe75081f6d57e9f968e6ecc1d4b12702c929`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The initial artifact writer still replaced state and later published a manifest
outside the shared native/embedding owner. Optional reuse/size fallbacks could
also discard unsettled original read failures. Sealed byte metadata coerced null,
false and strings, while manifest error wrapping discarded original resource
observations and used a separate stat for newly calculated checksums.

Initial publication now captures a private original-content fingerprint before
enqueueing state work. Actual state/compact metadata and later manifest writes
each hold the existing shared publication mutex. The same private path-bound
session verifies current contents before either interval and advances only after
successful work. A changed native namespace, invocation or generation between
phases fails instead of being discarded. It supports intended replacement of an
observed prior staged state without treating a caller-supplied build ID as proof.
Producer state and manifest-piece intent are captured before waiting; manifest
metadata snapshots retain only the fields that writer consumes.

Reuse and optional size diagnostics retain original unsettled failures. Session
callbacks retain successful original observations through actual metadata release.
Manifest stat/hash errors preserve original causes and resource prerequisites.
Newly calculated file checksums and byte extents share one contained descriptor;
the mutable index-state piece is always refreshed under the mutex. Existing
precomputed checksums for sealed immutable pieces retain their fast path. Unknown
sealed bytes stay unknown; invalid typed/count observations fail, and measured
zero remains zero. No threshold, public knob or artifact format is relaxed.

Seventeen `indexing/artifacts/initial-state-publication/*` controls are authored,
**unexecuted**: actual initial JSON/manifest ownership, changes before state or
manifest, native publication, private session/path checks, pending successful
work, same-descriptor extent, null/invalid sealed sizes, original pending stat/hash
and reuse reads, mutable-state checksum refresh, queued request snapshots and
registry zero/unknown handling. Existing full artifact/bundle/incremental/replay,
native/embedding and initial-publication finalizer coverage still needs execution.

Format/ESLint, seven JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. Serialization and content conflict guards do not make
the state/compact metadata/manifest pair crash-atomic or grant generation cleanup
authority. Paired-publication recovery and broader cleanup/source gaps remain.
#1267/#1574/#284 stay open; counts remain **480 pending, 145 partial, 93 unresolved**
of 718 open issues. Source is unpublished; the publication gate remains deferred.
