# Semantic source retention work qualification

The #1240 implementation is qualified through real partition finalization on Windows,2026-11-05. Six bounded1/4/16-partition cases compare a shared1MiB source with distinct1MiB sources, each using both private immutable capabilities and raw-buffer controls. Existing original-descriptor, mutation, cancellation, root-replacement and corrupted-content negatives remain. [Exact sources, original failure and raw measurements](source-retention-closeout-2026-11-05.json).

The original source-retention owner from ce269279b0201a23d655035e6490bb6417ab29ae was restored for one controlled shared16 regression, with current disk/native ownership unchanged. It fails the work bound:16 source descriptors read16MiB,16 copies copy16MiB, and16 source hashes hash16MiB. Original source bytes are restored in finally and their SHA256 is verified. This is an isolated original-owner comparison, not a whole historical-tree execution.

The repaired owner uses one source descriptor/read/copy for the same16 real partitions:1MiB read,1MiB copied and no additional source hash during finalization;15 requests reuse the account-bound receipt. Canonical partition hashes match the raw-buffer arm. Distinct-source controls still read/copy every required1MiB source; raw mutable inputs still copy/hash each supplied buffer. Snapshot preparation and initial source hashing precede the measured finalization and are explicitly excluded. Read descriptors, bytes, copies and hashes are measured through actual filesystem/Buffer/Hash calls; production counters independently agree.

| Sources / partitions | Capability read MiB | Capability copy MiB | Capability source hash MiB | Raw control copy / hash MiB |
| --- | ---: | ---: | ---: | ---: |
| Shared /1 |1 |1 |0 |1 /1 |
| Shared /4 |1 |1 |0 |4 /4 |
| Shared /16 |1 |1 |0 |16 /16 |
| Distinct /1 |1 |1 |0 |1 /1 |
| Distinct /4 |4 |4 |0 |4 /4 |
| Distinct /16 |16 |16 |0 |16 /16 |

The partition sink now forwards its existing metrics owner to retention; no semantic or artifact meaning changes. Receipts remain a bounded256-entry map under a weak account key, contain only file/root identity metadata, retain no source buffers/capabilities and cannot cross accounts. Original source capabilities are privately branded; mutable bytes retain their own captured copy/hash. Original physical descriptor closure is required before a successful receipt; pending native/independent observations retain their original recovery owner. Root/file identity changes invalidate reuse, and independent publication integrity checks remain.

Twelve distinct focused checks pass: six measured real-partition cases, two retention/physical-close controls, actual semantic partition storage, Astro source evidence, compiler file-URL source joining and exact CI/nightly scheduling. The six work cases remain explicit ordered ci-lite members with the existing serial resource-budget owner. Raw elapsed samples are descriptive; no isolated latency or end-to-end speedup is claimed. All checks use one job,30-second bounds and zero retries/native-status redo. Publication checks and final source digests appear in the machine receipt. Historical workspace paths are provenance, not clean-checkout deliverables. Hosted/platform and optional backend qualifications remain separate.
