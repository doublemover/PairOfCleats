# Cleanup original results and exclusion recovery — 2026-10-28

**UNVALIDATED source:** `bf602f71a2b9b202bddbb0380404272b9f7a0c78`, tree
`c1c14b0f4d71fb91808086341f46b130f707fc2a`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The generic repository exclusion and its dual-namespace cleanup composition
ignored successful action results carrying original unsettled work. Metadata
could retire before those resources settled. The composed metadata-error path
also waited for metadata settlement before asking its actual owner to recover
that metadata, preventing the intended explicit retry.

The generic owner now captures original action results/failures and retains
their prerequisites in the actual published lock before release. Failed work
and reader-restoration errors preserve independent causes. A handed-off parent
reader remains suspended and protected while original work is unsettled. The
actual `repoCacheCleanupOwner` supports explicit recovery: original work must
settle, its reader is restored under exclusion, and the original publication
session retries only its own metadata. Cleanup work is never replayed. Confirmed
success preserves the original return object; falsey/frozen failures survive.

The composed repository cleanup owner captures successful work before either
namespace retires, carries the original prerequisite through both lock owners,
rechecks before category retirement and keeps both namespaces/category leases
on failure. Explicit metadata recovery uses the captured actual publication
session; it neither waits circularly on its own aggregate failure nor reruns a
confirmed native close. Explicit composing/delegating owners retain their existing
authority; feeding their aggregate released predicate back into their own locks
would self-gate, so the generic wrapper does not do that.

Seventeen `shared/storage/cleanup-result-ownership/*` controls are authored,
**unexecuted**: generic/composed marked and unmarked pending results, confirmed
identity, frozen/falsey work, actual metadata unlink failures, real local handoff,
release-getter/result revocation, callback replacement, original receiver/getter
capture and repeated explicit recovery without work replay. They use the real
exclusion/category owners and disposable files, keeping an unrelated sentinel.
The original three repo-cleanup-exclusion and existing handoff/delegation/GC/
CLI/MCP/native/category qualification cases remain required.

Format/ESLint, three JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, child, native operation,
server or benchmark ran. No deletion authority, stale policy, quota threshold,
retry policy or public configuration changed. #1267/#1574 remain open for broader
custom producer/cleanup integration and runtime qualification; counts remain
**480 pending, 145 partial, 93 unresolved** of 718 open issues. Source is local
and unpublished; the publication gate remains deferred.
