# Orchestration and cleanup checkpoint, 2026-10-11

## Scope and provenance

Implemented against clean local campaign head
`8076e8851dc1b87153958eea5f2ce3012d156cf9` on
`codex/semantic-resume-campaign-20261010`, after reconciling four commits beyond
the remotely available `d468621da9b72f5212b83689ce2ca54355a108a4`.
The source handoff and Git bundle were integrity checked. Work used an independent
Linux cloud checkout, Node 26.11.1, verified native/patch readiness, and bounded
fixtures. The user's Windows run used Node 26.8.1. No index restart or cache
invalidation was performed. No corpus throughput acceptance is implied.

## Existing architecture retained

- `indexer/pipeline/orchestrator.js` sequences discovery, incremental reuse,
  import prescan, file processing, postscan, semantic inference/postings overlap,
  and artifact publication.
- Stage1 already uses cost/byte sequence windows, cost-balanced shards, bounded
  out-of-order append/replay, byte backpressure and adaptive queue surfaces.
- The shared scheduler owns CPU/IO/memory tokens, queue/global byte limits,
  priority/weight/wait aging and write-tail backpressure. Nested IO and embedding
  admission has explicit deadlock guards; a whole-file CPU task can remain active
  while awaiting nested work. A running-task count is not CPU utilization.
- Tree-sitter already plans grammar waves using size and historical parse cost,
  isolates subprocesses, bounds warm pools and exposes lookup/cache leases.
- Semantic planning already owns dependency closure, batching, durable frontier
  leases/recovery and provider-specific LSP scope/request budgets. Chunking,
  tokenization and embeddings already have separate handoff/backpressure owners.
- Existing progress bars, structured logging, crash-stage trace hooks, bounded
  histograms, lifecycle registry, cleanup deadlines and Piscina termination were
  extended or reused. No second orchestration/cleanup framework was introduced.

## Implemented corrections

1. Carry planned parse cost into independent warm-pool lane assignment. The
   existing shard balancer was lifted into a shared helper; the shard
   API remains an alias. Generic falsy items retain exact coverage. Restore canonical per-lane order and retain old count
   assignment if any cost is unknown. The skew fixture's lane loads change from
   400/4 to 202/202 predicted units (49.5% lower maximum load). This is a synthetic
   planning result, not an SSR wall-clock speedup.
2. Explain scheduler admission using its actual predicate: ready versus blocked,
   first binding resource reason, oldest ready/running age, bounded wait/run
   latency summaries and actual/configured surface concurrency. Copy these into
   existing telemetry and watchdog summaries. No admission-policy change.
3. Feed existing per-file trace stages into bounded in-flight metadata without
   requiring crash logging. Oldest-file diagnostics now identify the observed
   substage and age. Existing file progress also reports terminal input MiB/rate,
   chunks, cache reuse, skips and failures without double-counting replay entries.
4. Repair an existing cleanup integration gap: graceful lifecycle destruction
   could wait forever on active counters while its caller timed out before ever
   reaching the existing Piscina destructor. Expired drain now explicitly reaches
   that owner, including its existing hard-thread fallback. Concurrent detached
   pool shutdown callers await the same completion. Split pools use the existing
   lifecycle registry so one failure does not bypass remaining owners; partially
   initialized groups clean acquired resources. Failures remain observable.

## Captured Windows evidence and limits

The historical stderr capture ends at 04:24:47 UTC, 5393/8249 files, with no exit
receipt. Its last watchdog reports 34 files in flight, 32 CPU tasks, IO 16 running
and 14 pending, and 13 ordered completions pending. Those are an admission
snapshot, not a root-cause attribution. Embeddings were disabled. The capture's
20-second messages are slow-file warnings; no `FILE_PROCESS_TIMEOUT` was found.
Source distinguishes those warnings from the hard file deadline (default 360 s
before workload scaling) and from nested provider deadlines. No deadline was
raised by this work.

