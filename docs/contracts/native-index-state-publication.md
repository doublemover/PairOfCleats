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
Initial artifact writers also join the shared owner using private path-bound
original-content fingerprints. State/compact metadata and later manifest writes
each revalidate that snapshot; newer native/invocation state fails publication
instead of being replaced. Intended replacement of an observed prior staged state
remains possible. This does not make the pair crash-atomic; recovery and cleanup
remain separate scope.

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

Initial writers capture producer JSON and manifest intent before waiting.
Unsettled reuse/size/stat/hash observations cannot become fallback success;
successful callback observations remain prerequisites through actual metadata
release. Calculated checksums and extents share a contained descriptor. The
mutable index-state piece is always refreshed; sealed immutable-piece checksum
reuse retains its existing fast path. Unknown bytes stay unknown, invalid sealed
sizes fail and measured zero is preserved. Seventeen
`indexing/artifacts/initial-state-publication/*` cases are authored, unexecuted.

The state-manifest checksum and byte extent now come from the same verified
contained descriptor. The shared hasher returns its immutable observation only
after original descriptor closure; existing checksum-only callers retain their
return contract. A path stat from before that read cannot supply the receipt's
size. The added `manifest-size-race` regression forces the historical split
observation and checks the actual manifest against current bytes; it is unrun.

Internal checksum observations also include exact string dev/ino identities
from BigInt descriptor stats. Inode/nanosecond comparisons cannot fall back to
rounded Number equality. Final verification follows actual digest completion;
accepted digest work settles before cancellation closes its descriptor. Eleven
`shared/hash/exact-file-observation/*` cases are authored, unexecuted. Numeric
diagnostic fields and ordinary checksum/SHA return contracts remain.

SQLite compaction also requires successful table metadata and nonnegative safe
integer counts. Required `chunks` or `dense_vectors` query failure cannot stand
in for zero rows. Native/observer failures propagate through the existing command
owner and original physical closure; metadata recovery cannot repeat that close.
Eight authored `storage/sqlite/compact-count-failure-ownership/*` cases cover
metadata/query/pending/invalid/missing-table failures, real empty dense data and
nonempty dense preservation. These cases remain unexecuted.

LMDB's final backend snapshot and original native close now precede filesystem
readiness. The actual pending state prepares an immutable JSON snapshot under
the existing state mutex; native write/close runs outside that mutex. Its
coalesced readiness commit re-enters the same owner and compares the original
source/LMDB witness before changing that namespace. Generation, embedding,
extensions or competing LMDB changes reject stale readiness. The independent
SQLite namespace merges from the latest state. Only that namespace and the root
`updatedAt` generated by each shared publication invocation are excluded from
the witness. The embedded state is the prepared point-in-time snapshot; the
filesystem state can include newer independent SQLite metadata and its own
commit timestamp. Neither is a custom-root cleanup authority.

Successful mutation results also keep original resource prerequisites through
state/manifest writes and actual mutex metadata release. Late revocation cannot
turn into a successful publication acknowledgment. Nineteen new
`storage/lmdb/ready-publication/*` controls, including four actual-native cases,
remain authored and unexecuted. This does not make state/manifest publication
crash-atomic or qualify concurrent native writers to one target.
