# Service queue dispatch and claim ownership

Source implementation; final supported-runtime validation is pending (2026-10-23).

The service worker passes the effective admission and SLO policy into the queue
claim owner. Each claim recomputes pressure from the current queue while holding
the existing partition lock. Healthy dispatch preserves eligible FIFO order.
Degraded and overloaded dispatch prefers eligible light jobs (existing cost below
two); standard and heavy jobs retain their relative queue order.

The existing `slo.actions.workerMode` value `priority-only` describes this bounded
priority policy. `slo.actions.dispatch` makes the actual policy explicit:
`policy` is `fifo` or `light-first-bounded`, `maxPriorityBypasses` is three, and
`fallback` is `oldest-eligible`. This adds no configuration knob. If light work
does not exist, the oldest eligible standard/heavy job can run immediately. When
both classes exist, the oldest eligible standard/heavy record can be bypassed at
most three times before its next opportunity. This bounds claim order, not wall
time: a job already executing still owns its execution time.

The bounded counter belongs to the queued record as `dispatchPriorityBypasses`.
A bypass is journaled with the existing `defer` event, reason
`dispatch-priority-bypass`, and its exact updated snapshot before the associated
claim is persisted. Claim entries retain their dispatch policy and selection
reason in `extra.dispatch`. Queue reload and journal replay therefore preserve
the opportunity count without relying on one worker's memory or scanning retained
history. A claimed record resets its count. Deferred eligibility, trusted scope
admission, running duplicate suppression and locked `maxRunning` remain prior
conditions for selection. No selection grants an extra running slot.

Within a worker, cancellation controls belong to exact claim objects. Reclaiming
the same queue job ID cannot let an older cleanup remove a newer control. The
public worker `activeJobs` list remains a set of job IDs until all corresponding
local claim executions settle. Definitive lease-owner/version/transition renewal
fences, an explicitly missing job, or a returned non-running record cancel the
old execution and stop its renewals. The old owner awaits execution/lifecycle
settlement and does not submit its late result to queue completion policy. An
ordinary transient renewal I/O rejection retains the existing retry/log policy.

Authored actual-consumer fixtures:

- `services/queue/priority-dispatch` covers healthy/degraded/overloaded order,
  persisted fairness and replay, no-light recovery, scope/deferred eligibility,
  running duplicates, concurrent caps and the actual worker-to-queue handoff.
- `tooling/service/indexer-queue-worker-claim-generation` covers reused IDs,
  fatal sibling cancellation, delayed teardown and definitive renewal fences.

These are source and authored coverage, not a completed queue/runtime receipt.

Failed resource disposal or an execution error with an unresolved original
resource observer retains the exact claim in the worker. The worker reports
`cleanup-pending`, retains its cancellation control, and does not submit success,
retry or ordinary completion. It writes a versioned `cleanup-holds.json` receipt
(or `cleanup-holds-<partition>.json`) under the existing queue lock. This receipt
is separate from queue snapshots so ordinary save/compaction cannot erase it.
It captures the original job, owner, lease version, attempt and failure code.
Original observers and causes remain in private process capabilities, never JSON.

Queue claims, enqueue and quarantine retry refuse a partition with retained
cleanup. The held job cannot be completed/quarantined or recovered through lease
expiry. Job inspection, repair diagnosis and backpressure status expose the
hold; artifact retention also preserves its original logs/reports. Journal
compaction and replay retain hold observations without treating a replayed
identifier as release authority.

The original worker can reconcile only after its captured resource observers
confirm settlement. Changed advisory flags, replaced observers, matching job IDs,
PIDs and elapsed leases grant no release. Recovery preserves the failed disposer
outcome by quarantining the original claim without automatic execution retry.
An old claim's retained failure/release never overwrites a newer claim's lease.
Native indexer sessions retain their worker through failure and use this same
reconciliation owner during session disposal.

After process restart, durable holds remain fenced: the new worker has no
original capability and cannot infer closure. There is no generic force-clear or
PID-based recovery path. A disposer with no usable settlement observer remains
unknown. Failure to persist the hold is retained locally and reported with the
original failure; persistence failure does not prove a durable receipt exists.
`services/queue/cleanup-retirement` and `tui/operator-indexer-cleanup-retention`
exercise these actual owners with controlled resources; supported native and
restart-host qualification remains deferred.
