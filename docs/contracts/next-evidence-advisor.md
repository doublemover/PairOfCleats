# Deterministic next-evidence advisor

Unvalidated first slice of #1512. The pure advisor consumes current requirements
and already owner-admitted read descriptors. It filters immutable world, role,
predicate, capability/version, authority and parent-budget compatibility before
ranking stale revalidation, disambiguation, exact source and other required reads.
It performs no execution. The investigation adapter consumes the #1505 reducer.

Action identity binds run/intent/branch/assumptions, owner and immutable arguments.
A semantic frontier digest uses unresolved requirements, admitted evidence and
owner progress, excluding drafts and projection-only revisions. Repeated attempts
under the same frontier are excluded. Exact ranking never implies requirement
support. Unknown work estimates sort after measured estimates.

The internal descriptor digest is integrity, not authorization. Callers must use
their actual owner admission and capability registry; a public caller may not
self-assert `authorized` or mint receipt strings. The advisor does not reserve
resources, restore permissions or execute its result. A future runner must recheck
authority, reserve hard aggregate budgets and use opaque owner continuations.

Remaining work includes canonical public schemas, transports, opt-in runner,
atomic reservation/accounting, action-event lifecycle, expiring continuations,
real retrieval/semantic adapters, qualification and optional learned policy.
No validation or benchmark was run for the authored source fixtures.
