# Cache retirement repair and daemon qualification — 2026-10-27

Qualified source: `9d1c90a5ce795d6ec0ced12b4058f2abc925c1c0`, branch
`codex/pr557-audit-repairs-20261012`, PR #572; Windows x64, Node 26.12.1.

## Completed issues

**#1718:** the repository manager's existing retirement ledger now also owns
request-created federation cache retirement. Successful fanout awaits cleanup and
surfaces retained SQLite/index failures. Strict failure and cancellation remain
prompt; their errors retain a non-enumerable live owner whose `drain()` observes
later cleanup after every started worker settles. Only request-owned caches retire.
Borrowed host caches retain their host lifetime. Original close owners and
settlement predicates remain authoritative; no duplicate native registry or
automatic native-close retry was added.

Structured receipts distinguish active leases, failed closes and settled
resources. Explicit original-owner recovery can settle resources, but cannot
rewrite the failed cleanup outcome. Independent cache/router cleanup still gets
an attempt and exact primary/secondary failures remain observable. The narrow
shared cleanup function retains its existing export and avoids importing the
whole repository manager into federation.

**#1591:** five current-source checks qualify the previously implemented daemon
boundary. Pending ownership reaches exact-claim cleanup holds before diagnostics,
completion, retries or governance transitions. Mutable/frozen/hostile diagnostics,
abort cleanup, sibling isolation, exact-once recovery and ordinary/post-publication
outcomes remain covered. This closeout credits existing implementation rather
than claiming another daemon repair.

## Proof and checks

The new actual-coordinator retirement regression fails against the prior
`d41e8315d` coordinator: successful fanout returns normally despite cleanup failure,
producing **Missing expected rejection**. A scoped module hook loads that exact
`git show` baseline without resetting the checkout. The repaired coordinator
passes the same regression, including independent native/index failures, held
siblings, borrowed caches and an outstanding lease.

Fourteen unique affected fixtures have passing final observations. They cover
the actual SQLite cache/LRU/manager/API composition, federation success/fail-fast
retirement, queue holds and runtime teardown. The complete cheap front gate
passed, including **40/40 gate cases**, formatting, config/environment budgets,
generated freshness, command/workflow contracts and whitespace checks. Each
fixture uses one job/thread, a 30-second deadline, zero retries and native-status
redo disabled; final observations have no skips, timeouts or native crashes.

The inert native boundary records one failed close, one independent successful
close, zero automatic retries and one explicit recovery close. Borrowed caches
are not closed by federation. A live lease closes only after its original release.
These are deterministic lifetime/resource witnesses, not native backend or latency
qualification.

The added one-lease fixture initially let both workers enter before its async
assignment; synchronous slot admission fixes that setup while retaining the
one-owner assertion. An initial negative-control launch rejected split option
syntax before discovery; the corrected equals form runs the intended baseline
counterexample. Both receipts remain recorded. All checks use the previously
documented task-local launch omitting the inherited missing trusted-config
selector; no user settings or trust contracts changed.

The [structured receipt](cache-retirement-repairs-2026-10-27.json) records source/tree
identity, every case, the expected failing baseline, lifecycle assertions and
original harness failures. Raw `.tmp/tasks/cache-retirement-20261027/` and
`.testLogs/` evidence is historical author-workspace material. No dependency,
patch, Node pin, index or model was changed.

## Remaining program

A fresh live census confirms **736 open issues**: 475 awaiting qualification,
147 partial/follow-up and 114 with unresolved implementation status. The
[owner queue](remaining-issue-batches-2026-10-26.json) retains the original
classification and records all seven closures after the baseline assessment.
The P1 custom-backend cleanup work still needs registered storage roots and
original reader/writer lifecycle adoption. Current external-root protection stays
in place. Tantivy immutable publication, other open-issue acceptance and full
Windows/optional-model/non-Windows/release qualification remain separate.
