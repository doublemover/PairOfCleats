# Retained relation storage and disk ownership

The `graph_relation_edges` family reuses the existing semantic physical-part
writer. It consumes the graph owner's already sorted unique edge stream through
an internal ordered-entry route; every row still passes a strict increasing-order
check. This avoids sorting and spilling another copy of the same retained edges.
It does not create another semantic record/facts store.

The shared writer holds at most 1,024 output rows and 1 MiB of encoded row bytes
per part (a smaller admitted JSON transport limit is honored). It reserves each
part's data and offset bytes before creating them, hashes canonical rows, syncs
data and offsets, closes owned handles and syncs parent directories before
returning the completed descriptor. The retained graph adapter registers those
SHA-256 receipts with the existing pieces manifest. It writes family metadata
through the existing accounted durable metadata owner. High-degree tails occupy
small edge rows instead of one oversized neighbor array.

When available, the production graph owner shares the existing per-build semantic
disk account. Otherwise it reopens the current output footprint with the existing
working-set inventory and the already configured semantic storage disk allowance
(or that owner's default). This is a content-byte working-set bound on the adopted
retained output route, not a whole-application cache quota or a filesystem block
usage measurement. Initial graph collection/projection spill accounting is not
yet adopted and remains a separate acceptance gap.

Failed admission, I/O, ordering or cancellation prevents a completed descriptor
and publication. Cleanup releases credits only after deleting the owned directory.
If deletion fails, the original error remains primary, its cleanup error is
attached, and credits for uncertain retained bytes remain charged. Reopening the
normal working-set inventory counts those pending bytes. Retained parts and
metadata are candidate-generation artifacts; normal immutable publication and
retention owners decide visibility and eventual reclamation.

The page reader now verifies registered sharded metadata by its checksum, strict
artifact-specific schema and exact count/byte/path inventory. This permits a
registered, checksum-qualified zero-row family to enumerate as complete collected
empty evidence. A missing family remains unavailable. Metadata order is pinned to
the registered parts and the cursor scope domain advances so a cursor from an
older layout interpretation cannot alias another physical row. Response limits
remain separate from retained evidence cardinality.

Authored controls cover ordered-source exact rows, verified offsets/hashes, small
parts, no redundant input spill, quota refusal, cancellation, order refusal and
quota-plus-cleanup double failure. The production graph control also covers a
registered empty family versus a missing family and output disk admission.
Nothing has run: no tests, syntax checks, formatting, gates or measurements.
Durable unfinished propagation resume, full graph spill accounting, compressed
occurrence paging and end-to-end qualification remain open for #1348/#1484.


Canonical pieces manifests commonly register xxh64 receipts. The positioned
reader now accepts explicit xxh64, SHA-1 or SHA-256 for each data/offset pair,
using the existing incremental xxh64 owner when required. Its default remains
SHA-256. Large retained-handle reads still build SHA-256 block witnesses from the
verified physical bytes; selecting the manifest's fast digest does not remove
those mutation checks. Metadata initialization is asynchronous so the same
existing hasher can verify a bounded captured metadata buffer, with cancellation
and no whole evidence-array materialization. The actual production call-site
handoff exercises default manifest receipts; an additional authored large-piece
control covers every registered algorithm and equal-size in-place mutation.


Every scanned call-site and retained-edge row passes its existing canonical
compiled artifact validator before any request filter runs. A checksum-qualified
but malformed unmatched row therefore fails enumeration; it cannot disappear
behind a filter and produce a false valid exhaustion. The page route does not
maintain a parallel schema or relax the canonical artifact contract. A dedicated
authored unmatched-row control remains unexecuted with the other acceptance work.
