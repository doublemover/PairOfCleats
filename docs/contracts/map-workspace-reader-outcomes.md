# Workspace artifact reader outcomes

The initiating read and browser health are separate outcomes. If row decoding,
admission, generation validation or cancellation fails and the exact owned
iterator also rejects release, `ERR_MAP_READ_CLEANUP` is an aggregate whose
`cause` is the exact initiating value and whose immutable `errors` contains that
value followed by the exact release failures. Falsey thrown values are present
failures. The originals are never mutated or coerced.

The map-only composition owner records primary and cleanup roles privately.
Passive optional diagnostic fields are captured once without evaluating error
getters, lazy stacks or ownership callbacks. Failed descriptor inspection stays
separate exact evidence. The API projects the original read status/code/name;
cancellation is `CANCELLED`, while cleanup is independently marked failed and
terminal. HTTP diagnostics contain safe bounded text, not raw error objects.

A release rejection still poisons the browser, prevents new reads and cursor
reuse, and remains the exact rejection from idempotent service close. Natural
completion with failed release is cleanup-only; it does not fabricate a read
failure. Release runs once, including service close and idle expiry. Successful
cleanup preserves the original read failure exactly and does not poison the
browser. A failed release is never silently retried or reported as complete.

Actual catalog/adapter regressions cover frozen and falsey originals, diagnostic
accessors, continuation, cleanup-only completion and terminal falsey release;
existing active-close and idle-expiry controls remain. These controls are
authored; the parallel implementation wave defers broad qualification. No real
corrupt-index incident, browser/HTTP deployment or native cleanup qualification
is inferred from inert iterator and response collaborators.