A later bounded process inventory found no surviving index worker; all inspected
Node processes belonged to other workloads. Exit reason remains unknown. System
memory observations do not identify indexing as the owner. The old log lacks the
live substages and queue/service measurements added here, so physics-specific
slowdown, scheduler starvation, LSP delay and any memory attribution remain
unconfirmed. Earlier preflight recommendations differ from actual startup
concurrency; actual runtime counters are the reference.

Today's watchdog-recovery change correctly routes timer failures through stage
abort/replay cleanup and is preserved. Today's semantic worker-named modules are
analysis modules, not proof of newly spawned processes. The drain bypass repaired
here predates those changes. Abrupt external process termination remains outside
in-process cleanup guarantees.

## Validation and remaining qualification

Focused regressions cover exact/deterministic warm-pool coverage, missing-cost
fallback, shared shard compatibility, every scheduler admission blocker, bounded
histories, observer isolation, real file-processing hooks, weighted-progress
deduplication, graceful/forced cleanup races and failure propagation. A real
Piscina task deliberately hangs: deadline escalation rejects the task and leaves
zero worker threads. Real split pools verify sibling cleanup despite failure.
Existing adaptive planner, native plan/determinism, stage contract, nested IO /
embedding deadlock, scheduler fairness and watchdog-recovery fixtures also pass.

Author-workspace test receipts and final gate outcomes are supplied with the
handoff artifact; these historical paths are not promised in a clean checkout.
Full Windows indexing, representative heavy-tail corpus wall time, output
artifact equivalence on that corpus, LSP provider timing and memory attribution
remain qualification work. Use the added observations on the next separately
authorized run before changing queue ownership, multipass structure or deadlines.

A bounded scheduler-overhead comparison loaded the six changed scheduler modules
from exact base 8076e885 using read-only Node module hooks. With a fixed clock,
1 held task and 7 batches of 100 stats calls, median baseline/current milliseconds
per call were 0.0134/0.0167 (0 pending), 0.0105/0.0176 (100), 0.0077/0.0557
(1000), and 0.0089/0.2189 (5000). Enqueuing 1000 blocked tasks measured
21.0/20.8 ms median, indistinguishable within observed variation. The pending
snapshot scan has measurable linear cost; this synthetic check does not measure
full indexing throughput, allocation or adaptive-controller sampling overhead.

An existing wall-clock wait-aging fixture failed on both changed and exact-base
scheduler modules. Its prewarm measured task sleep, not queue wait, often leaving
wait p95 at zero; its total wait also barely covered the priority penalty. The
fixture now seeds a real 1 ms virtual queue wait and advances a controlled clock
to assert aging defeats priority before the starvation threshold. Scheduling
policy was not changed to make the test pass.

Final bounded validation receipts (historical author workspace):

- `.testLogs/run-1791699501592-i89r57`: 41/41 affected scheduler, pool, progress,
  stage-observer, warm-pool and shared-balancer fixtures; no retries/timeouts/skips.
- `.testLogs/run-1791699280642-x5ljqi`: 10/10 planner, native determinism,
  watchdog recovery, nested embedding and fairness fixtures (one overlaps above).
- `.testLogs/run-1791699425280-gee3zm`: 6/6 cleanup, deterministic aging and
  documentation/link fixtures following the fixture correction.
- `.testLogs/run-1791699483451-igoaew`: 39/39 gate fixtures; all preceding
  front-gate commands passed: format, config budget, environment usage,
  generated freshness, command surface and workflow contract. No skipped tests.
- Final shared-number-coercion reuse and falsy-item coverage received a targeted
  progress/balancer rerun; final format and diff whitespace checks passed.

The earlier affected batch had 38 passes and two failures: the old aging fixture
above, and a new observer assertion that expected semantic work from a fixture
with semantic capture disabled. The latter now verifies the real CPU chunking
stage; no production change was needed for that assertion. Failed receipts are
retained in the handoff instead of being counted as acceptance.
