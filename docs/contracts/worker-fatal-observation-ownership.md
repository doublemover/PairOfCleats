# Indexer worker failure and observation ownership

The indexer separates ordinary task rejection, best-effort observation and fatal
execution-owner retirement. This is an internal protocol; CLI/configuration and
semantic artifact contracts do not change.

`observation.js` owns version1 thread/process observation envelopes. Each frame
is at most16KiB of serialized UTF-8, including metadata. Error projection shares
2KiB of retained UTF-8 text across fixed message/stack/code/name and at most two
cause links. Projection scans bounded string prefixes, reads only own data
properties, rejects proxies and never invokes getters or custom inspection.
Cyclic/unsupported details and truncated fields have explicit counts. These are
encoded-text/queue bounds, not total JavaScript object or process-RSS measurements.

One frame may await acknowledgement. In-flight plus pending ownership is capped
at eight events and64KiB of serialized bytes per worker. Under pressure the queue
drops older pending frames, retains its newest state and reports cumulative
drops/send failures in subsequent frames. A `process.send` false return means
backpressure, not permission to resend. A stalled/missing acknowledgement can
reduce telemetry; it cannot stall task execution or release a task reservation.
Frames are re-admitted at receivers. Original task input/output/initialization
allowances remain separate and retain their existing checks. Runtime observation
projects a fixed field inventory; oversized correlation identities omit the frame
instead of reporting a truncated identity. Heap readiness is checked independently.

Start/completion reporting cannot replace a return value or an original thrown
value, including falsey values. The transportable task error retains bounded
first-cause context; arbitrary original error objects are not cloned as verbose
diagnostic payloads. Process diagnostics consume asynchronous send failures rather
than turning a failed metric write into an authoritative task/worker failure.
Parent metrics/crash-log subscribers are also non-authoritative.
An asynchronously failed process diagnostic channel drops its bounded pending
ownership and stops further diagnostic sends. Its task and fatal-control channels
remain independently owned.

`fatal-policy.js` installs `uncaughtExceptionMonitor`, preserving Node's default
fatal exit. An unhandled rejection poisons the owner immediately and throws its
original value on the next tick, even under inherited rejection-warning policy.
The fixed version1 terminal control has a separate2KiB ceiling and contains only
worker identity and an enumerated reason. Retirement never waits for verbose
diagnostics or their acknowledgement. An undelivered control still ends in the
normal thread error/exit or process close path.

Process retirement marks its exact slot ineligible before rejecting its task;
late results are fenced. The original input/IPC/scheduler ownership remains until
the original child closes. Stop failure retains its retryable cleanup owner.
The restart allowance counts sequential deaths even without a queued request at
close; only future work can use a replacement. Existing process capacity and
memory accounts remain authoritative.

`IndexerThreadPool` wraps Piscina's public interfaces and retains actual Worker
handles, including handles Piscina removes before exit. Fatal control/raw error
poisons the whole pool generation before subscriber notification, rejects
outstanding requests once and starts the existing destructor. Destruction begins
synchronously, preventing Piscina's later error handler from replacing the worker
inside the poisoned generation. The existing bounded destructor/termination
fallback sees the retained handles. Caller/scheduler settlement waits for all
original exits; destructor rejection cannot fabricate a release receipt. A new
generation uses the existing lifecycle restart policy. PID and thread ID event
adapters retain actual identities and captured exit identities.
Fatal restart accounting survives replacement construction for the lifetime of
the facade; a crash storm cannot reset its allowance by creating a new pool.
Confirmed ordinary destruction retains Piscina's explicit subsequent-run reuse;
fatal or unconfirmed destruction never permits that reuse. Existing real-worker
completion counters and pool sizing remain available through the adapter.

All three task facades reject fatal dispatched failures; no current task is
silently replayed or converted into an inline fallback. Ordinary backend task
rejection does not itself poison the backend adapter. Existing higher-level
ordinary-error recovery policy remains in force.

New unrun regression owners: `worker-observation-bounds`,
`worker-fatal-ownership`, `process-fatal-retirement`, `worker-fatal-runtime` and
`facade-fatal-no-fallback`. They author passive-error/Unicode/queue bounds,
original-outcome controls, failed-stop and late-result fencing, sequential
restart exhaustion, actual tiny thread/process fatality, healthy ordinary errors
and facade no-replay controls. Existing telemetry retirement, process lifecycle,
scheduler retirement and actual tokenizer/batch fixtures remain intact. No
runtime assertion or native-crash qualification is claimed by this document.
