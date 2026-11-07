# Embedding preparation admission

The file pipeline partitions uncached work into source-ordered windows of at
most 256 items and 4 MiB of source accounting, respecting a smaller configured
pending-byte limit. An oversized individual payload is rejected before the first
estimator/provider call for that file batch. Exact-text deduplication, source
mapping, token-aware packing, claim settlement and positive vector checks remain.

Each window enters the existing bounded writer queue before token estimation.
Its single reservation spans preparation, global collection or direct dispatch,
vector validation and awaited original preparation release. Global collection
does not acquire a second reservation. This prevents nested-admission deadlock
and closes the gap between preparation and dispatch. Native/inspection failures
retain their original observations through the shared estimator guard.

The source reservation is not a native allocation measurement. The ONNX row
owner independently reserves conservative row geometry before tokenization:
exact text/identity keys, row overhead and two or three fields at the selected
dense contract's maximum length or the actual tokenizer's finite default.
Pending projections and retained rows share the existing 4096-entry/16 MiB cap.
Unknown geometry or unavailable capacity declines optional estimation before
tokenizer work; inference remains available under its existing policy. No new
truncation value, backend fallback, public knob or cache identity is introduced.

Reservations commit only validated rows within their original geometry. Reads
retain rows until their original preparation owner releases them or the existing
60-second expiry retires the lease; newer work cannot evict an admitted window.
Failures release uncommitted reservations. The old post-allocation `retain` and
consuming `take` paths are removed after migrating all source/test callers.
Source, token-type, identity, older-release and LRU-bypass assertions remain.
Four locally unrun cases exercise the actual file processor's admission before
estimation, release lifetime, 600 ordered inputs beyond an eight-entry token LRU,
oversized-input refusal and single-slot global collection.

Five further locally unrun cases cover pre-tokenizer rejection, pending/committed
capacity accounting, non-consuming reads and original releases, geometry checks
before copying cells, and exact expiry/failure cleanup. Existing ONNX adapter
coverage now exercises real owner admission refusal and verifies that unknown
geometry does not prevent inference with the controlled runtime dependencies.
