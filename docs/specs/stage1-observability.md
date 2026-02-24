# Stage1 Observability Spec

## Purpose
Define required telemetry for diagnosing throughput, ordering, memory pressure, and invariant health.

## Required Counters
- `stage1.files_processed_total`
- `stage1.lines_processed_total`
- `stage1.bytes_processed_total`
- `stage1.terminal_total{outcome}`
- `stage1.retry_total{class}`
- `stage1.invariant_violation_total{type}`

## Required Gauges
- `stage1.next_commit_seq`
- `stage1.max_seen_seq`
- `stage1.commit_lag`
- `stage1.terminal_lag`
- `stage1.buffered_bytes_global`
- `stage1.buffered_bytes_window`
- `stage1.active_windows`
- `stage1.in_flight`

## Required Timers/Histograms
- `stage1.dispatch_wait_ms`
- `stage1.compute_latency_ms`
- `stage1.commit_latency_ms`
- `stage1.commit_batch_size`
- `stage1.cancel_drain_ms`

## Required Snapshot Events
- `stage1.window_snapshot`
- `stage1.backpressure_transition`
- `stage1.retry_decision`
- `stage1.invariant_failure_snapshot`

## Event Fields
Every event includes:
- `runId`
- `stage`
- `timestampMs`
- `windowId` when applicable
- `seq` when applicable

## Acceptance
Compliant implementation shows:
1. Commit lag and buffer pressure are always observable.
2. Invariant failures include enough context for root cause.
3. Telemetry supports throughput and tail-latency analysis.
