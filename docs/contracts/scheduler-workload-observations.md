# Scheduler workload observations

The scheduler emits observation version 1 in `stats().workloadObservations`. Autotune profile version 4 accepts only this workload evidence. Earlier profile versions are rejected and regenerated from a qualifying run; there is no final-snapshot adapter.

## Collection and scope

One scheduler run has a unique run ID and the accepted resource-policy identity. The pipeline supplies the build ID, mode, stage and monotonically increasing stage epoch through the existing telemetry owner. A run retains at most 64 phase aggregates. Scope overlap while work remains active, a backwards clock, counter regression or phase overflow marks the receipt incomplete.

Resource transitions integrate CPU, I/O and memory token occupancy and capacity over active elapsed time. Active work includes retained reservations and suspended tasks until they actually retire. Drained idle time contributes no occupancy duration. Token occupancy is a logical reservation measure; it does not measure CPU busy time or device service latency.

Existing telemetry/stats admission scans also accumulate runnable demand, the first binding admission reason, sampled pending bytes and available signals. Sampling is bounded to once per 100 ms per phase and does not depend on optional queue-depth snapshots. Resource updates retain fixed numeric state, not task payloads, task histories or copied traces. Captured admission waits report the last diagnosed constraint, independently of service latency. Completion, failure, rejection and in-flight byte peaks remain explicit.

Host signal observations must be at most 10 seconds old, and each signal timestamp contributes at most once per phase. Unknown Windows host CPU load remains unavailable. A configured descriptor token cap is recorded as cap availability, never measured descriptor utilization. Invocation observations are omitted from checkpoint identity.

## Qualification and decisions

Finalization supplies an explicit completed outcome and exact build/mode scope. Terminal pending, running, retained bytes and used tokens must be zero as a safety check. Learning uses the retained phase observations, rather than those terminal zeros.

Qualification requires complete compatible observations, at least 1000 ms of active time, two resource intervals, four completed tasks and three demand samples. Failed, rejected, cancelled, partially observed, fully reused, empty or too-short work produces an explicit insufficient-evidence/no-change result. Such a result does not replace a qualified profile.

A CPU recommendation requires sustained token occupancy of at least 0.8 and three distinct signal samples showing CPU-token admission demand together with known CPU and memory headroom. Its candidate maximum is one slot above observed mean capacity, bounded by the current accepted hard resource envelope and initial tokens. Explicit current controls retain precedence. I/O and memory maxima retain their accepted values: historical waits, queued bytes and cap availability alone do not justify increasing them. Each decision carries its reasons, coverage, work counts, span, byte peaks and resource identity.

A repeated observation is not written twice. Within one build, a different mode replaces a profile only when it has more active observation time; a tiny final prose mode cannot overwrite richer code evidence. Modes are not implicitly merged. Resource-policy identity and the existing seven-day expiry remain required when loading a profile.

## Acceptance

The current scheduler-profile fixture includes distinct drained trajectories through the real scheduler and production finalization handoff, scope/version/partial-work negatives, bounded aggregate state, explicit-control precedence, resource limits and same-build mode selection. Runtime execution and representative serial performance qualification remain pending; implementation is not acceptance evidence.
