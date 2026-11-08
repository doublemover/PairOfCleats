# Original snapshot data publication

Each snapshot data initialization has its own original attempt, disposer, source
index, remote source, client and publication identity. A newer initialization
revokes the earlier attempt before calling its original prior disposer. Failed
prior cleanup remains in its existing exact resource owner; it cannot become a
new sibling's cleanup authority. Data lifetime remains independent of renderer
retries, context loss and scene rebuilds.

The original disposer is published inside the guarded construction span before
worker allocation. Worker configuration fields are original own passive fields;
the constructor cannot be redirected through a later accessor. Native progress
that arrives synchronously during construction is coalesced into at most four
notification kinds and applied only after the original client and pagehide
listener are published. An early ready notification is not erased by initial
readiness reset. Late earlier construction cannot publish over its replacement.

Every publication step and original ready/failure/fallback callback checks that
same attempt, source, client and disposer. The original callback and receiver
are captured once. A callback that reenters initialization cannot authorize the
earlier callback's next step. Failure reporting uses the existing original scene
diagnostic snapshot, preserving falsey causes and independent inspection values.

Retirement revokes the original publication before independent cleanup of its
captured pagehide remover and original client. Field setters cannot clear a
sibling installed during revocation. An installed-then-throwing registration or
setter retains the original primary and separately attempted cleanup failures.
The existing resource inventory strongly retains original failed/unfinished
owners. Accepted construction/callback stacks and independent original pending
observations gate native cleanup. Deliberate exact-owner reconciliation is
required after a failed cleanup; it never repeats a successful child close or
adopts sibling resources. Reentrant retirement can therefore leave an original
late client pending for explicit reconciliation after its construction drains.

The actual data-session and worker-client controls are authored but
**UNVALIDATED**. No tests, syntax/lint/format, bootstrap, browser/editor/native,
child/IPC/model/GPU, build or benchmark execution was performed. This does not
qualify real pagehide/Worker effects, physical cancellation, native retry safety,
inaccessible allocations, producer coverage or performance. Unknown pending
observations remain unconfirmed.
