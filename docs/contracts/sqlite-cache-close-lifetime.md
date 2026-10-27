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
The actual evaluation entry now captures its cache/display lifecycle methods
before asynchronous work. Search failures register their original observations
on actual cache entries before disposal, so pending native work gates close.
Every cleanup gets an attempt; exact primary and cleanup failures stay together.
Outstanding leases or failed cleanup prevent report-file/stdout publication.
Captured original predicates follow later settlement without an automatic retry.
Authored scope and actual report-entry controls cover success, falsey dual failure,
original method replacement, pending work and an outstanding lease. They are unrun.
Real SQLite native lifetime/retry/GC and wider end-to-end request propagation
remain outstanding qualification or follow-up work.

## Repository and service retirement propagation

The repository manager now records retirement in a service-scoped ledger that
references the existing cache and frozen close owners. Implicit LRU/generation
retirement stays nonthrowing and does not retry native closure. Explicit
`clearRepoCaches`/`closeRepoCaches` attempts every affected entry, then reports
`ERR_REPO_CACHE_RETIREMENT` with original failures and live original settlement
observers. Generation admission can proceed while an old lease retires; that
retirement never establishes deletion authority. Idle ledger entries are pruned.

Safe bounded receipts distinguish `settled`, `retiring` outstanding leases and
`failed` closure. Counts separate active lease owners and failed-close owners;
no live owner/handle objects enter the receipt. Error diagnostics retain up to
128 independent observations per entry; overflow stays explicit and cannot
claim settlement. Reconciliation observes original owners without invoking
native close; explicit original-owner recovery remains the only retry path.

API router cleanup attempts artifact, repository and embedding owners even when
an earlier one fails, preserving primary/secondary causes and resource observers.
Its memoized close promise retains the first shutdown receipt/error; it is not a
poll of later state. The manager's current retirement receipt observes subsequent
lease release or explicit original-owner reconciliation. MCP clear returns the
same internal safe receipt and propagates classified failures.

The manager/LRU/cache, generation, implicit eviction, lease, falsey/frozen cause,
MCP parity and actual API close controls pass on Windows/Node 26.12.1 at
`9d1c90a5c`. The [qualification receipt](../archived/cache-retirement-repairs-2026-10-27.md)
records the exact cases and complete cheap front gate. The original native
qualification limits above remain open.

## Federation retirement propagation

Federation uses the same ledger for its request-created caches. It stops new
admissions promptly and retires caches only after all started workers settle.
Successful fanout awaits that retirement; failed or still-leased cleanup cannot
produce a healthy terminal result. Borrowed host caches retain their host owner.

Fail-fast errors carry a non-enumerable `federationCacheRetirement` capability.
Its `drain()` retains the actual eventual cleanup result, `isSettled()` follows
the original resources, and bounded receipts distinguish resource status from
the failed operation outcome. Independent index and SQLite cleanup both run.
Captured original predicates remain authoritative, and reconciliation never
automatically retries native close. The capability stays out of serialized
HTTP/MCP diagnostics.

Executed real-cache controls cover success with failed cleanup, strict sibling
failure before drain, active leases, independent index/native failures, original
owner recovery and untouched borrowed caches. The same regression fails against
the prior coordinator's swallowed-cleanup path. These inert boundaries qualify
the owner protocol without asserting installed-native runtime or performance.
