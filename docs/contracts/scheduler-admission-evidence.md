# Scheduler admission evidence

Adaptive surface control classifies requests using their existing normalized
CPU/I/O/memory token contract and the dispatcher's actual first binding admission
constraint. Retained bytes never imply I/O activity, and queue-name spelling
does not assign resource roles. Runnable and surface-blocked demand can support
a surface-concurrency increase; memory, CPU-token, fixed queue and file-window
blocks remain separately diagnosed.

Snapshots distinguish retained/running/suspended tasks and the exact live token
reservations held by each task lease, including CPU permit transfers. These are
resource occupancy observations, not measured CPU busy time or device utilization.
Existing memory/byte/FD constraints, write backpressure, starvation and nested
progress ownership remain unchanged.

Dispatch retains one last-observed binding reason per queued entry. A completed
I/O admission wait can contribute at most one sample to its queue's existing
64-sample bound. Control samples expire after ten seconds or a telemetry-stage
epoch change. Returning to a stage with the same name cannot revive an earlier
phase's sample. Sample age/availability and scope are explicit; the lifetime
generic wait histogram remains available separately for diagnostics. The sample
duration is the last observed binding interval, not a device latency measurement.

Current I/O-token or actual write-backpressure blockage is required before recent
I/O admission waits influence pressure. Inactive or unavailable I/O evidence
remains null. FD and I/O admission thresholds are tested independently; a lower
FD threshold cannot silently lower the I/O threshold or mislabel an I/O-driven
decision as FD pressure. Decision receipts retain binding reasons, sample
availability, retained/suspended tasks and live resource reservations.

Pending requests are inspected at bounded adaptive sampling or explicit snapshot
boundaries, not on every enqueue. Existing dispatch scans record their binding
reason without an additional scan or unbounded task history. This implementation
has lint/syntax review; behavioral/controller and representative workload
qualification remains deferred with #1624. The separate run-observation/autotune
receipt work in #1625 is not supplied by a final drained snapshot.
