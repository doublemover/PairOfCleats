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

The source reservation is not a native allocation measurement or a prediction of
token-row cells. The ONNX row owner separately needs conservative pre-tokenizer
geometry/capacity admission; cache retention after allocation is insufficient.
Four locally unrun cases exercise the actual file processor's admission before
estimation, release lifetime, 600 ordered inputs beyond an eight-entry token LRU,
oversized-input refusal and single-slot global collection.
