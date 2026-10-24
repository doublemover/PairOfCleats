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
These actual inert teardown controls are also authored and unrun. Other method/
getter admission and real native/child lifetime qualification remain separate work.

Actual teardown now captures each rejected value's original observation before
logging or later cleanup. The existing storage-context composer creates a fresh
diagnostic wrapper without modifying the rejected value. False/absent pending
markers do not discard an original function, and later field replacement cannot
settle it. Independent diagnostic inspection errors retain their original work.
Multiple failures expose exact originals and their captured contexts; all cleanup
steps continue. An ordinary single rejection without resource/inspection work
keeps its exact identity, including falsey values. The category owner receives
those original snapshots keyed by rejected identity before projecting diagnostics,
so a later successful teardown cannot release it around pending original work.

Authored actual teardown/category controls cover mutation during logging, absent/
false/true markers, exact receivers, independent diagnostic work, falsey/frozen
single and multiple errors, unknown observations and original-only recovery.
They are unrun. No automatic native retry, new category lease, cross-process
settlement, full teardown/IPC qualification or performance claim follows.

The existing cleanup timer also classifies only exceptions actually created by
its private deadline owner. An external `BUILD_CLEANUP_TIMEOUT` code cannot be
swallowed as a timer result, and inspecting a hostile code getter cannot replace
the primary before teardown captures it. Generic real deadlines still report
unknown native ownership; late promise fulfillment is not a closure receipt.
Actual timer/original-primary controls are authored and unrun.
