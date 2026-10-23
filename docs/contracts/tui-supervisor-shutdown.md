# Supervisor output and shutdown ownership

Status: source implementation, unvalidated (2026-10-22).

The supervisor observes errors, close and actual write callbacks on its own stdout
stream. Backpressure alone is not a transport failure. The first real failure
fences new work and requests the existing supervisor shutdown; later progress
callbacks retain durable event recording without throwing into child teardown.
The original protocol queue and credit rules remain the outbound queue owner.

Every admitted command and internal operation retains a private settlement promise
through its execution, post-run observation and artifact collection. `job:end`
retains its original meaning and ordering; it does not release an unfinished
artifact reader, permit the same job ID to be reused, or grant exclusive backend
maintenance access. Removal occurs only after actual settlement.

EOF, signals, native shutdown and stdout failure share one shutdown promise.
Admission closes synchronously, only registered jobs are cancelled, and every
session closer is attempted even when another fails. Shutdown awaits actual job
and session owner promises before final event-log metadata and process exit.
Metrics, owner-registry and transport failures use the same error aggregation;
none skips the remaining known jobs or final recording. Every cancellation is
issued before waiting for any one cancellation to finish. A failed registry
cannot identify unknown session owners and is reported as incomplete settlement.
An unfinished promise remains unfinished; an elapsed timeout cannot manufacture a
closure receipt. The native lifetime owner retains its existing bounded platform
containment fallback. Unknown database settlement retains canonical exclusion.

An execution that reports pending child cleanup retains its exact job registry
entry after job:end and promise completion. It cannot retry, publish artifact
observations, admit later work or grant backend exclusivity. Status/describe and
owned service stop controls remain available. Only the original settlement
observer can permit removal and same-ID reuse; old cleanup cannot remove a newer
job. Shutdown reports such an owner as failed/unconfirmed even after its execution
promise completes. No timer manufactures a release or changes the public CLI.

The generic admission error is `ERR_TUI_RESOURCE_PENDING`, with the original
resource failure retained as its cause. Backend-specific execution diagnostics
remain on that original failure. The generic task message describes unconfirmed
resource cleanup. The supervisor captures each original observer and receiver
before later callbacks can replace advisory flags or methods. An observer is
retained even when its pending flag is false/absent. Sibling settlement captures
rejections immediately and preserves falsey causes and independent ownership
reported by inspection failures. A native indexer's queue recovery capability
remains private to its retained worker/session, including after job termination.

Final output drains use write callbacks and a bounded flush wait. A failed pipe or
expired flush wait reports incomplete output and makes an otherwise successful
exit nonzero. Existing nonzero signal status is preserved. The supervisor borrows
stdout and does not destroy an unrelated stream or perform process discovery.

The native lifetime owner separately reports the actual supervisor exit status.
A nonzero exit during quit and expiration of the graceful deadline remain host
failures even if subsequent exact job containment succeeds. Every independent
containment, wait and output-drain failure remains in the reported error chain.
The lifetime owner marks closure only after those resource operations succeed.
Reader I/O/framing failure is retained in the private bounded ingress owner,
separately from JSON protocol fields. EOF after a partial final frame therefore
cannot become a successful shutdown drain.

If no producer terminal event arrived, the native snapshot records the job as
`interrupted` and reconciles its unfinished tasks without claiming a failed,
cancelled or successful producer outcome. Observed terminal outcomes remain
unchanged. Exact process-family reaping and terminal restoration are separate
qualification witnesses. The Windows ConPTY shutdown-error, shutdown-timeout and
shutdown-partial-frame fixtures exercise real owned process exits and byte
transport failures with the existing deadlines; they are authored, unvalidated.

Authored fixtures cover callback/synchronous/error/close failures, ordinary
backpressure, durable final events, incomplete flushes, concurrent shutdown,
rejected closers, post-terminal artifact work and backend admission. Tests and
native host/ConPTY acceptance remain deferred; no process or terminal was launched
to validate this source group.

## Retained operator readers

Search queries, source reads, artifact inventories and artifact side effects
capture original cleanup observations before a rejected promise leaves their
active work set. Promise settlement alone does not authorize disposal or a new
reader. Unconfirmed original file or child ownership remains in the existing
session, including when disposal itself caused the rejection through abort.
Repeated disposal checks the original proof; it does not reread inputs or
recreate a consumer. Backend drain clears a session slot only after that exact
owner's disposal succeeds. A failed slot retains its original recovery methods.
