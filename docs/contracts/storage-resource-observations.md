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

Storage-session retirement rechecks the captured original settlement receipt
before and after every lease removal. The composed session runner forwards its
original action and receipt observers into that interval. A newly pending
observation blocks later removals; confirmed earlier removals remain recorded and
are never replayed. The added retirement case changes the original observer after
one real metadata removal and requires all remaining leases to stay protected.
It is authored and unexecuted.

Semantic working-set inventory uses the same original directory read/close
owner. Missing-file classification follows original resource observation; a
diagnostic getter cannot erase pending work or return disk credits.

Semantic cache copying retains the original synchronization descriptor through
the contained-file resource owner. Rejected copy/write/sync work gates staging
deletion; confirmed standard-void removal precedes refunds. Cleanup failures keep
the original operation cause, including falsey throws, and identify the actual
cleanup path. Late native settlement never retries a copy or deletes staging
automatically; the surrounding build retains that cleanup authority. Descriptor
and replay diagnostics cannot turn pending original I/O into an ordinary cache
miss or hide it behind cancellation.

Index-format projection and semantic transport classification check original
resource observations before reading diagnostic fields. Cause and format-metadata
objects retain their own original callbacks and receivers; each field is read
once per projection, followed by settlement checks. Changing a public callback
cannot clear the captured prerequisite. Falsey or pending inspection failures
remain attached to the original failure. Cause/metadata walks stop at 128 distinct
objects and reject oversized or reentrant projections without a partial format
claim. Classification grants no cleanup or retry authority.

The existing directory, transfer and migration lifecycle fixtures remain intact.
The independently bounded ledger cases add callback/receiver preservation, late
secondary observations, falsey getter failures, cycles, identity deduplication,
limits, reentrancy, composed contexts and both real adapter recovery paths.
Runtime and cost qualification remain required; fewer copied policy lines are
not a measured performance gain.
