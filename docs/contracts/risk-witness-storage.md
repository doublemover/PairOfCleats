# Risk witness storage

Each admitted risk path hop stores one immutable parent link, destination chunk,
sampled call-site IDs and watch step. Siblings share a prefix. There is no global
parent-node arena, copied full-path array or serialized full-path priority on
enqueue. The existing frontier heap releases popped state slots. Witness nodes
remain reachable through admitted descendants and current-layer alternate-witness
bookkeeping. Depth is the first queue priority and every expansion advances one
depth. At the first pop in a new layer, all shallower parents have finished; their
destination deduplication keys cannot be queried again. The index is cleared then,
retaining shared ancestry through the descendants that still need it. Completed
leaf witnesses do not accumulate in a separate parent arena.

The queue keeps its depth, sanitizer-barrier and encoded JSON lexical order.
Comparing equal-depth linked paths compares original encoded scalar tokens,
including escaping, before call-site steps and taint identity. Distinct same-depth
alternate witnesses remain admitted under the existing reconciled path contract.
The representation does not change admission caps or infer additional certainty.

Complete and partial output emission materializes fresh path arrays. Flow IDs,
call-site order, sanitizer/watch semantics and timeout-frontier rows retain their
existing output contract. Mutable emitted arrays cannot alter a retained prefix.

The [Windows closeout](../archived/risk-witness-retention-closeout-2026-11-05.md)
qualifies76 focused cases, including exact representation parity, the existing
risk family and36 serial fresh-process measurements. Original completed-layer
retention failures and all54 original/candidate/control raw samples are retained.
Index, consumed-queue and copied-prefix work bounds are qualified. Sampled heap
is distinguished from exact peaks, and mixed timing results do not establish a
general latency gain. Risk-enabled operation remains separate from the disabled
default and from end-to-end build throughput.
