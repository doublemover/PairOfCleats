# Required native index-state publication

SQLite and LMDB state changes are required publication work. An in-memory
`ready` object does not establish a completed write. Existing malformed state,
state write failure, manifest parse/shape/checksum failure and manifest write
failure propagate through the original command/operation owner. A malformed
existing state cannot silently become an empty replacement.

The existing JSON/atomic-file owners still perform writes and retain original
descriptor, temporary-file and publication failures. The state-manifest owner
refreshes only its `index_state` piece, preserving unrelated pieces and caller
extensions. Missing legacy manifests or manifests without an index-state piece
retain their optional compatibility behavior. A present invalid manifest fails.

LMDB metrics remain optional only after their original resource observation
confirms settlement. A pending or unreadable observation fails the command and
keeps its resource prerequisites. It cannot be hidden by best-effort reporting.

State and manifest use their existing individual atomic writers. This change
does not create an atomic two-file transaction or claim new concurrent-writer
serialization/recovery. If the second publication fails, the command fails;
the error retains its original ownership evidence. Broader category registration,
publication recovery and cleanup authority remain with their existing owners.

Eleven `storage/native-index-state-publication/*` cases are authored and
unexecuted. They cover actual SQLite/LMDB producer reads/writes, invalid state,
manifest parse/write/checksum failures, frozen original observations and healthy
byte/checksum/extension preservation. Existing artifact/bundle/incremental,
embedding manifest, native-command and original/follow-up acceptance still need
execution on the resulting candidate.

The state-manifest checksum and byte extent now come from the same verified
contained descriptor. The shared hasher returns its immutable observation only
after original descriptor closure; existing checksum-only callers retain their
return contract. A path stat from before that read cannot supply the receipt's
size. The added `manifest-size-race` regression forces the historical split
observation and checks the actual manifest against current bytes; it is unrun.

SQLite compaction also requires successful table metadata and nonnegative safe
integer counts. Required `chunks` or `dense_vectors` query failure cannot stand
in for zero rows. Native/observer failures propagate through the existing command
owner and original physical closure; metadata recovery cannot repeat that close.
Eight authored `storage/sqlite/compact-count-failure-ownership/*` cases cover
metadata/query/pending/invalid/missing-table failures, real empty dense data and
nonempty dense preservation. These cases remain unexecuted.
