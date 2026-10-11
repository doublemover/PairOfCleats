# Architecture contract handoff audit, 2026-10-11

## Scope and provenance

Independent repairs on campaign base `91b3c48968d3453d051bd41e23a70d98eca4f697`,
using an isolated Linux checkout, Node 26.8.1, copied prepared dependencies and a
fresh successful native/patch verification receipt. No live index, user computer,
cache migration, dependency change, full corpus run, push or merge was performed.

This audit reconciles the earlier [orchestration checkpoint](orchestration-checkpoint-2026-10-11.md)
and [Stage1 admission/config checkpoint](stage1-concurrency-2026-10-11.md) against
current callers. The earlier report included implemented repairs, not merely an
architecture description. The shallow source checkout does not reconstruct those
four original commits individually; their implementation is present in the
specified campaign tree. The tests and call paths below establish current coverage.

## Earlier findings reconciled

| Earlier finding or architectural owner | Current call path and disposition |
| --- | --- |
| Import prescan, reuse and staged orchestration already exist | `indexer/pipeline/orchestrator.js` still loads incremental work, invokes `preScanImports`, processes files, postscans and overlaps inference/postings before publication. Retained; no second orchestrator introduced. |
| Cost/byte windows and cost-balanced shards already exist | `process-files.js` uses the contiguous-window planner and shared shard assignment. Retained. New resolver-to-consumer tests found and repair default/cap corruption at their boundaries, detailed below. |
| Warm-pool lanes dropped planned parse cost | The earlier repair is present: finalized group cost enters `plan.groupMeta`, `prepareTreeSitterSchedulerTasks` passes it into `buildWarmPoolTasks`, which uses shared `planWeightedBatches`. The extended cost-balance fixture now traverses group artifacts through production runner preparation and verifies exact coverage, 202/202 predicted lane costs and the unchanged explicit 45-second task timeout. Unknown cost retains count-based fallback. |
| Admission blockers and bounded scheduler timing were invisible | Existing dispatch predicates still feed `scheduler-core-stats`, telemetry snapshots and Stage1 stall summaries. Existing regression exercises CPU, IO, memory, queue/global bytes, surface and write-backpressure reasons with actual scheduler tasks, bounded histories and cancellation. Retained. Semantic analysis was found to evade this configured lane and is repaired below. |
| Per-file substages and weighted terminal progress were missing | Existing crash-stage updater forwards `onStage` independently of crash logging; `process-files.js` records it on in-flight entries. Existing actual file-processor fixture, heartbeat and weighted-progress deduplication fixtures pass. Retained; workload bytes remain terminal input weights, not an analysis-cost or memory estimate. |
| Graceful cleanup could abandon stuck Piscina workers | Existing graceful deadline reaches `forceDestroy` and the shared Piscina termination owner; serialized shutdown and split-pool sibling cleanup remain present and tested. Two further caller gaps, partial initialization and pre-worker pressure waiters, are now repaired below. |
| Stage1 fixed-eight controls were rejected by schema | Current schema and resolver support the existing three parse bounds. The real scheduler/runtime/ordered-commit regression still admits eight, enforces a stricter byte cap and cancels queued work. No admission or timeout increase was introduced. Runtime queue registration was separately overwriting explicit pending limits; repaired below. |
| Durable dependency-aware semantic scheduling and publication already exist | Frontier leases, closure verification, whole-generation publication and recovery remain owned by existing modules. Their admission/lifecycle/publication tests now use the actual build scheduler rather than a stub that repeated the wrong queue name. |
| Historical scattered cache roots | The reported Windows storage screenshot is not proof of a current source defect. Runtime repo roots come from `getRepoCacheRoot`; Tree-sitter defaults live below that root; cross-file inference receives `runtime.repoCacheRoot`; embeddings delegates to the shared layout resolver. Bounded cache/root contract fixtures were selected. No Windows location or retained-cache inventory was inspected or modified. |

## Verified defects and repairs

### 1. Stage1 defaults and explicit caps

`resolveStage1Queues` emits null for absent optional settings. Downstream numeric
coercion treated that null as zero, causing three changes in a normal default run:

