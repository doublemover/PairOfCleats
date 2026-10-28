# Tooling request guard

The shared `createToolingGuard` owns retry and circuit-breaker admission for
provider operations. Ordinary confirmed failures retain the existing configured
retry count, backoff and breaker behavior. Cancellation is returned immediately
without retry or an ordinary breaker failure. A failed request is never counted
as successful work.

Successful results and thrown errors first pass the original resource observation.
Unmarked observers remain authoritative; replacing a caller-owned observer cannot
settle the captured one. Unconfirmed work blocks retry, later method dispatch and
the ordinary `isOpen` predicate until every captured prerequisite confirms actual
settlement. Retry backoff rechecks that same original observation. Independent
diagnostic/logging failures and falsey/frozen original failures remain reachable.

The guard retains at most 128 prerequisite observations. Its diagnostics report
the retained pending-observation count, not a native handle count. An incomplete
inventory stays blocked; overflow cannot manufacture safe recovery or drop the
current call's original result/error. This owner does not close native resources,
grant deletion authority or replay a failed operation during recovery.

`assertSettled` exposes the same internal admission check to existing consumers.
The actual LSP initialize, request, interactive-method, cache-flush and outer
quarantine/desync classifiers require original settlement before ordinary
diagnostics or degraded fallback. Existing client/session/storage owners still
control their physical release. Confirmed transport errors, request timeouts,
malformed responses and ordinary partial output keep their existing contracts.

This is implemented but **functionally unqualified**. The
[source receipt](../archived/tooling-guard-lifetime-implementation-2026-10-28.md)
records authored cases. Cross-process workspace/method health, finite cooldown
and controlled recovery remain separate source work; a process-local breaker is
not durable health evidence.
