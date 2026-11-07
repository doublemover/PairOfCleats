# Retained graph edges

`graph_relation_edges` is an additive, strict artifact family for resolved
adjacency retained before display projection limits. Rows contain exactly
`schemaVersion: 1`, `graph` (`callGraph`, `usageGraph` or `importGraph`), `from`
and `to`. The canonical artifact registry, JSONL required keys, sharded metadata
and offsets registration share this contract. The existing artifact surface is
not relaxed; the new family has its own explicit row version and producer owner.

The producer reuses the existing sorted spill/deduplication stream. Existing
`graph_relations` node/neighbor arrays remain a bounded presentation projection.
Readers bind retained pages to the exact immutable generation, manifest pieces,
filter/direction/order and byte/work limits. Missing or unsupported retained
artifacts mean unavailable retained enumeration, not an empty complete graph.

Retained adjacency, distinct source occurrences and observation multiplicity are
separate. Unresolved or ambiguous calls remain addressable through canonical
call-site and semantic evidence owners. Enumerating every emitted resolved edge
does not prove that upstream scanning, inference or target resolution completed;
their durable generation-bound coverage must remain visible.

Schema, producer/reader and full-page regression sources are being authored.
Runtime, replay, failure and performance qualification are deferred. This contract
does not claim current end-to-end preservation or a passing acceptance run.
