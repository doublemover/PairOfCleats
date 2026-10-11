# Build Scheduler Spec

Status: Active v2.0  
Last updated: 2026-10-11T00:00:00Z

## Goals

- Provide a single scheduler that caps CPU, IO, and memory usage across indexing stages.
- Prevent starvation and long-tail stalls.
- Support adaptive scheduling by file/language cost.
- Provide deterministic scheduling telemetry.

## Non-goals

- GPU scheduling.
- Distributed/multi-host scheduling.
- Task preemption/suspension of running units.

## Scope

Scheduler owns admission control, concurrency caps, fairness, and backpressure behavior. It does not alter stage semantics.

## Work model

- Work unit: one schedulable operation.
- Resource tokens: `cpu`, `io`, `mem`.
- Cost class: `small`, `medium`, `large`, `xlarge`.
- Language cost class: per-language heavy/light categorization used for admission throttling.

## Queue and fairness policy

- Admission filters token, byte, adaptive-surface and write-backpressure limits.
- Among admissible queue candidates, score wait age plus queue weight and wait-p95 aging, less priority penalty.
- Starvation boost after `starvationMs` wait threshold.
- Scan past a blocked head entry for admissible work; deterministic queue order breaks equal scores.
- Cost-aware independent batch assignment is owned by the existing planners, not a CPU preemption or work-stealing mechanism.

## Memory-pressure policy

Scheduler tracks memory pressure states:

- `normal`
- `soft-pressure`
- `hard-pressure`

Required behavior:

1. Soft pressure reduces heavy-language concurrency.
2. Hard pressure blocks new heavy units and prioritizes completions.
3. Cache eviction uses deterministic order: largest-first, then oldest-first tie-break.

## Scheduler API

- `schedule(queueName, tokens, fn)`
- `configure(limits)`
- `stats()`
- `shutdown()`

## Config schema

`indexing.scheduler`:

- `enabled`
- `cpuTokens`
- `ioTokens`
- `memoryTokens`
- `starvationMs`
- `lowResourceMode`
- `languageCostClasses`
- `heavyLanguageMaxConcurrency`
- `memoryWatermarks.soft`
- `memoryWatermarks.hard`

## Env/CLI overrides

Env:

- `PAIROFCLEATS_SCHEDULER`
- `PAIROFCLEATS_SCHEDULER_CPU`
- `PAIROFCLEATS_SCHEDULER_IO`
- `PAIROFCLEATS_SCHEDULER_MEM`
- `PAIROFCLEATS_SCHEDULER_STARVATION_MS`

CLI:

- `--scheduler` / `--no-scheduler`
- `--scheduler-cpu`
- `--scheduler-io`
- `--scheduler-mem`
- `--scheduler-starvation`

Precedence:

1. CLI
2. Env
3. Config file
4. Defaults

## Telemetry

Required counters:

- queue depth by queue
- token usage by resource
- wait time by queue
- starvation boosts
- work-steal counts
- pressure state transitions
- heavy-language throttle activations

## Failure and abort semantics

- Work unit errors propagate to caller.
- Aborts cancel queued work; running work completes or exits by stage-specific cancellation policy.
- Scheduler shutdown drains queues deterministically.

## Compatibility policy

No legacy scheduler behavior is retained.

## Admission and active-work observations

Each queue snapshot and sampled scheduling trace includes `runnable`, `blocked`,
`blockedBy`, `oldestRunnableWaitMs`, and `oldestRunningMs`. Runnable means each
pending task fits the **same current capacity individually**, not that all fit
simultaneously. Blocked reasons partition pending tasks by their first binding
constraint: write backpressure, surface concurrency, CPU, IO, memory, queue bytes,
or global bytes. This is scheduler admission only; dependency-blocked work that
has not been submitted belongs to its planner/frontier owner.

`waitLatencyMs` and `runLatencyMs` reuse bounded histogram summaries (last 64
samples per queue). Missing samples are null. Run latency is admitted task wall
occupancy, including nested queue waits; it is not CPU service time. Current
running age is separate from completed-task latency. Counts are copied into
snapshots, and nested reason maps in traces are isolated from caller mutation.
Pending scans occur on stats and sampled telemetry captures; ordinary unsampled
enqueue paths do not add an observational scan.

The existing Stage1 watchdog and file progress renderer expose scheduler state,
oldest file substage/age, terminal input bytes/throughput, produced chunks, cached
files, skips and failures. Terminal input bytes include skips/failures; this is
input coverage rather than a predicted analysis-cost percentage. Chunk counts
include cache reuse. File ETA remains count-based. Existing crash-stage hooks
feed the live observer even when crash logging is disabled; observations cannot
throw into file processing. Outer scheduler queue wait remains separate from
file processing duration, which includes nested IO/embedding waits.

Worker-pool shutdown retains graceful draining. Expired drain waits explicitly
reach the existing Piscina destructor and bounded hard-thread termination owner.
The timeout result marks escalation and no longer reports pending cleanup after
successful force completion; failed termination propagates. Independent split
pool resources use the shared lifecycle registry so a sibling cleanup failure
cannot skip another owner. These controls do not guarantee cleanup after abrupt
OS termination or an uncatchable process crash.
