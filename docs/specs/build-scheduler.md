# Build Scheduler Spec

## Goals
- Provide a single scheduler that caps CPU, IO, and memory usage across Stage1, Stage2, Stage4, and embeddings.
- Prevent starvation and uncontrolled backlog growth.
- Provide deterministic, observable scheduling decisions for debugging and benchmarks.
- Allow a low-overhead bypass for small repos.

## Non-goals
- GPU scheduling.
- Distributed scheduling across machines.
- Preempting running work units (no task suspension).

## Scope
Applies to indexing pipeline stages and embeddings runner. The scheduler owns admission control, concurrency caps, and queue fairness. It does not alter stage semantics or outputs.

## Definitions
- Work unit: A single scheduled operation (file process, relations batch, sqlite load chunk, embeddings batch).
- Token: A unit of resource capacity (CPU, IO, memory) reserved by a work unit.
- Queue: A logical group of work units with shared priority and fairness.
- Scheduler: The component that grants tokens and orders work.

## Resource Model
### CPU tokens
- Represent active compute work.
- Default size: min(available cores, configured cap).

### IO tokens
- Represent concurrent IO operations (reads/writes).
- Default size: configured cap (threadpool aware).

### Memory tokens
- Represent estimated heap usage for a work unit.
- Work units declare a memory budget category (small, medium, large).

## Backpressure Algorithm
- A work unit requests tokens for CPU, IO, and memory as declared.
- If any token pool is exhausted, the work unit remains queued.
- Fairness uses weighted round-robin across queues.
- Starvation prevention: if a queue has waited longer than a threshold, it receives a priority boost.

## Scheduler API
- schedule(queueName, tokens, fn): submit work unit.
- configure(limits): update token pool sizes.
- stats(): return queue sizes, token usage, and wait times.
- shutdown(): stop accepting new work and drain queues.

## Queue Classes
- stage1.files
- stage1.postings
- stage2.relations
- stage4.sqlite
- embeddings.compute
- embeddings.io

Queues are prioritized in the order above, with fairness within each priority tier.

## Config Schema
- scheduler.enabled: boolean (default true for large repos).
- scheduler.cpuTokens: integer.
- scheduler.ioTokens: integer.
- scheduler.memoryTokens: integer.
- scheduler.lowResourceMode: boolean (force bypass below thresholds).
- scheduler.starvationMs: integer.

### Config precedence
1) CLI flags
2) Env vars
3) Config file
4) Defaults

## Failure and Abort Semantics
- If a work unit throws, the scheduler surfaces the error to the caller and marks the unit failed.
- Aborts propagate: queued units are cancelled and running units are allowed to finish.
- Retry is explicit: the caller may reschedule failed units.

## Telemetry
Required counters:
- scheduler.queueDepth.{queue}
- scheduler.tokens.inUse.{cpu,io,mem}
- scheduler.waitMs.{queue}
- scheduler.starvationBoosts

Required logs:
- queue admission
- starvation boost
- scheduler bypass activation

## Low Resource Mode
- Bypasses scheduler when file count and total bytes are below thresholds.
- Thresholds are defined in config.

## Examples
Pseudo-usage:
- schedule("stage1.files", {cpu:1, io:1, mem:"small"}, processFile)

## Breaking Changes
No backward compatibility requirements. Config keys are authoritative in this spec.
