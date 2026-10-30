# Scheduler degradation scope

The scheduler crash owner emits a version 1 `degradation` receipt alongside its
existing failed grammar/path diagnostics. The runner and chunk consumer share
one indexed query owner. It recognizes explicit grammar failures, exact canonical
VFS containers and exact segment occurrences. Grammar quarantine remains broad
by declaration. A segment receipt affects only that occurrence; its enclosing
container and other languages or ranges remain independent.

VFS admission uses the existing path builder for a canonical round trip,
including encoded `#`/`%`, Unicode, case-preserving path identity and segment
coordinates. An unversioned legacy crash summary can supply exact canonical
containers or coordinate-qualified segments. Older exact-key query adapters
remain supported without widening a returned segment match. Raw paths, legacy
segments without occurrence coordinates, noncanonical encodings, reserved hash
routes and unsupported receipt versions remain unqualified diagnostics. No
substring/prefix/suffix guess converts them into another path's authority.
Independently declared failed grammars remain effective even when another
receipt is unqualified. Missing scheduled chunks retain their strict failure
contract.

Chunk diagnostics record counts by chosen scope, the first 16 fallback decisions
with causes/segment coordinates, an omitted-decision count and the count of
unqualified receipts. Checkpoints preserve that diagnostic owner with the actual
chunks. `sourceChunking` producer version 29 invalidates replay of prior routing
meaning; healthy scheduled units still use and release their scheduler lookups.

Authored counting-adapter controls cover prefix/sibling collisions, container,
segment and grammar scope, mixed languages, repeated-content occurrences,
encoding, Unicode, case, historical/invalid receipts and cold/checkpoint parity.
The real crash publisher fixture checks the same receipt in durable/local
evidence. These controls are unrun; native parser failure and full Windows
qualification remain separate.
