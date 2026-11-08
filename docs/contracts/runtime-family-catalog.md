# Saved runtime family catalog

Runtime imports maintain a version 1 catalog under the existing exclusive
destination writer and disk account. `family-catalog.json` selects one committed
prefix of `family-catalog.bin`. Discovery reads this index instead of enumerating
the generations directory. Catalog membership never proves family validity:
discovery still checks each returned immutable manifest identity and capture
hash, while direct pinned lookup retains its separate full query admission.

## Bounded physical structure

The store is an append-only compressed hexadecimal radix tree. Leaves contain
one generation identity; branches retain an ordered prefix and at most 16 child
references. References bind exact byte spans, SHA-256 hashes and subtree counts.
Nodes are at most 4 KiB, child offsets precede their parent, and every traversed
prefix grows strictly toward a 64-digit generation identity. The request retains
at most 64 cached nodes, a depth-bounded traversal and `limit + 1` identities.

The existing `maxScan` allowance bounds physical catalog-node reads. The internal
metrics report actual node reads and bytes; `scannedDirectories` is zero.
Directory size and unrelated entries do not determine page work. Byte, time,
abort and family limits remain enforced, including the full serialized response.
Reading or verifying the whole store is not an interactive fallback.

## Publication and recovery

The destination writer retains original fulfilled-result, operation-error and
cleanup resource observations in its existing file-lock owner. Outstanding work
keeps both metadata and disk reservations fenced. Inventory refunds occur only
after confirmed metadata release; settlement alone does not remove that lock.
After the original native owner settles, its exact file-lock publication session
can release metadata without replaying the operation. A subsequent admitted writer
reconciles the retained ledger.

Only an active account from the original destination writer can mutate the
catalog. An insertion plans at most 66 nodes, appends their bounded bytes as one
batch, syncs and closes the actual descriptor, then publishes the small commit
selector through the existing control-publication owner and parent sync. Native
SQLite loading remains outside the catalog read dependency closure.

Family verification precedes catalog registration and current-pointer
publication. A failed registration leaves a fully promoted family recoverable
through the existing recipe. A later matching import re-verifies that family and
registers it before repairing the current pointer. Registration of an already
cataloged identity performs no append or selector write.

The publication-work fixture records each successful control rename's actual
destination. An interruption after family promotion requires one catalog selector
and one current selector; an ordinary repeat requires neither. A common temporary
filename prefix cannot identify which control was rewritten. Immutable-family,
native-image, byte-headroom and pinned-reader assertions remain independent.

The committed extent separates reachable nodes from an interrupted append tail.
A retry trims only that unpublished suffix and returns its credits after
confirmed truncation; committed snapshot bytes remain intact. Writable stores
with external hardlink aliases are rejected. Retained nodes and controls count
toward the original destination working-set limit. The append-only store retains
earlier published prefixes; compaction or retirement requires a separate reader
lifetime policy rather than automatic deletion during discovery.

A missing selector can recover an initial header only when the generations
directory is empty and the node store contains exactly that header. Nonempty
uncataloged destinations, malformed versions, corrupt nodes and missing stores
report `ERR_RUNTIME_CATALOG_REQUIRED`: re-ingest authoritative runtime inputs
into a fresh destination. No older directory-scan adapter or automatic catalog
rebuild remains. Healthy explicitly pinned family lookup can still operate
without a catalog because it does not discover membership.

## Cursor policy

Discovery cursor version 2 binds the canonical destination, request allowances,
last delivered identity and exact published catalog snapshot. Version 1 cursors
are rejected. A continuation verifies its bounded commit reference and requires
its boundary identity to belong to that snapshot. Imports sorting before or
after the boundary are excluded from the existing traversal; both appear only
in a fresh discovery pass. Generation ordering and exact-once traversal describe
this declared snapshot, not a live filesystem transaction.

Eight independently bounded catalog controls cover ordered progress, additions
on both sides of a cursor, interrupted selector/tail recovery, missing/corrupt
state, explicit cutover, initial-header recovery, cancellation/read budgets and
writer authority. The actual import/query selection fixture also checks snapshot
stability across a later import. Runtime execution and serial measurements at
1/32/1,024/>4,096 families remain pending.
