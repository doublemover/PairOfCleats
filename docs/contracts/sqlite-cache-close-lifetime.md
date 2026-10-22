# SQLite cache close lifetime

Status: **UNVALIDATED source and authored regressions**. No fixture, native
database operation, syntax/format pass or benchmark ran for this change.

LRU eviction removes discoverability immediately but retains its actual entry
through outstanding leases and original close. Closure is recorded only after
that captured synchronous method returns successfully. The installed
better-sqlite3 wrapper returns its original database receiver; void fulfillment
is also supported for existing adapters. Explicit false is unconfirmed. Other
returns, missing methods and unreadable original evidence remain unknown.

Implicit eviction cannot drop a failed handle: the cache retains its exact retired
entry and a strong module inventory retains its original close owner. Explicit
close/dispose and repeated failed lease release report the failure without
automatically repeating native close. Other entries still receive their cleanup
attempt. Cache disposal still ends admission and preserves outstanding leases.

An exact owner's `release()` is explicit reconciliation, requiring retirement,
zero references and every captured original work observer before another close.
Absent/false pending flags cannot erase a predicate. Replacement methods/fields,
lookalike public owner properties, missing predicates and inspection failures
cannot authorize retry. Fulfilled close is remembered through later confirmation.
Unknown or overflowing history stays pending. This is not proof that arbitrary
failed native close is safe to retry; actual backend/platform qualification is
separate and automatic retries remain disabled.

Fixed diagnostic aggregates retain exact falsey/frozen original and independent
inspection failures without reading primary message/stack/descriptor metadata.
Only private actual failure records can retrieve the original owner. No PID,
numeric descriptor, arbitrary causes or copied capability grants resource scope.
This adds no lease namespace or cross-process settlement authority.

Authored actual-cache/LRU/lease controls cover implicit failures, delayed reference
release, repeated reporting without retry, original method/receiver, false results,
falsey/frozen causes, replaced observers and unknown inspection. Existing positive
cache/generation/native integration assertions remain. The previous failure test's
one-attempt guarantee remains; it now also requires retained pending evidence and
explicit original-owner recovery rather than treating a failed close as finished.
Real SQLite native lifetime/retry/GC, end-to-end request propagation and evaluation
tool finalization remain outstanding qualification or follow-up work.
