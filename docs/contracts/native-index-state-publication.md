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

SQLite/LMDB namespace mutations now share the existing file-lock owner across
the actual state read, mutation, write and manifest refresh. Reads are bounded
and contained; only actual absence starts empty. Namespace shape is validated,
producer patch data is captured before waiting, and unrelated fields come from
the latest state. Known local dead owners can retire only their exact original
lock; live, unknown and unsettled owners stay protected. Pending work retains
the actual lock publication session for explicit metadata recovery.

State and manifest still use individual atomic writers; this is not a crash-atomic
two-file transaction. If the second publication fails, the command fails and
preserves the actual already-written state. A later explicit mutation can refresh
its checksum. Cancellation before write leaves both files unchanged; once a
state write starts, its manifest refresh completes before cancellation is
reported. Embedding state writers now use the same owner with original-loaded
field deltas: unchanged native fields and unrelated extension keys come from the
latest state. Conflicting changes fail with `ERR_INDEX_STATE_PUBLICATION_CONFLICT`.
Baselines are private, object/path-bound hashes; copying a state does not authorize
replacing a present generation. JSON request data is captured before waiting.
Initial embedding claims compare the original attempt reference; later writes
require that attempt. Terminal reloads retain the original generation and attempt,
so failure reporting cannot mark replacement work failed. Identity changes fail.
Validation reads and embedding manifest updates use the same publication lock.
The runner supplies its original state capability before manifest/validation work;
a replaced attempt cannot publish a manifest or commit a validation receipt.
Initial-generation writers, crash-atomic recovery and cleanup remain separate scope.

Twelve `storage/native-index-state-publication/*` cases are authored and
unexecuted. They cover actual SQLite/LMDB producer reads/writes, invalid state,
manifest parse/write/checksum failures, frozen original observations and healthy
byte/checksum/extension preservation. Existing artifact/bundle/incremental,
embedding manifest, native-command and original/follow-up acceptance still need
execution on the resulting candidate.

Twelve additional `shared/index-state-serialized-publication/*` cases cover
actual native state producers, parallel/queued namespaces, immutable patch
capture, invalid input, manifest failure/recovery, original pending mutation,
cancellation and controlled peer-process contention. The original frozen writer
failure checks also require actual publication-metadata recovery. All remain
authored and unexecuted.

Nineteen `indexing/embeddings/state-publication-conflicts/*` cases are authored
and unexecuted for native/extension merging, conflicting/idempotent writes,
deletion, generation identity, copied/path-mismatched objects, attempt claims,
stale ready/terminal publication, queued snapshots, later caller mutations,
repeated native changes, prototype-named extension data and invalid extensions.
Existing publication-readiness and terminal-failure assertions remain; their
setup now loads actual baselines and injects at the actual contained-open owner.

Embedding manifests capture requested backend pieces before lock admission, then
read the latest manifest under ownership. Present legacy HNSW metadata must pass
its canonical schema and safe count/dimension checks; only actual absence uses
legacy defaults. Explicit backend generations do not consult unselected legacy
metadata. Required read/hash failures propagate, including original unmarked
pending observations; they cannot authorize backup or fallback publication.
Settled invalid/missing primary manifests retain explicit valid-backup recovery.
File checksums and byte extents share the same verified contained descriptor.
Twenty-seven `indexing/embeddings/manifest-publication-ownership/*` controls are
authored and unexecuted for these paths, native-writer contention, captured
requests, stale-attempt admission and unchanged original manifest on failure.
Validation and ready-receipt commitment retain one publication owner; captured
original validation/receipt observations survive getters and callback failure
through actual metadata release. Original-session recovery never repeats work.

Service replay resets legacy unowned pending state through the same mutation
owner against its original generation/invocation/embedding witness. It retains
current native namespaces and extensions. Persisted attempt-owned state remains
with that invocation; the next actual Stage3 run performs its explicit initial
claim. Legacy staging pathnames are diagnostics, not deletion authority or proof
of partial current work. Outside-buildRoot jobs and noncanonical modes fail.
Fourteen `services/indexer/embedding-replay-publication/*` controls plus the
original replay/executor/soak cases are authored or retained, unexecuted.

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
