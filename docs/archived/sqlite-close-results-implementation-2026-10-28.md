# SQLite successful close and settlement results — 2026-10-28

Source `af7586dead04bcaaec726264e9a99e798ab32ffc`, tree
`1f6fc4fb90206936ab8dae1ee5857ca2fadab656`, branch
`codex/pr557-audit-repairs-20261012`. Local/unpublished and functionally unqualified.

The shared cached/uncached SQLite owner observed thrown failures but could accept
a successful native return or callback while its original resource observation was
still pending. It now captures those original results before projection. A known
successful physical return sets the no-repeat boundary before its independent
result is required. Pending/replaced/throwing observations remain original; later
reconciliation skips the confirmed native call and completed callbacks.

Bookkeeping precedes launch-namespace release hooks, retaining returned work
before exclusion retirement. Native settlement is a separate predicate over
physical confirmation and original native return observations; metadata completion
does not feed its own prerequisite. Promises cannot qualify synchronous callbacks.
Independent errors remain together; failed ordinary metadata callbacks retain the
existing explicit retry policy, while completed callbacks are not repeated.
Handoff callbacks retain their method/receiver. Observation history and reentrant
evaluation fail closed.

The actual cache was adjusted with the ordering: bookkeeping no longer marks an
entry closed/removes it before namespace settlement. Closed status comes from the
original owner, and retirement/pending queries prune only settled entries. Failed
disposal retains the exact pending owner. Late revocation and reconciliation also
remove the actual global pending registry entry. Primitive void/boolean outcomes
avoid unnecessary Error allocation.

Seventeen `storage/sqlite/cache-close-result-ownership/*` controls are authored:
pending/replaced/unreadable/independently failing/revoked native result; hook,
bookkeeping and handoff results; Promise refusal; ordinary metadata retries;
bookkeeping before namespace release; original handoff method; actual cache
pending-owner retention; and two actual SQLite closes. The real pending-result
case observes the closed native handle yet withholds logical settlement until
the original observation completes, with one native call. **All 17 and affected
original cache/retrieval/probe/build/validation suites are unexecuted.** Inert
unknown-evidence negatives do not claim real cleanup success.

Format/ESLint, three changed JavaScript syntax checks, static inventory and
whitespace checks passed; shared-module analysis found zero cycles. An initial
extra EOF blank line was corrected before the source commit. No functional test,
native operation, child, debugger, install or benchmark ran. Dependencies/schema/
semantic output versions are unchanged. Full Windows validation starts at
checkpoint 240 under the user's current instruction.

#1267/#1574 remain partial for remaining lifecycle/custom publication/authority
adoption and qualification. #248/#284 retain their remaining source/native
acceptance. Inventory stays 482 pending / 146 partial / 90 unresolved of 718 open.
