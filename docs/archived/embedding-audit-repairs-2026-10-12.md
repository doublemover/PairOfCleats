# Embedding audit implementation and acceptance — October 12, 2026

Target: `codex/audit-backlog-implementation-20261012`, based on audited
`bb9901ac808a24629c8004ddd2479006716498be`, using Node 26.8.1.
This is the EMB-001–011 owner receipt. The active roadmap and final integrated
checks remain owned by the root coordinator.

Implemented independent ONNX feed buffers, one queue per shared native session,
reference-counted adapter/pipeline ownership and disposal, frozen ONNX plan
version 2, embedding identity version 4 with opened artifact authority and
explicit unknown-attempt policy, semantic content projection version 2,
disabled scheduler lifecycle parity, drained durable Stage3 writer snapshots,
and canonical verified immutable bundle refresh/fallback consumers. Storage
owns shared snapshot/key/compact-manifest version 6; the semantic lane owns
semantic producer version changes.

Effective host/container/configured memory headroom now feeds existing admission,
worker and embedding owners. Text/vector caches and writer preparation have byte
accounting. Tokenizer/quantizer child execution is explicit opt-in through
`indexing.workerPool.processFallback`, default `false`; existing Worker/inline
behavior remains the default. Child heap/IPC/dictionary/RSS accounting, identity
fencing and bounded cancellation/restart/drain are implemented.

Related subprocess fixes bound retained backing allocations, preserve streaming
UTF8 callback strings, and admit complete progress lines before emitting them.
Truncated tails cannot become complete protocol frames. Actual Child `close`
evidence is scoped to the spawned child. An unobserved close or unresolved
embedding cleanup sets `cacheOwnershipPending`; original errors retain their
code/name/cause plus observable `cleanupError`. Storage's downstream watch/lease
regression confirms that idle controls cannot clear this pending ownership.

Focused acceptance passed all 47 selected cases and nine additional affected
cases: **56 distinct latest passing fixtures**, no timeout, skip, runner retry
or native redo. Six initial failures were corrected: four stale fixture
contracts, an adaptive memory floor that restored capacity beyond available
headroom, and an unhandled owner-only claim rejection. Original failed receipts
are retained. One group16 stdout/stderr was reused during correction; original
runner-parent failure JSON/full logs are archived separately with explicit
provenance. Sparse-only default ANN now verifies actual lazy dense availability
before query embedding; absent vectors preserve sparse/MinHash search, while
present unknown/stale dense identity still fails compatibility.

Scoped ESLint, Node syntax and whitespace checks passed. Root owns the final
integrated formatting/config/generated/static gates. Syntax checks do not imply
a global typecheck. Historical focused receipts are in
`/workspace/audit-work/receipts/embeddings/acceptance-summary.json`; downstream
watch ownership evidence is in
`/workspace/audit-work/receipts/storage-focused/07-claims-pending-fixed.json`.

## Bounded real CPU qualification

Official `Xenova/all-MiniLM-L6-v2` revision
`751bff37182d3f1213fa05d7196b954e230abad9` was downloaded and independently verified.
Separate asset roots held q8 weights (22,972,370 bytes, LFS SHA256
`afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`) and fp32
weights (90,387,606 bytes, LFS SHA256
`759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e`).
Tokenizer/config bytes matched official Git blob identities. All commands were
serialized in coordinator CPU slots, bounded to 30 seconds and 512MiB old-space.

The original q8 batch/single cosine >=0.999 gate **failed**. Direct native
mask-mean pooling reproduced cosines 0.985490/0.991521, while production versus
the independent native reference was approximately 1.0. The exact dynamic
quantized model/workload therefore remains unqualified for this strict numerical
consistency requirement. No assertion, precision default or threshold changed.
The official fp32 model passed the unchanged gate at 0.999999995/1.000000001,
with finite normalized 384-dimensional vectors, independent real Tensor feeds,
padding/growth/shrink, shared native create/release 1 and peak activity 1,
real wrong-type ORT rejection/recovery, and adapter drain/sibling ownership.

The explicit q8 CPU1/1 fixed-small-string sweep observed:

| Batch | Texts | Wall ms | Native busy ms | Padded tokens |
|---|---:|---:|---:|---:|
| 4 | 64 | 44.86 | 37.83 | 260 |
| 8 | 64 | 32.75 | 31.48 | 264 |
| 16 | 64 | 31.60 | 30.46 | 272 |

Initialization was 260.05ms before the same-session sweep. Actual Linux process
thread snapshots were 7 at baseline and 11 after initialization/during inference;
matched CPU-tick deltas were 8/4/3. IDs/ticks include main/V8/libuv activity and
provider attribution remains **unknown**.

Two-file Stage2 followed by q8 Stage3 cold/repeat completed successfully. Cold
Stage3 produced 7 vectors in 2 batches (566 source/1242 padded tokens), with
200ms compute and 192.01ms native busy time. Its writer scheduled 4 operations,
measured 19.42ms encoding/254.81ms I/O, peaked at 102,352 bytes below the
268,435,456-byte cap, and drained all pending/producer/preparing/byte counters.
Repeat demonstrated 2 file cache hits and no computed batches, while still
paying 253.76ms initialization and a 5.00ms native probe. Both durable attempts
shared identity version 4/key `363cbc81c2e648a4ac51869200512655078874df` and
384 dimensions/7 records. Untrusted repository `cache.root` was correctly
discarded; copied receipt provenance identifies the actual normal-cache task
subtree. An initial invalid qualification `sqlite.use` key failed before
provider initialization; its receipt was retained and only task configuration
was corrected.

Consolidated assertions, original failures, exact commands, durable state and
native observations are historical author-workspace receipts at
`/workspace/audit-work/receipts/embedding-real-cpu-summary.json`. The assets and
receipt paths are not dependencies promised in clean checkouts.

This single CPU sample does not qualify production throughput, neural quality,
other models/dtypes/hardware, Windows process trees, or Worker-versus-process
speedup. The measurements do not establish a persistent neural worker benefit;
no such experiment/default is promoted, and process fallback stays disabled by
default.
