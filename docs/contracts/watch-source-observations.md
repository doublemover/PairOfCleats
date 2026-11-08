# Watch source observations

Watch classification distinguishes a known policy exclusion from a failed source
observation. I/O failures retain the tracked entry and pending path. They do not
record an authoritative skip or admit a newly consistent generation with stale
source contents. Both watcher backends use the same classification/retry owner;
Parcel's write-stability check remains a prerequisite inside that owned update
queue. Its observation errors share the same retry and absence rules; unstable
writes use that retry owner as well. The legacy boolean stability helper keeps
its standalone behavior for callers that do not request typed failures.

Retries re-enter the existing update queue without requiring another event. Only
the affected path is retried, after 50 ms, 100 ms, 200 ms and subsequent doubling
up to 5 seconds. Persistent access/I/O failures remain pending indefinitely with
their code, attempt and next retry time. They do not spin or claim completion.
Snapshots retain the full pending count and at most 16 diagnostic paths.

An explicit unlink event removes membership immediately and invalidates an active
older observation. Without unlink, ENOENT or ENOTDIR needs two consecutive
observations separated by the retry delay before becoming a missing-file skip.
A new event resets that absence evidence. A replacement observed on retry remains
indexed. Known ignore, size, routing and generated-file exclusions retain their
existing authority.

Rebuild and pre-publication admission wait for classification work and unresolved
observations. Recognized observation failure aborts an active attempt through its
existing publication abort signal. An already committed pointer retains its
publication receipt; unresolved newer work keeps the watcher catching up.
Shutdown cancels retry timers and waits for active update-queue observations. It
does not erase unresolved backlog to manufacture quiescence. Resource ownership
failures retain their original release prerequisites and terminate the watcher
instead of becoming ordinary retryable observations.

The owner and live-orchestration fixtures inject observation failures and a retry
clock. They cover recovery from one event, successful siblings, both backend
selections, persistent failures, confirmed absence, replacement gaps, unlink races
and active/timer shutdown. They need no filesystem permission changes. Authored
coverage is separate from executed runtime qualification; current execution
status is recorded in the linked roadmap receipts.
