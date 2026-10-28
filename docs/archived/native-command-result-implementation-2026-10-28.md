# Native command successful-result ownership — 2026-10-28

Source `7e5e93ebace95d3307da81658da3000a33f667ab`, tree
`1f49191be1f379d3024c1c53ac003e6e3fdeb5a7`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The actual native database command owner previously captured thrown resource
observations but discarded successful operation/work/SQLite-close observations.
That allowed successful JavaScript completion to release repository/configured
storage leases while the original producer still reported pending ownership.

The command now captures those original results before later diagnostics or
teardown, preserving exact receiver and independent inspection errors. Pending
accepted work blocks further native dispatch and its handle's first native close.
After the original work settles, the existing resource owner can explicitly
perform that first close. An already invoked native close is never repeated.
Successful close observations remain independently required; `isClosed` cannot
authorize staged cleanup while they are pending. Result getter replacement does
not replace the captured original. Hook completion and physical native closure
remain separate prerequisites. Explicit metadata reconciliation checks both
without replaying operation/work/close. Ordinary scalar and settled result
identity, falsey rejections and healthy sibling cleanup remain covered.

Twenty-four new `shared/storage/native-command-result-ownership/*` controls
exercise actual command/session owners with inert handles for canonical and
configured targets: operation pending/settled/replaced/independent inspection/
revoked-after-return, work pending/settled/replaced, and close pending/settled/
replaced/independent inspection. They retain category protection, first-close
ordering, exact-once native dispatch, explicit metadata recovery and original
failure/result identity. **All are authored and unexecuted.** Failed fixture
roots are preserved; no real database, subprocess, link or security change ran.

Format/ESLint, two JavaScript syntax checks, static script inventory and whitespace
checks passed. Shared-module analysis found zero cycles. No functional fixture
or publication gate ran. Dependency inputs are unchanged from the locked
bootstrap recorded in the token receipt. This does not qualify the LMDB helper's
independent close-result boundary, actual native execution, custom publication
registration/category deletion or all/multi-repository CLI/MCP acceptance.
#1267/#1574 remain partial; lifetime admission grants no deletion authority.