- Postings `maxHeapFraction` became explicit zero, disabling the queue's normal
  0.8 heap-pressure guard.
- Ordered append resumed only after draining to 10% instead of its 70% default.
- The adaptive window's CPU-scaled soft commit-lag threshold became zero, so
  ordinary one-file lag could shrink the cost window.

The handoff now preserves unset values while retaining valid explicit zeros and
custom fractions. Explicit postings row/byte caps also bypass automatic sizing:
previously 2 rows/1 KiB became 300 rows/12 MiB, and a high-memory scale could enlarge
larger explicit caps. Automatic budgets still scale normally. An unlimited
upstream CPU queue now uses the shared scheduler normalizer instead of producing a
one-item postings cap from zero.

Commits: `c8060d1`, `cca82a3`.
Regression: `indexing/runtime/stage1-admission-config-handoff`, plus the existing
zero-disable, normalization and postings contract tests. Coverage includes omitted,
null, explicit zero/custom values, high-memory scaling, actual row/byte admission,
cancellation/accounting release, single oversized payload and real window planning.

### 2. Semantic work bypassed its configured scheduler lane

Compiler batches, frontier draining and compiler capacity checks used the literal
`relations`. Production configuration defines `stage2.relations`, mapped to the
inference surface with its own priority, weight, caps and write backpressure.
Creating a lookalike lane bypassed those controls and split telemetry. The previous
fixture duplicated the wrong literal, hiding the integration defect.

All three consumers now use `SCHEDULER_QUEUE_NAMES.stage2Relations`. The binding
fixture now creates the real configured build scheduler and closes it during
cleanup. New production-path tests set byte caps on that lane and prove compiler
work stays pending without calling its handler or consuming a completion receipt.
The existing successful path asserts the actual inference surface, priority and
started counter, and asserts that no `relations` lane was created.

Commit: `f411380`.
Regressions: `compiler-scheduler-cap-handoff`, `compiler-admission`,
`binding-work-admission`, `binding-work-lifecycle`,
`binding-work-publication-recovery` and `frontier-drain` under `indexing/semantic`.
No producer facts, producer identity or semantic format changed; no analysis
version bump or cache invalidation is required for this scheduling repair.

### 3. Runtime queue adapters overwrote explicit scheduler limits

The production resolver accepted `stage1.io.maxPending=2`, but runtime adapter
construction replaced it with the computed default 48. The runtime now passes
its resolved queue configuration to the shared adapter. Scheduler limits remain
owned by that configuration, while the producer's independent working-set window
is intersected with a finite scheduler cap. Explicit scheduler zero remains
unlimited without removing the producer's own byte/count backpressure.

The adapter also now forwards explicit zero byte/count limits during registration;
previously it omitted them and left an already registered cap in place. It reuses
the canonical scheduler normalizers and exposes normalized effective producer
limits instead of independently coercing nullable values.

Commit: `7d26200`.
Regression: `indexing/runtime/scheduler-queue-cap-handoff` covers CPU, IO,
embedding and subprocess adapters through real resolver/scheduler/consumer paths;
finite/zero/unset limits, actual completion and zero cap rejections are checked.
The zero-limits adapter regression now starts with pre-existing limits rather than
only a fresh queue. Existing nested-queue deadlock and fixed-eight tests still pass.

### 4. Worker ownership ended before cleanup finished

If initialization failed after Piscina creation, the single-pool catch returned
null and leaked the acquired workers. Injecting an initial metrics-read failure
on the base tree returned null with one live thread. Failed initialization now
uses the existing lifecycle destructor; cleanup failure is propagated with the
original initialization error rather than hidden behind a null fallback.

Separately, pressure-throttled tasks wait before entering Piscina. Destroying
physical threads and merely waking those waiters did not stop their admission
loop. Under sustained pressure they kept polling, with active task counters and
promises left open. The existing queue now has an idempotent close operation;
pool destruction closes admission, settles all language waiters and clears its
metadata cache. Expected closure does not schedule a replacement worker. The same
close is applied when a task error permanently disables its pool; otherwise a blocked peer could
prevent the lifecycle's own idle shutdown before any explicit destroy call.

