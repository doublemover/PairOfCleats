# Risk witness storage

Each admitted risk path hop stores one immutable parent link, destination chunk,
sampled call-site IDs and watch step. Siblings share a prefix. There is no global
parent-node arena, copied full-path array or serialized full-path priority on
enqueue. The existing frontier heap releases popped state slots. Witness nodes
remain reachable through admitted descendants and alternate-witness bookkeeping;
their count follows the existing root, depth, edge and per-state path admission
bounds, rather than an additional history of consumed queue objects.

The queue keeps its depth, sanitizer-barrier and encoded JSON lexical order.
Comparing equal-depth linked paths compares original encoded scalar tokens,
including escaping, before call-site steps and taint identity. Distinct same-depth
alternate witnesses remain admitted under the existing reconciled path contract.
The representation does not change admission caps or infer additional certainty.

Complete and partial output emission materializes fresh path arrays. Flow IDs,
call-site order, sanitizer/watch semantics and timeout-frontier rows retain their
existing output contract. Mutable emitted arrays cannot alter a retained prefix.

Authored queue/output fixtures and the existing convergence, taint, sanitizer and
cap matrices remain unrun in the current source-only development pass. Retained
heap, node/array counts, CPU and latency have not been measured; no resource or
speedup acceptance is claimed.
