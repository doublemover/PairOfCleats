# Storage session retirement order — 2026-10-28

Source `21464f188ba9d8f785fbbe7ba01aebcd6a87293d`, tree
`a0f8ff2a2c90ce93d2e702cb537a4e60bf870746`, branch
`codex/pr557-audit-repairs-20261012`. Unpublished; no functional acceptance.

Source inspection found the shared storage session releasing leases in
admission order, which puts category ancestors before descendant resources.
A selective child metadata failure could therefore leave its parent category
unprotected even though session retirement remained unresolved. The loop also
called already successful lease releases again during reconciliation.

The original session now captures each original lease/release method and tracks
confirmed metadata retirement. Descendants retire first. A failed or unknown
child retains every admitted ancestor while unrelated sibling branches still
receive their own release attempts. Confirmed sibling/ancestor releases are not
replayed. This uses the same existing session/lease protocol and creates no new
scheduler, authority root, cleanup policy or deletion mechanism.

Metadata failures retain the first captured resource observation through the
common composer, including independently thrown observer errors. Explicit
metadata reconciliation must confirm those original observations before another
removal attempt. A changed later getter cannot replace the original callback.
Partial-admission recovery joins the same original lease records and ordering.

Six authored, unexecuted cases use real disposable metadata rows and selective
removal controls: leaf failure, independent sibling failures, pending original
metadata resource, independent observer error, changing observer getter and
partial progress with an unrelated admitted ancestor. They assert exact parent
protection, independent attempts, blocked premature retries, no replay of
successful original removals and eventual idempotent settlement. Existing
receipt/action/session/canonical/configured native controls remain required.

Static format/ESLint, changed JavaScript syntax, config budget, command inventory
and whitespace checks passed. No functional fixture, child/native campaign,
benchmark or publication front gate ran. Dependency inputs remain unchanged
from the fresh successful locked bootstrap in the
[exact token receipt](context-token-budget-implementation-2026-10-28.md).

Actual final-candidate session, category, native-reader/writer, admission,
cleanup/migration and original/follow-up qualification remain. #1267/#1574 retain
their broader partial scope; producer/publication registration, backend-specific
deletion and remaining unadopted lifetimes are not discharged by metadata order.
