# SQLite pending-resource admission — 2026-10-28

**UNVALIDATED source:** `32d1b2afc9d01d644098c2b335cde3978542f950`, tree
`e578adeb57abf527cb6114ff98b3a3a65c60a4bc`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1.

The actual existing SQLite storage operation retained failure observations for
teardown but did not require them before admitting another target or child.
An operation that caught an earlier pending resource failure could therefore
dispatch another native route. Already accepted promise work also had no
dispatch-time recheck. Successful outer/child results carrying a pending
resource were not inspected before namespace metadata release.

The repair keeps the current owner and protocols:

- Target/child admission requires all retained original observations and refuses
  incomplete observation overflow. The original inspection failure is retained
  before stopping dispatch; healthy siblings still use their original cleanup.
- Accepted work rechecks immediately before dispatch. Once admission fails, a
  later physical settlement permits metadata reconciliation but cannot reopen
  that operation for another route.
- Successful outer and accepted-child values pass the same original observation
  boundary; pending result work and independent observer errors outlive the
  failed result. Existing exact metadata recovery does not repeat native close.
- Confirmed ordinary diagnostics and successful settled results retain their
  existing operational behavior; counters/budgets and path selection are intact.

Twelve `shared/storage/sqlite-pending-admission/*` controls are authored,
**unexecuted**: target, child, inherited and already-queued dispatch; independently
throwing observers; blocked admission after settlement; settled diagnostic/result
positives; observation overflow; pending outer/child results and observer-result
ownership. They use a real tiny SQLite database, actual category/resource leases,
exact receiver checks and explicit original settlement barriers. They assert no
second native dispatch/file, healthy once-only physical close, retained leases
and exact metadata recovery. No symlinks, elevation, model or copied runtime is
needed. Existing actual artifact/bundle/incremental/fallback/sidecar, configured
namespace, accepted-child and cleanup controls remain.

Format/ESLint, two JavaScript syntax checks and whitespace passed. No functional
fixture or native operation ran now. Source remains unpublished; neither #1574
nor #1267 is closed. Custom/external producer registration and explicit cleanup
authority, eligible category deletion, all/multi-repo and broader native/platform
qualification remain. The owner queue retains **480 pending, 144 partial,
94 unresolved** of the last verified 718-open inventory.
