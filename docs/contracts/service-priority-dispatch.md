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
Durable recovery after an independently failed resource disposer remains outside
this claim-generation repair; a settled execution is not proof of native closure.
