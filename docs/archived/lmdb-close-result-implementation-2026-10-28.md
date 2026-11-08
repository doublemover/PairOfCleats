# LMDB close-result ownership — 2026-10-28

Source `2bd50246022173eee5f469b303eeb0ebd3f6c15e`, tree
`9851a934f32571ac2e78758a003b3ad7cef0a03a`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The shared LMDB helper waited for its native completion callback but discarded
resource ownership carried by a successful returned result. A new captured
close owner joins both prerequisites and captures the original result before
waiting for the callback. It coalesces close once, preserves exact failures and
receivers, rejects unconfirmed/failed native calls even after a later callback,
and retains independent inspection/resource prerequisites. Original getters
cannot be replaced to manufacture settlement. Physical close and complete
ownership settlement remain distinct observations.

Actual retrieval, build-command and validator owners now retain that close
owner. A successfully completed native close with pending independent work can
later settle through the original owner; explicit storage metadata recovery
does not repeat native close. Original rejected disposal remains rejected.
Native commands retain settled-result revocation through final metadata release.
LMDB validation also supplies its actual backend/mode context, repairing missing
lifetime admission for effective configured stores outside the repository cache.
These sessions grant no publication or deletion authority.

Eighteen new `storage/lmdb/close-result-ownership/*` controls use actual close,
command and storage owners with inert methods: early return/callback ordering,
pending/replaced/independently inspected/unknowable results, explicit false,
frozen/falsey/rejected native calls, callback-before-rejection, captured methods,
revoked settlement and canonical/configured command metadata recovery.

Eight new `shared/storage/native-validator-sessions/*` cases use actual LMDB:
canonical successful-close result ownership and configured success, admission
exclusion, metadata failure, pending work, failed close, missing-store warning
and successful-close result ownership. Existing positive rows/schema/native
closure and original failure assertions remain. Existing prefetch controls
continue to exercise the real outstanding-read callback boundary.
**All 26 new controls and affected existing cases remain unexecuted.**

Format/ESLint, six changed-JavaScript syntax checks, static inventory and
whitespace checks passed; shared-module analysis found zero cycles. No native
handle, functional fixture, child or publication gate ran. Dependency inputs
are unchanged. #1267/#1574 retain custom producer/publication registration,
category deletion, remaining backend routes and actual current-candidate
Windows/CLI/MCP qualification.
