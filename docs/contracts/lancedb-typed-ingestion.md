# LanceDB typed vector ingestion

The existing Arrow contract in `lancedb-arrow.js` already ingests explicit Int64
IDs and fixed-size Float32 lists through the actual staged LanceDB writer. This
predates the current #1216 follow-up. Its configured row count is capped by the
existing 16 MiB ID/vector backing-buffer allowance. Missing channels retain ID
holes, tail batches preserve their actual count, and no object-row compatibility
path or boxed-number expansion is introduced.

The shared dequantizer now accepts an exact-length owned Float32 destination.
The Lance contract supplies the current contiguous row slice, preserving the
same Float32 rounding before the existing in-place normalization. This removes
the previous temporary Float32 backing allocation and subsequent full-row copy.
Overlapping typed source/output windows are rejected before writing; disjoint
windows may share a backing allocation. Existing allocating callers remain unchanged. Source rows are copied during
append; changing a source vector afterward cannot change the admitted batch.

`take()` protects admitted buffers from later append until the writer's awaited
create/add operation completes and its existing release runs. This is the same
producer lifetime contract, not proof of arbitrary native cancellation or retry
safety after a rejected operation. No failed native resource is newly qualified.

Installed source inspected read-only: `@lancedb/lancedb` 0.26.2 declares Arrow
15–18.1 support, and this project pins Arrow18.1. The actual `LocalTable.add`
obtains its schema, calls `fromDataToBuffer`, then invokes native `inner.add`.
Arrow-table input goes through `fromTableToBuffer`, whose IPC writer creates a
new byte payload and then `Buffer.from`. Typed ingestion therefore still has
Arrow/native serialization costs; this is not a zero-copy claim. The 16 MiB
allowance describes the producer's ID/vector backing store, not total process,
IPC, native, wrapper or validity-buffer memory.

Authored controls compare exact float values/IDs across dimensions and quantizer
settings, normalized and raw output, row limits, source mutation, tails and a
delayed actual writer consumer. A scoped constructor control counts numeric
Float32 backing allocations during append. Existing physical-schema/native
roundtrip, missing-channel and staged-failure fixtures remain applicable. All
new source and assertions are **UNVALIDATED**. No Arrow/native execution, tests,
syntax, formatting, bootstrap, models or benchmarks ran. Native conversion/write
phase measurement, peak/retained memory, GC and end-to-end latency remain open.