Commits: `d7780d9`, `248ff4c`.
Regressions: `worker-pool-initialization-cleanup` and
`worker-pool-throttle-shutdown` under `indexing/workers`, using actual Piscina
acquisition and physical thread counts. They cover split-pool fallback, cleanup
failure evidence, multiple blocked languages, repeated close and no restart.
Existing graceful/forced/racing cleanup fixtures remain applicable.

## Parallel embedding review

The separate embedding fix `11c767ad112784bea47e285144ca955f5a65ce9b` was reviewed
without modifying its checkout. Its canonical pending-limit normalizer,
length-aware grouped batching, index-based result scatter and scheduled-work
counter repair fit the existing owners. Cached/deduplicated/coalesced work reduces
owned remaining compute cost; failed files do not get marked complete.

The review reported two additional concrete handoffs to that change's owner:
a cooldown could temporarily ignore a newly tightened writer cap, and absent FD
telemetry could become a one-file cap while later FD reductions below the initial
file concurrency were ignored. Their follow-up commits and test receipts are
separate from this audit branch and must be included when assembling the batch.
Existing single-provider dispatch and cache-writer serialization were retained.

## Validation and limits

The five new regression files were run against exact base modules using read-only
Node module hooks, with unchanged new assertions. All five fail for the intended
bugs: default heap guard disabled, explicit queue cap overwritten, out-of-budget
compiler started, acquired worker leaked, and throttled tasks left unsettled.
These expected baseline failures are evidence of test sensitivity, not acceptance.
All five pass on repaired source.

Historical author-workspace receipts:

- `.testLogs/run-1791757140177-nu34ei`: two expected baseline cleanup failures.
- `.testLogs/run-1791757153441-3kdqdz`: three expected baseline handoff failures.
- `.testLogs/run-1791756478156-prz2np`: 7/7 initial Stage1/queue regressions.
- `.testLogs/run-1791756725376-s7u640`: 6/6 semantic admission/lifecycle/publication.
- `.testLogs/run-1791756863421-rzyfbt`: 7/7 adapter, fixed-eight and nested-queue regressions.
- `.testLogs/run-1791756968821-3kky9q`: 7/7 cleanup regressions.
- `.testLogs/run-1791757107027-ztapba`: 4/4 final shutdown and Stage1 follow-ups.

Final focused reconciliation: 48/48 passed in
`.testLogs/run-1791757268149-4qj9t8` (33.9 seconds total, slowest 9.77 seconds).
Format, config budget and environment checks passed. Generated freshness initially
failed because the added roadmap summary exceeded its 20,000-byte CRLF limit; the
summary was shortened, retaining the audit link. Freshness, command surface,
workflow contract and all 39 gate fixtures then passed
(`.testLogs/run-1791757438110-rnpsr7`, 26.5 seconds total).

A final permanent-disable extension passed its three affected real-pool fixtures
(`.testLogs/run-1791757496328-to5rln`). Its first new assertion incorrectly required
physical worker termination within one event-loop turn; the fixture now awaits
the actual cleanup promise with a one-second bound. No production deadline was
increased. The extension also fails against its pre-fix pool module with the
expected bounded timeout (`.testLogs/run-1791757508379-k8e6y9`).

The final Linux-applicable worker selection passed 17/17 without skips
(`.testLogs/run-1791757534696-emf0jq`, 3.39 seconds total). Windows-only fixtures
were excluded explicitly. Final-head formatting and generated freshness passed;
all 39 gate fixtures passed again (`.testLogs/run-1791757608489-1s6ljx`,
26.8 seconds total), as did `git diff --check`. Individual tests use 30-second
ceilings, zero retries and native-status redo disabled. No synthetic planning result is a corpus throughput claim. Windows
process-tree behavior, full-index wall time/RSS, hardware/provider concurrency and
representative artifact equivalence remain unmeasured; the historical Windows
stall's root cause is not inferred from these source defects.
