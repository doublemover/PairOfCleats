# Persistent JSONL reader resource lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The actual `openJsonlRowReader` keeps its original data and offsets descriptor
owners through admission, positioned reads, integrity verification and close.
The existing paired reader compositor now supports both callback scopes and
this explicit borrowed lifetime. There is no second reader registry, group ID,
combined release capability or path-based resource discovery. Strict admission
continues through the original contained owner without detach and recapture.

Each descriptor owner supplies its own captured `isSettled` observation. The
async contained callback's second argument exposes only this observation, never
close, detach or release. The compositor's completion status uses those actual
observations plus every captured independent original error. Its internal
boolean is not a settlement receipt. Existing per-descriptor private sessions
remain the only failed-close recovery capabilities.

Reads and validation borrow frozen original methods and receivers. Every
admitted read/verification operation drains before close. A rejected operation
captures its original observer before returning to the caller; later method or
pending-marker replacement cannot authorize more reads or actual destruction.
Every independent original is composed before either descriptor's lifetime gate
closes. Bounded failure history overflow stays unknown. Both verification reads
settle and retain both failures rather than choosing only the first rejection.

The small verified-snapshot branch switches to its exact hashed buffers only
after both original descriptors confirm close. A successful hash followed by a
close failure cannot publish the in-memory reader. Close-only recovery never
rehashes, publishes a snapshot, rereads rows or reruns validation. Large pieces
retain the same descriptors and existing per-block digest/identity checks.
Existing byte limits, supported digest algorithms, row order, duplicates,
coalescing bounds and fixed validation windows remain unchanged.

`close()` drains admitted high-level work and reports failed descriptor closure
or independent original work. A settled ordinary read/parse failure, already
returned to its caller, remains compatible with successful close. Successful
close is idempotent. Failed close is cached and never implicitly retried; callers
must explicitly reconcile each actual session in the nonenumerable
`containedFileSessions` array. The outward original observer can then confirm
settlement, while the failed close promise remains a failure and no value is
replayed. An exact compositor completion error is excluded from its own input
history by private identity, avoiding a snapshot-failure self-cycle.

The batch `readJsonlRowsAt` facade directly uses the same callback compositor.
It withholds even valid rows until both descriptors close, preserves primary and
independent cleanup failures, and honors an explicit contained root. Failed
parallel admission likewise waits for all opens and retains failed peer closure.

The authored actual-FileHandle fixture covers strict/legacy positive reads and
ordinary read-error cleanup, original method replacement, concurrent drain,
verified snapshot and large-block paths, falsey/frozen admission/read/close
composition, dual failed closes, original native observer replacement before
destruction, nonvoid close, hash-success/close-failure snapshot suppression,
explicit exact recovery without read replay, and withheld valid batches. Existing
offset/cardinality/checksum and unified-reader assertions remain authored.

Callers outside this owner can still suppress cleanup exceptions or mutate a
frozen primary while handling close. Semantic store scope disposal and retained
evidence page cleanup need separate adoption; this change does not repair those
caller contracts or claim category/index/coordinator lease retention. An
abandoned reader remains its caller's responsibility. There is no durable
cross-process native settlement, automatic native retry or metadata unlink
authority. No tests, syntax/lint/format, bootstrap, native/platform/full-index or
performance acceptance has run, and no issue completion is claimed.
