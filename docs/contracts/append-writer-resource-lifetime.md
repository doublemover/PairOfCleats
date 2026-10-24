# Queued append descriptor ownership

Status: UNVALIDATED source and authored controls; no runtime/native/cross-process,
import-budget or performance acceptance was run for this batch.

The shared queued append writer still batches accepted strings with their separate
UTF-8 encodings, preserves order, drains accepted records before normal close and
keeps ordinary settled I/O errors best effort through `onError`. An enqueue
fulfillment is not a persistence receipt. No diagnostic path is replaced under a
live append handle, and this helper does not rotate or delete evidence.

The actual append FileHandle now uses the existing contained-file resource owner.
Its original writeFile, sync and close methods are captured before the first
operation. Original errors and diagnostic callback failures are observed before
another write, sync or close is admitted. A false or absent marker and replacement
observer cannot bypass an original independent pending prerequisite. Nonvoid
write/sync/close acknowledgements cannot authorize closure.

Flush is serialized on the accepted-write chain. Close stops new admission and
drains that chain, so concurrent flush and close cannot close a descriptor still
owned by a sync call. A pending native operation or diagnostic failure stops later
writes. Flush/close then reject with original causes and the actual existing
contained-file close-only capability where a FileHandle was opened. An unknown
open failure has no invented descriptor capability. Ordinary best-effort enqueue
calls remain fulfilled; unresolved errors are also reported through `onError`.

A failed close is cached as a failed outcome and its handle is retained by the
existing resource owner. Repeated close/flush calls cannot retry that native close.
Only the actual session may explicitly reconcile its captured FileHandle after
every original prerequisite confirms settlement. Recovery never reopens the path,
replays accepted appends, fsyncs again or changes the historical failed close
outcome. No numeric descriptor or serialized error can recreate that authority.

The authored actual-writer fixture covers captured method replacement, real
FileHandle close failure and explicit recovery, pending write/sync prerequisites,
callback secondary ownership, falsey/frozen ordinary failures, unknown open work,
nonvoid close and a controlled flush/close barrier. The existing flush-after-close
fixture retains its drain, descriptor count, bounded batching and split-surrogate
assertions unchanged. No fixture has been executed for this source batch.

This is descriptor ownership, not category/coordinator admission or a durable log
journal. Callers still must close their writer and handle flush/close failures;
discarded higher-level callback promises, external path rotation, abandoned writers,
multi-process ordering and bounded shutdown policy remain separate consumer
qualification. Async diagnostic callbacks are awaited as admitted callback work;
an uncooperative callback is not falsely declared settled.
