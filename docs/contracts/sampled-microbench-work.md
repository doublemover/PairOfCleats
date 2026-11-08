# Sampled microbenchmark work and paired inputs

The shared hash/regex/compression sampler admits finite safe integer iterations
and samples greater than zero, and nonnegative integral warmup. Requested sample
counts above iterations become a reported smaller effective bucket count; they
never add measured operations. Nonempty bucket sizes differ by at most one and
sum to completed operations. Failed callbacks reject rather than publishing a
successful denominator. Warmup operations and time are separate from measured
totals. Version 2 receipts retain raw bucket times and operation counts.

Histogram statistics describe milliseconds per bucket. Buckets with different
operation counts are not per-operation latency samples; bucket p95 is not operation
p95. Hash byte rates use actual UTF-8 payload bytes and completed operations.
Regex operation rates use the same admitted completed-work receipt. Their human
output explicitly labels bucket statistics. Backend/engine selection remains with
the existing production wrappers, including unavailable optional engines.

The synchronous VFS lookup sampler shares integral-work admission and effective
bucket accounting, preserving ordinal callback indices and completed-operation
rates. It rejects promise-returning callbacks and observes supplied rejections;
it cannot qualify asynchronous operations by discarding their work.

Compression payloads are prepared before codec arms from the recorded
`lcg32-text-mixture-v1` generator, fixed seed, size and synthetic entropy setting.
Each arm receives an isolated copy of identical bytes with SHA-256 identity.
All arms must pass byte-identical round-trip admission before timing; mutation
checks and final-output round trips run outside timed operations as well. Codec
implementation/version/settings are reported, with unobserved defaults explicit.
Compression and decompression retain separate complete-work measurements and
verification operation counts. Backend order alternates between sizes; repeated
paired trials and representative artifact corpora remain broader performance
qualification, not evidence supplied by this synthetic harness repair.

No throughput improvement, corpus representativeness, native codec qualification
or operation-tail-latency claim follows from these accounting and parity checks.

The graph-store benchmark emits version3 reports. Each admitted sample names the
actual spawned PID and Node process-start clock. That pair must be distinct;
recycled PID numbers alone neither prove nor disprove fresh application caches.
Every sample still performs exactly one cold build and one warm hit and preserves
source, manifest, task and omitted-artifact evidence. Query-worker retirement
counts actual launch/close events and retains the reused live memory worker,
including retiring generations in the existing global cap.

Representative graph qualification retains both shapes and all six alternating
paired trials per shape. Two independently bounded capsules own trials0..2 and
3..5; the internal trial offset preserves the original arm order. Every original
cross-shape comparison remains in each capsule. No CLI option, sample, assertion,
backend, retry or deadline is removed or relaxed. The consolidation owner and
ordered CI inventories bind the complete replacement coverage.
