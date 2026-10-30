# Configured SQLite build ownership — 2026-10-28

Source `bc2f557c27ef9d81c3cb635641d80c62b79696cf`, tree
`9db81906637dc0f914ee0f1c44dd0512d6404a7f`, on
`codex/pr557-audit-repairs-20261012`. Unpublished; no functional qualification.

The existing SQLite operation owner previously skipped every selected resource
outside canonical repository/cache-temporary roots. Its configured outputs now
reuse the exact effective backend selection introduced for readers. The shared
selection owner is named `configured-native-storage.js`; reader imports and
controls use that owner directly, without compatibility wrappers or a second
namespace registry. This adds lifetime coordination, not artifact publication
proof or cleanup authority.

An exact configured final database is admitted before its provider-owned
namespace. That namespace protects native/staging/backup/sidecar operations
through source work, original native settlement, publication, accepted children
and metadata release. A two-pass batch admits a declared final target before
its staging resources even if the input order is reversed. Unregistered external
destinations preserve their existing behavior and protected cleanup status.
The operation admits at most four configured mode targets and retains existing
64-path batch/256-exact-resource bounds. Repeated targets do not add leases.

The actual configuration path projection participates in inherited-operation
identity. Nested work with a different configured destination receives its own
original operation owner. Configuration/locator changes reject further resource
admission and cannot reset a failed admission. All leaf namespace/resource
metadata settles before enclosing repository/temporary categories. Existing
retained resource failures and metadata-only reconciliation remain responsible
for their original work; no native retry or forced cleanup is introduced.

Nine authored protocol cases cover namespace protection, staging order,
exclusion before work, changed/nested selection, ignored accepted children,
metadata failure/reconciliation, unknown outputs and repeated co-resident modes.
The actual SQLite artifact/bundle/incremental/fallback dispatch fixture gains
four configured-destination cases. It asserts namespace and exact native-path
leases at construction and original close, unchanged row results, one actual
physical close and complete metadata release. All **13 new cases are unexecuted**.
Together with the configured-reader span there are **31 new authored controls**,
without claiming the earlier canonical controls qualify these new paths.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
and whitespace checks passed; shared-module analysis found zero cycles. No
functional fixture, child fixture, benchmark or publication front gate ran.
Dependency inputs remain those of the fresh successful locked bootstrap recorded
in [exact rendered tokens](context-token-budget-implementation-2026-10-28.md).

#1574/#1267 remain partial. Actual final-candidate SQLite/native/category
qualification, LMDB/legacy/other unadopted lifetimes, producer/publication
registration and backend-specific deletion/requalification are still required.
Existing custom cleanup stays protected/report-only. The source work does not
authorize deleting selected backend files or infer a disposable category from
their path, name, marker, absence of readers or generation label.
