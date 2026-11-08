# Semantic replay and spill lifecycle

Warm per-file replay can share verification metadata from completion preload with
bundle relocation. The build owns `createSemanticReplayVerificationContext` and
its active repository cache writer lease. Its internal allowance is the smaller
of 8 MiB and semantic `storage.decodedCacheBytes`; zero disables the handoff.
Three quarters bounds the serialized token metadata, including descriptor and
inventory identities, and the remainder bounds successful replay receipts.
This allowance describes metadata admission, not an exact JavaScript heap size.
Source buffers and decoded semantic rows are not retained in the context.

An opaque token binds the exact source hash, canonical source path, repository
namespace, locator, dependency signatures and immutable cache inventory. Every
consumption checks the active lease, resolved member paths, inode/device, size,
and nanosecond modification/change times. Changed or evicted inventory falls
back to complete verification. Current source bytes are freshly read before
relocation; token authority never comes from source size or timestamp alone.
Copied destination partitions and retained source bytes still receive full
cryptographic validation. Embedded source/mapping validation remains separate.
Parser and semantic changes invalidate their own lanes, while lexical, compiler
analysis and physical layout continue to use their existing scoped rules.
Generation-pinned frontier work cannot be rebound through the syntax cache.

`runtime.semanticReplayVerification.snapshotReceipts()` reports successful
root and embedded relocation only: source unit ID, source hash, locator and the
authenticated cache inventory byte size. The bounded receipt list can omit
entries on capacity pressure; `droppedReceipts` records that condition. Metrics
also expose verification hits/misses, metadata admission, fresh source bytes,
copy bytes and elapsed verification/copy time. These receipts establish syntax
replay observations; they grant no compiler dependency-closure authority.
The Stage1 drain clears token authority while keeping bounded receipts available
to Stage2 reporting.

Query and operation indexes share the semantic query-index writer. Each merge
group closes its readers and replacement writer before retiring its task-owned
input runs. Exact physical run credits return immediately after deletion. Only
the active merge frontier and the current replacement remain charged, rather
than all obsolete merge levels. Final cleanup removes the remaining runs;
failure removes only the temporary directory created by that writer and returns
its remaining credits after physical cleanup. Published source partitions are
never candidates for retirement.

Focused acceptance is deferred until the root validation phase:

- `verified-replay-handoff` measures actual source/cache reads, synchronous hash-call wall time, process CPU during those calls, total process CPU time,
  copy work, wall time and sampled resident bytes on a cold source fixture,
  unchanged warm replay and one-file change. It also checks exact identities,
  corruption, cancellation, metadata capacity, caller mutation and lease loss.
- `query-spill-retirement` forces at least three intermediate merge levels,
  compares rows/data and offset hashes, records peak working bytes, and injects
  failure after every merge group plus replacement capacity refusal.

These are small fixtures, not full-index throughput evidence. Windows lifecycle
qualification, supported optional backend parity and representative large-build
RSS/disk/throughput measurements remain external acceptance boundaries.

## Prepared semantic rows and sealed receipts

The partition sink canonicalizes each untrusted envelope once while privately
capturing that same traversal's payload bytes. It checks envelope byte accounting,
row/schema limits, IDs and references before admission or writes. Prepared bytes
are bounded by the existing batch allowance and do not alias producer objects.
Member writes, offsets and hashes consume those exact bytes; a producer mutation
after an IO await cannot rewrite an admitted row. Completion still requires data
and offset fsync, directory durability and offset validation.

Registration carries SHA-256 receipts for verified immutable semantic parts,
offsets, evidence and frontier targets at their exact finalized paths. Generated
JSON without a writer receipt still follows ordinary manifest hashing. Manifest
construction refuses a sealed size differing from the current physical size;
independent publication integrity validation remains mandatory.

Compiler sessions build source, canonical-container and composite segment indexes
once per session. Indexed candidates still require exact retained text, range,
parent-source and mapping authority. Colliding source or canonical path identities
fail closed; they do not select the first descriptor in an inventory scan.

Shared syntax, analysis and ownership producers mint private prepared-entry
receipts from canonical traversal. They retain immutable canonical row strings and
a deeply frozen snapshot, use exact envelope byte accounting for batch formation,
and let the sink validate schema/sequence/references without serializing the row
again. Lookalike objects and arbitrary encoded JSON cannot forge a receipt. Mutable
input callers continue through the checked sink path. Prepared objects are weakly
owned and released with their bounded producer batch.

## Build-owned source retention receipts

UTF-8 source snapshots mint an opaque capability over immutable decoded text and
its exact original-byte identity. Valid UTF-8 roundtrip equality is checked while
snapshotting. Syntax and ownership partitions can retain that capability without
rehashing or copying a borrowed mutable source buffer for every partition. Raw
byte callers remain copied and SHA-256 validated on each request.
Their private byte snapshot is captured before waiting for a serialized writer;
the snapshot exposes identity metadata and never lends its mutable buffer.

Retention is serialized by the existing per-account disk writer. At most 256
receipt entries retain finalized path, source digest/length and verified physical
authority; they retain no source buffers and do not cross disk accounts. A complete
opened-file verification uses the shared contained descriptor owner and compares
at most 64 KiB per read to the captured bytes, with stable identity/timestamps before
and after the read and checks that the pathname still names that object. Reuse
requires a regular
file with meaningful device/inode and nanosecond change identity. Unsupported
identity information, replacement or mutation returns to full verification.
The receipt also pins the storage root's device/inode; a replaced root requires
full verification even if a retained source file survives a directory move.
Cancellation is checked after the asynchronous receipt probes. Internal work
counters distinguish captured raw bytes, physical comparison bytes, completed
verifications and successful receipt hits; they are not runtime qualification.
Cancellation, conflicting contents, EEXIST winner checks, disk credits and fsync
boundaries remain authoritative; publication validation independently checks final
artifacts. External same-size/mtime mutations must invalidate the receipt through
the physical change identity. Runtime and storage-platform qualification remains
deferred for this implementation.

Original read, write, sync and close failures stay with the shared descriptor
owner. An unsettled failure cannot be classified as a missing file, publish a new
name, delete a temporary or release its disk credit. Explicit close recovery
closes only the original handle and never replays the read/write, installs a
receipt or resumes publication. The serialized writer retains an unsettled
failure as the next writer's prerequisite instead of starting new IO on that path.
Uncertain temporary credits remain retained;
reopening independently accounts the actual physical inventory.
