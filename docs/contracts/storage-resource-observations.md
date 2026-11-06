# Original storage resource observations

`createStorageObservationLedger` in the existing failure-observation module is
an internal observation policy shared by asynchronous directory and transfer
owners. Each operation owns its ledger; no process-wide resource registry or
disposal protocol is introduced.

The ledger captures original callbacks with their original receiver once,
deduplicates identities, retains late inspection failures and imports bounded
contexts from the existing storage error composer. Pending, throwing or unreadable
observations cannot become settled through public diagnostic replacement. Falsey
failures retain their values as causes; frozen, symbol and nonenumerable original
fields are not rewritten. The adapter excludes only its own privately identified
aggregate to avoid gating an owner's close on that same close.

The existing limits remain 64 inspection failures, 128 observers and 128 contexts.
The capture queue is bounded to 128 entries and drained iteratively. Overflow or
incomplete imported context remains incomplete for the ledger's lifetime.
Reentrant observation cannot report settlement; late original settlement can be
observed without replacing or retrying the original callback. Diagnostic snapshots
are immutable and do not invoke observers.

Directory ownership still drains admitted reads, captures original methods and
requires standard-void close confirmation. Transfer ownership still verifies
contained source identity, streamed bytes/hash, output identity and its own close
result contract. Neither ledger settlement nor another adapter's aggregate grants
authority to close, unlink, retry, admit a generation or release reservations.
An already failed operation remains failed after its resources settle.

The existing directory, transfer and migration lifecycle fixtures remain intact.
The independently bounded ledger cases add callback/receiver preservation, late
secondary observations, falsey getter failures, cycles, identity deduplication,
limits, reentrancy, composed contexts and both real adapter recovery paths.
Runtime and cost qualification remain required; fewer copied policy lines are
not a measured performance gain.
