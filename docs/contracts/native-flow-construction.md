# Native structured control-flow construction

The #1682 source repair replaces the file-wide derived row array with a pull
generator consumed by the existing `writeSemanticAnalysis` owner. No row is
constructed beyond a paused yield. Child and alternative traversal uses indexed
access rather than arrays proportional to statement width. The existing depth192
conservative fallback remains; source/parser trees, syntax anchors and owner
inventories remain separately retained by syntax collection.

One producer admits at most128KiB of logical construction capacity, lowered by the
existing CFG/queue policy. Its reservation uses the existing FIFO byte-admission
implementation in a distinct construction phase shared by the disk account,
with16MiB aggregate capacity. It never consumes the writer credits needed to drain
its own output. No new scheduler, configuration or public format is introduced.

Construction owns live traversal frames (256 logical bytes per frame), at most
16KiB of distinct reason strings, and one current prepared entry (at most32768
encoded bytes, further lowered by batch/queue bounds and half the construction
allowance). Encoding admits bytes before producing a canonical snapshot. Work
checkpoints cover traversal, child access and encoding; their limit is32 times
construction capacity. Statistics report constructed rows, work, live/peak frames,
one current entry and logical reserved bytes. They describe structural/encoded
allowances, not actual JavaScript object sizes, total heap/RSS or elapsed time.

Earlier yielded immutable entries belong to the writer's separate bounded batch
and one lookahead entry. The writer waits for actual append before advancing;
active writer buffers retain existing queue-byte admission. Construction lease
release does not assert writer, parser, source or disk settlement. Each owner
releases only its actual scope, avoiding construction/writer credit deadlocks.

Normal row order, IDs, forward references, owner separation, branch/loop/abrupt
destinations, evidence and modeled certainty are retained. The existing sink
checks forward local references before finalization. Private construction limits
abort the entire derived staging partition before returning partial coverage with
`native_flow_construction_*_limit`, unknown observed count/frontier and zero
completed count. Syntax publication remains independent. A sealed prefix cannot
stand in for a whole flow. Native producer version advances2→3 because admitted
incomplete outcomes change; shared policy/replay identity includes that version.

Only the exact private construction stop can produce this incomplete result.
Cancellation, append/finalize failure, pending original resource observations,
failed staging abort and independent native tree closure remain errors. The
shared abort helper and file owner retain falsey/frozen originals and independent
cleanup through the storage failure compositor, including settlement callbacks
captured before cleanup. A close/abort failure is never hidden by a partial result.

New unrun controls author independent tiny ID/edge expectations, flat N/2N/4N and
multiple-owner work/retention bounds, branch/break/continue/return reachability,
low live/work/entry admission and cancellation. An instrumented actual durable
writer pauses append, checks construction stops at one bounded batch/lookahead,
reconciles stored output, and injects budget, abort, append/finalize and cleanup
failure. A separate file-owner seam retains falsey/frozen failures and original
tree-close observations. These simulated syntax seams do not qualify a grammar.
The original Python/C/Swift/Rust parser/storage/ownership fixture is unchanged.
All functional assertions and native/platform/performance qualification remain
deferred; syntax/format/discovery observations do not imply their execution.
