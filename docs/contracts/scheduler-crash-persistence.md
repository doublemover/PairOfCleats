# Scheduler crash evidence persistence

The scheduler attempts local, durable and external crash-evidence sinks
independently. A failure in one sink cannot suppress the remaining sinks through
error classification, warning output or optional presentation. Warning callbacks
run after the original sinks and their asynchronous work belongs to the same
persistence owner. Rejected warning output is recorded, without recursively
warning about that warning failure.
Optional presentation and warnings have separately tracked operations, so a held
callback cannot block later events from reaching the serialized evidence sinks.
The final wait still joins both work sets before accepting completion.

The owner privately retains original errors and their actual resource-settlement
observations. Diagnostic fields are inspected only after settlement; throwing
metadata or settlement callbacks retain their independent causes and resources.
Frozen errors and falsey thrown values remain failures. Public summaries contain
bounded code/message text and safe copied rows, not resource controls. Each warning batch
retains at most 64 messages and counts omitted warnings;
the corresponding failure/ownership inventory is not discarded.

`persistence.ok` requires completed work and no failures. `pending` distinguishes
unfinished operations or unresolved failure ownership from settled degradation.
The wait joins all queued work, including warning output, and rejects while
original failure resources remain unconfirmed. A later explicit observation can
confirm the original release; it never retries a failed sink or repeats a write.
Ordinary settled storage/presentation failures remain explicit degraded telemetry.

The existing 30-second cleanup deadline bounds scheduler persistence. Only its
actual privately minted deadline may carry the original persistence owner's live
settlement observation. A timeout-shaped external error cannot acquire that
authority. The deadline propagates failure while sink work remains owned rather
than reporting a completed telemetry pass or publishing a successful planner
continuation with unknown persistence lifetime.

The actual tracker and publisher fixtures cover local failure with successful
durable/external evidence, throwing/rejected presentation, throwing error metadata,
original and inspection-resource holds, asynchronous warning holds, deadline
identity, falsey failures and unchanged no-failure controls. Their IDs are
`indexing/tree-sitter/crash-persistence-ownership`, `crash-persistence-degradation`
and `crash-presentation-degradation`. They use tiny ordinary files and recording
callbacks, with no parser crash, native build or child invocation. Execution
remains deferred; source completion is separate from Windows runtime acceptance.
