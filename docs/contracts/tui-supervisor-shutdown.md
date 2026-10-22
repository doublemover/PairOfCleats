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

Final output drains use write callbacks and a bounded flush wait. A failed pipe or
expired flush wait reports incomplete output and makes an otherwise successful
exit nonzero. Existing nonzero signal status is preserved. The supervisor borrows
stdout and does not destroy an unrelated stream or perform process discovery.

Authored fixtures cover callback/synchronous/error/close failures, ordinary
backpressure, durable final events, incomplete flushes, concurrent shutdown,
rejected closers, post-terminal artifact work and backend admission. Tests and
native host/ConPTY acceptance remain deferred; no process or terminal was launched
to validate this source group.
