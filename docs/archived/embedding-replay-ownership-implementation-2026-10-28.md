# Service embedding replay ownership — 2026-10-28

**UNVALIDATED source:** `a3913798cdaf8b8314c69cf43be2e73256a11200`, tree
`37a901a0c8af9a7053825ffe165b869d7d711f74`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

Service replay still loaded state after asynchronous observations and replaced
the whole object. It could reset newer work and discard newer native namespaces.
It also recursively deleted a fixed legacy path based solely on its name, and
the job executor continued with an indexDir outside the selected buildRoot.

Recovery now captures the original state before observations. Legacy unowned
pending-state resets use the shared native publication owner, compare the original
generation/invocation/embedding witness and mutate only current embedding fields.
Unrelated native fields/extensions remain fresh. A replaced witness fails without
publishing the reset. Attempt-owned state stays with its original invocation;
the next actual Stage3 run explicitly claims and initializes its own pending
state. Retention actions do not count as a successful repair. Outside-root jobs
are rejected before dispatch and replay modes must be canonical.

The removed recursive deletion has no current producer owner. Source inventory
at this revision finds `.embeddings-backend-staging` only in the service path
resolver, replay's diagnostic consumer and fixtures. The actual runner allocates
`.ann-` via `mkdtemp` at lines 3664–3666, passes that exact directory to backend
publication and retires it through its writer cleanup at line 3748. The fixed
legacy name therefore cannot prove current ownership or authorize unknown data
deletion. It remains visible as a diagnostic and is preserved; its mere presence
does not mark a healthy current index as partially durable. No current `.ann-`
cleanup owner or meaningful native publication coverage was removed.

Fourteen `services/indexer/embedding-replay-publication/*` controls are authored,
**unexecuted**: legacy reset/idempotence, concurrent native preservation,
replaced embedding/attempt/generation witnesses, owned-state retention and the
real subsequent claim owner, outside roots, traversal modes, unreadable/pending
reads, unknown legacy files, healthy current state and required manifest failure.
The original replay/executor/soak fixtures retain state recovery assertions and
now use canonical manifests. The obsolete unowned-deletion expectation becomes
an explicit sentinel-preservation negative. The executor also retains a real
external-root/no-child negative. Native command/replay/queue/soak qualification
and cleanup of genuinely owned interrupted staging remain required.

Format/ESLint, seven JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. #1267/#1574/#284 remain open with unchanged counts of
**480 pending, 145 partial and 93 unresolved** of 718 open issues. Source is
unpublished; functional qualification and the publication gate remain deferred.
