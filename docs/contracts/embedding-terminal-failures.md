# Stage3 terminal failure publication

The existing embedding publication owner now preserves original work together
with terminal runtime-receipt and state-publication failures. Receipt rejection,
an unsettled successful receipt result, state preparation, reference/observation
inspection and state write errors remain independently required. A failed receipt
does not discard the independent terminal-state attempt. Failed publication
cannot convert an in-memory failure state into a durable outcome.

Only actual absence initializes empty index state. Existing malformed/null/array
state or pending read ownership propagates; the failure path preserves the old
bytes instead of writing an empty replacement. Source extensions and the actual
runtime attempt/observation remain with successful terminal writes.

Progress/artifact diagnostics retain their failures. Started writer-queue drain
precedes terminal publication, and independent drain/stats failures remain in the
original error graph. Mode cleanup uses explicit failure state, including falsey
thrown values. Checkpoint/spool cleanup failures compose through the shared
resource-error owner rather than mutating frozen failures or setting a bare
ownership flag. Unsettled original work retains its actual spool capability;
this does not prove later spool closure or grant file deletion.

Twelve `indexing/embeddings/terminal-failure-publication/*` cases are authored and
unexecuted. They cover frozen/falsey primary causes, independent failed/pending
receipt output, actual state reads/writes, reference/observation failures,
asynchronous preparation, corrupt/null source preservation and pending read
observations. Actual full-runner queue/spool/receipt/native/cache lifetimes and
original/follow-up acceptance remain required. The source is not runtime
qualification or a new recovery protocol.
