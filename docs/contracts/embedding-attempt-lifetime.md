# Embedding attempt lifetime

The inline build runtime owns its lazy embedder lease. `closeEmbeddingRuntime`
stops admission, closes its batcher, joins original inference and observation
work, and returns the lease through its captured disposer. An unused runtime
does not initialize a model to close it. Concurrent closes join the same attempt;
confirmed steps are not repeated. Original unresolved native or diagnostic
resources remain owned, and a subsequent explicit reconciliation retries only
unconfirmed cleanup. Failure, cancellation and initialization unwind retain the
same ownership requirements as successful teardown.

Runtime initialization registers embedding close immediately after acquisition;
the normal build teardown owner also joins it after work and stage-one children.
Neither path globally disposes other callers' adapters. Compatible build/query
consumers have independent leases: returning one cannot invalidate a sibling.

Daemon prewarm retains the actual returned lease with its warm key. Replacement,
bounded eviction, recycling and explicit shutdown retire the corresponding
lease through the existing daemon owner. A failed prewarm cannot publish warm
readiness. Failed retirement and same-key replacements remain separate owners;
observational drains never silently retry a failed disposer.

Recording regression owners use the real adapter lease/cache and daemon APIs
with explicitly selected deterministic stub artifacts. They do not load a real
model or claim native memory qualification:

- Inline lease-close covers unused, success, failure, cancellation, active work,
  sibling reuse, closed admission and failed acquisition.
- Prewarm-hook controls retain normalized options and skipped preload, then
  return every acquired lease and preserve an independent query on failure.
- Daemon/prewarm integration covers actual shared leases, replacement, shutdown,
  surviving query use and failed warmup without readiness.
- Existing close-reconciliation, original-failure-drain, daemon retirement and
  initialization-unwind fixtures retain their independent cleanup assertions.

These controls reconcile the existing implementation for #1349. Their execution
and any real-provider/native lifecycle qualification remain separately recorded.
