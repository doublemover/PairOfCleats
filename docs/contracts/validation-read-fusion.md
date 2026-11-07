# Validation integrity read fusion

Strict index validation owns one invocation-local read plan per selected mode root.
The plan observes the actual contained decoder descriptors and incrementally hashes
stored bytes as they are read. SHA256 is always recorded; admitted SHA1/xxh64
manifest checksums add their hashers to the same stream. Certificates include the
selected absolute path, exact consumed extent, content digests and descriptor
identity. They cannot cross an invocation, root, generation or representation.

Manifest verification remains mandatory. Decoded families borrow only matching,
fresh integrity evidence. Every declared unconsumed piece is still checksummed.
The four-piece checksum window bounds parallel descriptors and preserves manifest
finding order. Deferred findings return to their original position before family
findings. A late mismatch fails the complete report even after successful parsing.
Unsupported checksums retain their original strict errors and non-strict warnings.
No artifact format, authority or checksum requirement changes.

The certificate envelope is65,536 members; manifests above16,384 pieces retain the
eager checksum gate. Small parsed metadata is cached only within the invocation,
limited to1MiB per member/8MiB total. No complete artifact byte buffers are retained
by the plan. Decoder byte/row/line and compression bounds remain independent.
Finalization rechecks certificate identities and clears decoded metadata. Mutable
same-size/preserved-mtime replacements, generation movement and cancellation remain
negative controls. Unknown descriptor closure remains a terminal failed invocation;
close-only recovery cannot publish evidence from it.

The independent test observer records original synchronous, asynchronous and
callback-stream descriptor reads, including physical stored bytes. Its control arm
uses the current complete validator with only read-plan creation disabled; the
original eager checksum gate and every family/schema/identity/count check run.
Full reports are compared at the same physical root outside timed work. The measured
projection relativizes only the explicitly asserted mode/backend-root fields and omits
source selection paths for cross-process digest comparisons; it never substitutes for the
complete same-root comparison.

The21 parity cases cover JSON/JSONL/gzip/shards with SHA1/SHA256/xxh64, empty
artifacts, hot/cold projection, checksum-only binary data, short UTF8 reads,
corruption, truncation, missing pieces, backup behavior and non-strict diagnostics.
The24 measured cases run serially: small JSONL,4MiB JSONL, four-part JSONL and three
warm full validations, each with three fresh processes per eager/fused arm.
Children have10-second bounds, outer cases30seconds, zero retries and no native redo.
Filesystem caches are warm from preparation. Small/JSONL/shard scopes measure the
first validation; only the warm scope performs untimed parity/warmup first. Raw bytes, reads,
wall/CPU, sampled heap and lifetime RSS are retained; these measurements exclude
index construction and do not qualify cold-device storage or a universal speedup.

Fixture-health authority has its own independent scope. Its checksum-only reader
uses the existing contained-file disposal owner and publishes only after confirmed
original closure. The six disposal controls fail against the former helper and
preserve held-close, false-close and frozen/falsey original-error evidence. Broader
fixture-health qualification is recorded in the [separate receipt](../archived/fixture-health-snapshot-closeout-2026-11-05.md).
