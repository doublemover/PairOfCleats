# LSP request admission and settlement

The client validates parsed JSON-RPC 2.0 envelopes before response settlement.
Exactly one own `result` or `error` is required; errors have an integer code and
string message. Null, false, zero and empty successful results remain valid wire
values. Provider payload normalization remains a separate owner. Correlation
uses the original typed ID; server requests occupy their own namespace.
Invalid correlated envelopes reject once with `ERR_LSP_PROTOCOL`. Uncorrelated
invalid-envelope lifecycle diagnostics stop after eight per transport generation.

Each pending request owns response, timeout and exact outbound write settlement.
A known pre-frame encoding failure rejects with `ERR_LSP_REQUEST_WRITE`, retains
the original cause/resource observation, and clears the timer. A partial frame
retires the physical writer and reaches existing child cleanup. Retiring a
writer does not establish child exit, stdio closure or native disposal. A writer
generation stays exclusive until its actual queue settles; stale handles cannot
retire a replacement, and a damaged wire cannot acquire another framing owner.

Pooled lease acquisition observes caller cancellation during creation, disposal
and predecessor waits. Cancellation withdraws the caller, preserving shared
creation/disposal owners. A withdrawn intermediate barrier remains behind its
predecessor. Lease-only handlers and signals do not become idle pool options.
Admission counters measure current waiters, high-water waiters, total wait time
and cancellations separately from provider timeout/quarantine metrics.

Interactive method queues recheck the caller signal, current soft deadline and
request budget immediately before guard execution. A queued cancellation
withdraws only that waiter; a deadline/budget skip has no server execution,
timeout, success or negative-cache claim. Active work keeps its actual completion
owner. Positive request-cache hits do not enqueue or consume request budget.
`queueEnqueued`, `queueStarted` and `queueCancelled` are fixed per-file/aggregate
admission counters. Existing method `requested` counters count admitted guard
attempts; the client's request/write metrics describe transport admission and
local encoding failures. Queue residence is not a server response timeout.

Shared LSP producer identity is `lspBindings48`; signature cache policy is
`rq11`. Prior malformed-response negatives and previous admission semantics
cannot supply current reuse. No cache directories are deleted. The document,
writer, envelope, local-write, lease and method-queue regressions are authored
and **unrun** at this source checkpoint. Real server/terminal/native qualification
and the resulting-tree front gate remain required.

Version 47 repairs PHP signature name admission and classifies proven missing
runtime prerequisites as degraded. Execution denial, invalid command paths and
pending resource ownership still block provider launch. Existing cache entries
cannot supply the corrected semantic coverage; the shared version forces replay
to use the current producer.
