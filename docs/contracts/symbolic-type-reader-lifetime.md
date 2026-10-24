# Symbolic type reader lifetime

Status: UNVALIDATED source and authored controls, 2026-10-22.

The published symbolic-type store borrows its bounded manifest and graph reads
through the existing contained-file owner. That owner captures original
FileHandle read/stat/close methods and receivers, drains admitted native work,
preserves independent operation and close failures, and withholds returned bytes
until original close is confirmed. The reader verifies the same opened physical
object against its generation root before returning its buffer. Existing
manifest/graph byte limits, fixed read windows, registered checksums, graph
identity and query semantics remain unchanged.

Missing/corrupt error mapping captures original resource observations before
reading diagnostic codes, rechecks the same observation afterward, and retains
it through remapping or a throwing getter. A failed native close cannot become
an ordinary missing artifact or a cacheable symbolic answer. Frozen and falsey
primary failures remain in the original cause/error graph.

Recovery uses only the existing privately authenticated per-descriptor session.
It explicitly reconciles original native close after all original observations
permit destruction. It cannot replay reads, checksums, graph hydration or a
query, and cannot publish the withheld graph into the store's active context.
There is no new registry, group release capability, automatic retry or metadata
deletion authority. A later query acquires and verifies the graph afresh.

The authored registered-writer/piece-manifest/store fixture covers successful
queries, original method replacement, manifest/graph close faults, withheld
cache admission, falsey/frozen read and independent close failures, pending
native work with replaced observers, byte-limit cleanup, code-getter mutation
and falsey/pending inspection errors, explicit recovery without read replay,
and ordinary missing-graph classification. It has not run. Outer transport,
generation leases, arbitrary abandoned callers, native/platform/full-build and
performance qualification remain open. Shared semantic producer meaning and
artifact formats do not change in this lifecycle repair.
