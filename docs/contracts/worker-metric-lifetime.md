# Worker metric lifetime

Status: source implementation and authored controls **UNVALIDATED**, 2026-10-22.

Prometheus task durations are process-lifetime totals aggregated by bounded
`pool`, `task` and `status` labels. The existing
`pairofcleats_worker_task_duration_seconds` name, buckets and label shape remain;
`worker` now has the single explicit value `all`. Worker retirement, replacement
and pool restart never delete duration/count history or reset the registry.
Consumers previously filtering a numeric worker ID must use `worker="all"` for
totals and the bounded coordinator snapshot for active identity diagnostics.

`pairofcleats_worker_gc_pressure_ratio` likewise uses `worker="all"`: it is the
latest pool/stage pressure observation, not a cumulative total or an individual
worker heap measurement. The coordinator currently measures a parent-process
heap-utilization/aggregate-RSS proxy; existing unavailable worker-local fields
remain unavailable. Stage pressure and lifetime task totals keep separate meaning.
No raw worker identity is inspected or retained in either Prometheus family.
Existing allowlists bound histogram families to 4 pools × 3 tasks × 3 statuses,
and pressure gauge families to 4 pools × 5 stages, regardless of worker churn.
Each histogram family retains the unchanged 15 exported bucket/sum/count samples.

Coordinator GC, runtime and in-progress diagnostic maps retain at most 256
worker identities each, scoped to the current pool. Additional active identities
may lack a diagnostic row; totals still include their completed tasks. Exit
prunes the original ID independently of success/failure status and crash logging.
Pool replacement clears identity snapshots, while keeping completed task counts,
worker wall time and parent pressure sample totals. Available live thread
inventory also prunes missed exit subscriptions before snapshots and when a map
reaches its cap. Old-pool messages/exit callbacks cannot retire replacement
identities. Diagnostics are observational, not a task-dispatch or release receipt.

Authored controls use the actual registry/Prometheus encoder across 2,048
synthetic generations, assert unchanged exported series count, exact count/sum
and bounded serialized size growth, and preserve the latest gauge value. Actual
coordinator/event controls cover retirement with crash logging disabled, caps,
inventory pruning, replacement and stale callbacks without starting workers.
They have not run. Before/after allocation/export-size receipts and real Node26
worker/process/native/throughput qualification remain outstanding; no measured
RAM saving or production speedup is claimed. No new configuration knob, metric
reset, optional backend workaround or task retry is introduced.
