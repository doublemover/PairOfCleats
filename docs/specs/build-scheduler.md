# Build Scheduler Spec

Status: Active v2.0  
Last updated: 2026-02-20T00:00:00Z

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

- Weighted round-robin across queue classes.
- Starvation boost after `starvationMs` wait threshold.
- Short-job bias: scheduler may prefer ready short units to reduce tail latency.
- Work-stealing: idle workers may steal from overloaded queues under deterministic tie-break rules.

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
