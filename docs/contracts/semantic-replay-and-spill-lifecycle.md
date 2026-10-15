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
