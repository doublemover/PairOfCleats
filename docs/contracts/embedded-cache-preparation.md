# Embedded cache parent preparation and child replay

Warm relocation, durable completion admission and SQLite cache planning share
one prepared parent per nonempty sibling set. The internal weakly branded scope
owns an exact byte copy and one fatal UTF-8 decode preserving BOM and UTF-16
coordinates. Hash, source ID and repository namespace must match every use.
Caller buffer mutation cannot change the prepared snapshot; copied, wrong-parent
and expired handles cannot qualify a child. No decoded parent enters a global
metadata cache.

Preparation admits at most 64 MiB of parent bytes through the existing FIFO byte
owner. A source-specific phase shares a 256 MiB allowance per disk-account owner,
separate from writer and row-construction credits needed by its own children.
Reservation precedes reading/copying/decoding: three input bytes of allowance per
byte for supplied snapshots, four when loading also owns the fresh input buffer.
These are bounded logical allocation allowances, not measured process RSS.
Cancellation and failed CPU reacquisition join the actual original allowance
before returning its credits. Failure and scope completion invalidate the handle
and release its byte ownership.

An active original replay context opens each embedded child, qualifies its retained
source and checked map against that parent, and performs full partition verification
under its existing cache-writer lease. Its existing inventory-bound token carries
that same descriptor/store into physical relocation. Map/source qualification alone
does not mint a full-verification token. A forged, cleared, wrong-bundle or expired
context cannot supply this handoff. Changed inventory follows existing token
invalidation and full verification. Without a qualified token, relocation keeps
its original verification path. Destination copies, partitions and physical disk
credits retain their existing owners and checks.

Zero siblings perform no embedded-only parent read/hash/decode; ordinary parent
partition and source validation still run. Metrics distinguish parent hashes,
decoded bytes, prepared allowance, child descriptor opens, map/source qualification,
replay hits/misses and copied bytes. They do not combine verification and copying
into a claimed speedup. Physical read/copy witnesses remain the performance oracle.

Existing embedded-cache, map-authority and verified-replay fixtures remain. New
bounded cases cover 1/4/16 equal-text distinct siblings, zero siblings, original
buffer mutation, identity/lease/inventory failure, cancellation, failed reacquisition
and destination-copy failure. Execution and serial cost qualification remain pending.
