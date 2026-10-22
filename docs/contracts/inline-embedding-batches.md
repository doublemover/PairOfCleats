# Inline embedding batch ownership

Inline and deferred embedding paths share deterministic length-aware batch
planning, vector validation and token-budget resolution. The tool exports remain
compatibility re-exports of the shared library owners. Inline code and present
documentation texts enter one exact-text-deduplicated request with an inverse
mapping back to their source chunk/channel; missing documentation stays absent.
Malformed provider output fails the shared request without singleton retry.

One runtime-owned inline batcher serves a provider function, including requests
with AbortSignals. Admission bounds pending positions to 4,096 and owned queued
input/result bytes to 16 MiB. Inputs, mapping overhead and retained delivered
vectors are charged until the request releases ownership. The provider's own
native input/output memory is separate from this accounting. A provider batch
contains at most 1,024 unique texts, also respecting the selected item/token caps.
The strictest positive token budget among live owners governs a shared window;
an explicitly disabled token cap does not override another owner's positive cap.
Only one provider call runs at a time, within any supported concurrency ceiling.

Each requester owns its cancellation listener and positions. Cancellation removes
unstarted unique work when no other requester needs it. A batch has its own signal
for scheduler admission; a file signal never owns a shared provider operation.
Queued dispatch can be canceled when every batch owner has canceled. Once native
inference starts, the batch owner awaits completion even when no requester still
waits. Other live owners keep receiving their results. Runtime teardown closes
request admission, rejects pending requesters, drains actual provider work and
token-row leases, then disposes the embedding runtime.

The shared scheduler callback accepts an operation-owned signal override while
preserving the file signal by default for existing callers. Provider failures and
admission failures remain explicit; the batching layer starts no detached model
load or alternate backend. Existing provider/model identity authority is unchanged.

All authored cancellation, dedup, token, failure and teardown fixtures remain
unexecuted during this source-only development pass. Actual inline/deferred model
parity, scheduler resource ownership and provider/native memory/throughput
qualification remain open. No performance gain is claimed.
