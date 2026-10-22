# Graph spill disk admission

Status: UNVALIDATED source implementation for #1348. No fixture or native/index
process ran for this release.

The streaming graph producer now opens its existing semantic disk account before
the first raw adjacency spill. Raw and selected outgoing/incoming collectors,
staged merge outputs, run manifests and merge checkpoints all use that same
account. Final retained adjacency and its existing physical index continue to
use the account. Display shard rows/offsets and display metadata also acquire
credits; a display cap remains separate from canonical edge retention.

Each encoded JSONL row acquires credits before the writer accepts it. Atomic
replacement keeps old and new bytes charged until the replacement closes and its
physical length agrees with admitted bytes. Metadata uses the same rule. An
uncertain writer failure keeps conservative credits until the existing physical
inventory is reopened. This adds no disk store, scheduler or independent quota.

Closed merge intermediates and collector directories return credits only after
successful task-owned deletion. A missing file returns no imagined credits;
multiple hard links are conservatively retained. Cleanup errors remain visible
for accounted work. Graph display failures close both outgoing/incoming readers
before returning the primary error. A quota failure stops the phase and cannot
mint a complete published generation.

The existing caller still owns publication, leases, restart and recovery.
Interrupted mutable cross-file propagation still restarts from durable Stage1;
these disk changes do not introduce a sealed propagation prefix. Reopening with
an already supplied account assumes the caller has accounted preexisting files.
Failed deletion or stale already-counted staging can conservatively retain
credits until that owner's next physical inventory refresh.

Authored controls cover raw spill denial before retained metadata, multi-pass
merge/checkpoint overlap, exact physical accounting, repeated output replacement,
closed-file retirement, and complete retained edges under small display caps.
They are unexecuted. Crash/disk-full, operational Windows/native lifetime and
equal-evidence performance qualification remain open.
