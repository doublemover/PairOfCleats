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

The vector spool now uses the existing contained-file owner for each original
FileHandle and its captured stat/read/write/sync/truncate/close operations. A
close stops admission and joins accepted writes; retiring is separate from
confirmed closed state. Healthy descriptor siblings close independently. Failed
or unobserved native closure retains the original session for explicit
`recoverAfterClose`; confirmed closes are never replayed.

The allocation owner records the actual mkdtemp directory and admitted file
identities. It removes only the three exact created files after confirmed native
closure and observations, then removes the empty original directory. Unknown
children, replaced/shared files, replaced directories and unobserved identities
remain protected. Recursive prefix-based removal is gone. Metadata-only recovery
does not repeat confirmed native close or rewrite vector bytes.

Deferred mode cleanup retains both original work and actual spool settlement.
The existing outer cleanup attempts it after original scheduler/provider disposal;
a later true work callback alone cannot acknowledge still-open spool files.
Native close failure retains its original explicit recovery owner. Outer receipt,
diagnostic and text-cache cleanup failures also preserve the original cause,
including frozen/falsey failures and independently pending successful results.

Fifteen additional `indexing/embeddings/vector-spool-original-lifetime/*` cases
are authored and unexecuted. Real FileHandle gates cover pending/failed close,
healthy siblings, captured-method identity, failed construction/admission,
metadata recovery, unknown/replaced objects, frozen/falsey writes, accepted-work
drain, independent observers, truthful closed state and deferred work settlement.
Existing ordinal/generation/short-progress/cancellation tests remain required.
