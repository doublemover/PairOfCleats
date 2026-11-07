# Bakeoff worker lifetime through checkpoint release — 2026-10-28

**UNVALIDATED source:** `ff403a9273fac40d955c43e77ff830198744831a`, tree
`add2ba09afa8ddb228d40458e02ff1d6b2fc2365`, branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

The existing bakeoff checkpoint owner returned `{ result }` to its file-lock
wrapper. A fulfilled worker carrying original pending resources was hidden inside
that object, so checkpoint ownership could retire before actual work settled.
Accepted writes could also revoke an initially confirmed result while draining.

The owner now captures the original worker observation before closing write
admission, retains it through all accepted writes and independent failures, and
returns its captured prerequisite through the existing file-lock release owner.
Unconfirmed original work or observer inspection keeps the actual checkpoint lock.
Explicit original-session metadata recovery never reruns the campaign, repeats a
confirmed close or re-reads a substituted public observer. Successful caller return
identity and falsey/frozen failure contracts remain unchanged.

Eight `perf/bench/bakeoff-worker-result-lifetime/*` controls are authored,
**unexecuted**: marked/unmarked pending work, confirmed identity, callback
replacement, accepted-write revocation/failure, falsey worker failure and an
independently pending observer. They use actual checkpoint/atomic writers and
lock sessions, reject competing invocations while pending, recover original
metadata and allow a genuinely fresh invocation afterward. No model/corpus run
is needed for these controls. Existing checkpoint, resume, failed publication,
phase lifecycle, policy and A/B sweep coverage remains required.

Format/ESLint, two JavaScript syntax checks and whitespace passed. No functional
fixture, child, native operation or benchmark ran. #1663 remains partial: the
existing immutable A/B/bakeoff paths and atomic checkpoints remain, while settled
evidence retention/retirement, saved/export/resume reference protection and
capacity admission need implementation and qualification. No automatic deletion
or new public surface was introduced. Counts remain **480 pending, 145 partial,
93 unresolved** of 718 open issues. Source is unpublished and the publication
gate remains deferred during implementation.
