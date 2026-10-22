# Build runtime failure presence and category ownership

Initialization cleanup and failure-receipt persistence carry failure presence
separately from rejected values. Undefined, null, false, zero and empty strings
remain exact failures. Frozen originals stay unchanged on the aggregate's cause;
cleanup failures and failed diagnostic inspection remain separate evidence.
The actual receipt wrapper forwards recording-failure presence through the
runtime's existing finalizer, including a rejection with undefined.

The existing runtime storage owner retains the category after failed cleanup or
failed failure recording. Successful unwind alone does not release it before
the failure receipt settles. Original independent settlement functions and
receivers are captured before diagnostic projection and cannot be replaced by
later property edits or false advisory markers. Only this producer's own failure
for this exact owner is excluded from self-observation; a sibling runtime's
aggregate does not grant release authority. Unknown observations remain blocked.

The composition helper adds diagnostic context, with no lease, namespace,
deletion or native-retry authority. Failed teardown/rejected registry close is
not automatically retried. This source slice does not qualify recovery after an
unknown native close, arbitrary descendants, full teardown composition or IPC.

The actual receipt/finalizer and disposable category controls are authored and
**UNVALIDATED**. Tests, syntax, formatting, bootstrap and Windows resource
qualification remain deferred. Fixture-only metadata disposal is not a
production resource-settlement claim.

Replay-verification clearing now runs as an independent bounded teardown step.
Its rejection cannot bypass logger closure or the existing category failure
retention, including falsey rejection values. Best-effort progress diagnostics
consume asynchronous rejections through the same reporting callback supplied to
cleanup/LSP/parser owners; diagnostic completion is not resource settlement.
These actual inert teardown controls are also authored and unrun. Method/getter
admission, full multi-error teardown projection and real native/child lifetime
qualification remain separate work.
