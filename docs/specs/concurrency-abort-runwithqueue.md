# Spec: Concurrency, Cancellation, and `runWithQueue` Semantics (Phase 4.2-4.4 + 4.3)

Status: Draft (implementation-ready)

This document defines:
1. **Thread limit resolution v2** (correct precedence + threadpool-aware IO caps).
2. **Queue lane construction** (IO/CPU/embedding/[proc] concurrency + backpressure).
3. **`runWithQueue` contract v2** (fail-fast + best-effort + abort-signal support).
4. **AbortSignal propagation requirements** for long-running indexing workflows.

---

## 1. Design goals

### 1.1 Correctness
* CLI flags must take precedence over environment/config defaults.
* IO concurrency must not implicitly assume a large libuv threadpool when `UV_THREADPOOL_SIZE` is small.
* No unhandled rejections, even on partial failure, early abort, or signal cancellation.

### 1.2 Determinism and operational safety
* Default behavior must be safe on machines with high CPU counts but default threadpool settings.
* Backpressure must prevent runaway buffering or memory spikes.
* Abort must stop scheduling new work and cleanly tear down subprocesses and streams.

### 1.3 Compatibility and incremental change
* Prefer evolving existing implementations (threads.js, concurrency.js) rather than replacing them wholesale, unless necessary.

---

## 2. Thread limit resolution v2

### 2.1 Existing entry points (must be updated coherently)
The following call sites currently derive thread limits and/or queues:

* `src/shared/threads.js: resolveThreadLimits()`
* `src/index/build/runtime/workers.js: resolveThreadLimitsConfig()`
* `src/index/build/indexer/steps/process-files/runtime.js: createShardRuntime()`
* `tools/build/sqlite/run.js`

**Requirement:** after Phase 4.2, all of these must:
* share the same resolution rules
* honor IO caps based on effective uv threadpool size
* never bypass the computed `ioConcurrency` when creating IO queues

---

## 3. Precedence rules (threads and concurrency)

### 3.1 Inputs
Thread limits are derived from these sources:

1. **CLI**: `--threads` (and any future lane-specific flags, if added)
2. **Config**: `userConfig.threads` and/or `userConfig.indexing.concurrency.*`
3. **Auto policy**: computed `autoPolicy.indexing.concurrency.*`
4. **PairOfCleats env**: `PAIROFCLEATS_THREADS` (optional; if supported)
5. **Defaults**: based on CPU count and platform caps

### 3.2 Required precedence order (best-version choice)
**Chosen order (highest to lowest):**
1. CLI (`argv.threads`)
2. Config (`configThreads`)
3. Env (`envThreads`)
4. Default

**Why this is best:**  
* CLI is explicit and must win.  
* Config is user intent and should beat ephemeral env.  
* Env can be used in CI but should not override an explicit config file setting unless explicitly designed to do so.

**Change required:** `src/shared/threads.js` currently gives env higher precedence than CLI; fix it.

---

## 4. Threadpool-aware IO cap

### 4.1 Background
Node's file IO uses the libuv threadpool. If `UV_THREADPOOL_SIZE` is 4 (default), allowing IO concurrency 64 often adds memory pressure without increasing true IO parallelism.

### 4.2 IO cap formula
Define:

* `uv = effectiveUvThreadpoolSize` (from RuntimeEnvelope effective value)
* `ioPlatformCap = 64` (existing platform cap; keep)
* `ioMemoryCap` (based on total system memory):
  * `<16 GiB` → `16`
  * `16–32 GiB` → `32`
  * `>=32 GiB` → `64`
* `ioDefaultCap = min(ioPlatformCap, max(1, uv * 4), ioMemoryCap)`

Rationale:
* `uv * 4` keeps the threadpool busy even if some tasks are momentarily blocked.
* platform cap prevents pathological sizes.

### 4.3 Oversubscribe escape hatch
Add `runtime.ioOversubscribe` (boolean, default false).

Behavior:
* If `ioOversubscribe=false`:
  * clamp `fileConcurrency`, `importConcurrency`, and `ioConcurrency` to `ioDefaultCap`
* If `ioOversubscribe=true`:
  * allow `fileConcurrency/importConcurrency` up to `maxConcurrencyCap` (existing), and allow `ioConcurrency` up to `ioPlatformCap`

### 4.4 Derivation of lane values
Given:
* `threads` (resolved from precedence)
* `maxConcurrencyCap` (from config/auto policy, existing)
* `embeddingConcurrency` (existing logic: min(threads, cap) or policy-defined)

Compute:
* `fileConcurrency = clamp(threads, 1, maxConcurrencyCap)`
* `importConcurrency = clamp(threads, 1, maxConcurrencyCap)` (or separate if separate config exists)
* `cpuConcurrency = fileConcurrency` (existing semantics)
* `ioConcurrency = min(ioPlatformCap, max(fileConcurrency, importConcurrency))` **then** clamp to `ioDefaultCap` unless oversubscribe

**Important:** This is the point where the current system must change: `createShardRuntime` must not recompute IO independently. It must use the computed `ioConcurrency`.

---

## 5. Queue lane construction

### 5.1 Existing lanes
`src/shared/concurrency.js:createTaskQueues()` currently builds:
* `io`
* `cpu`
* `embedding`

Each queue has:
* `concurrency`
* `maxPending` (stored as `queue.maxPending` for `runWithQueue`)

### 5.2 Pending limit policy (retain, but make explicit)
Pending limits must prevent unbounded scheduling and buffering.

Policy:
* `maxIoPending = max(8, ioConcurrency * 4)`
* `maxCpuPending = max(16, cpuConcurrency * 4)`
* `maxEmbeddingPending = max(16, embeddingConcurrency * 4)`

Note: current code uses *2 for max pending. Increasing to *4 reduces head-of-line blocking for mixed workloads, but must be evaluated. If changing, add tests to assert backpressure behavior.

### 5.3 Optional proc lane
If Phase 4.9 introduces `spawnSubprocess` heavily used during indexing, add:
* `procConcurrency = clamp( min(4, cpuCount), 1, 8 )`
* `maxProcPending = procConcurrency * 4`

This lane prevents subprocess orchestration from being blocked by FS-heavy IO lane saturation (especially if subprocess spawning is currently placed on IO lane via shared helper).

**If proc lane is not implemented in Phase 4**, ensure `spawnSubprocess` does not reuse the IO lane by default.

### 5.4 Build scheduler config (Phase 16.1)
Scheduler configuration is read from config/env/CLI and surfaces in the build runtime. All values live under `indexing.scheduler` in config.

Config keys:
* `indexing.scheduler.enabled`
* `indexing.scheduler.cpuTokens`
* `indexing.scheduler.ioTokens`
* `indexing.scheduler.memoryTokens`
* `indexing.scheduler.lowResourceMode`
* `indexing.scheduler.starvationMs`
* `indexing.scheduler.queues.{queue}.priority`
* `indexing.scheduler.queues.{queue}.maxPending`

Env overrides:
* `PAIROFCLEATS_SCHEDULER`
* `PAIROFCLEATS_SCHEDULER_CPU`
* `PAIROFCLEATS_SCHEDULER_IO`
* `PAIROFCLEATS_SCHEDULER_MEM`
* `PAIROFCLEATS_SCHEDULER_LOW_RESOURCE`
* `PAIROFCLEATS_SCHEDULER_STARVATION_MS`

CLI overrides:
* `--scheduler` / `--no-scheduler`
* `--scheduler-cpu`
* `--scheduler-io`
* `--scheduler-mem`
* `--scheduler-low-resource` / `--no-scheduler-low-resource`
* `--scheduler-starvation`

### 5.5 Scheduler queue adapters (Phase 16.1.2)
When the build scheduler is enabled, Stage1/2/4 wiring uses **scheduler queue adapters**
instead of per-stage PQueue instances. These adapters expose the `add/onIdle/clear` surface
expected by `runWithQueue`, but schedule work via the scheduler token pools.

Required mappings:
* Stage1 file processing → `stage1.files` queue (CPU/IO tokens as needed)
* Stage1 postings → `stage1.postings` queue (CPU tokens)
* Stage2 relations/cross-file → `stage2.relations` queue (CPU tokens)
* Stage4 sqlite builds → `stage4.sqlite` queue (CPU+IO tokens)
* Embeddings runner → `embeddings.compute` (CPU tokens for embed batches) and
  `embeddings.io` (IO tokens for cache/artifact reads and writes). The embeddings
  pipeline must process one file at a time (no cross-file batching) to keep
  memory bounded and make scheduler backpressure effective.

Fallback:
* If the scheduler is disabled or in low-resource bypass mode, runtime queues
  must fall back to PQueue-based concurrency to preserve existing caps.

---

## 6. `runWithQueue` contract v2 (Phase 4.3)

### 6.1 Current behavior (baseline)
`src/shared/concurrency.js: runWithQueue()` already provides:
* fail-fast semantics (stops scheduling new work after first failure)
* pending backpressure
* no unhandled rejection hazards

### 6.2 Required additions
Add to `runWithQueue(queue, items, worker, options)`:

Options:
* `bestEffort?: boolean` (default false)
* `onError?: (error, ctx) => void | Promise<void>`
* `signal?: AbortSignal` (optional)
* `abortError?: Error` (optional; default to standardized AbortError)
* `retries?: number` (existing)
* `backoffMs?: number` (existing)

Context passed to callbacks:
```ts
interface RunCtx {
  index: number;
  item: any;
  signal?: AbortSignal;
}
```

Behavior:
* `worker(item, ctx)` -- existing workers ignoring extra args remain compatible.
* If `bestEffort=false`:
  * first failure sets abort flag, clears queue, stops scheduling new work
  * wait for in-flight tasks to settle
  * throw the first error
* If `bestEffort=true`:
  * do not abort on error
  * schedule all items
  * collect errors
  * after completion, throw `AggregateError(errors)` if any occurred

AbortSignal:
* If `signal.aborted` before scheduling an item:
  * stop scheduling, clear queue
* In the worker wrapper:
  * call `throwIfAborted(signal)` before invoking worker
* After draining in-flight tasks:
  * if aborted, throw AbortError (unless bestEffort semantics explicitly override, which they should not)

Callbacks:
* `onResult` is only called for successful items.
* `onError` is called at most once per failing item.
* Errors thrown by `onResult` or `onError` are treated as failures for that item.

### 6.3 Ordering guarantees
* Results array must preserve input order (existing behavior).
* With `bestEffort=true`, results for failed items should be `undefined` (or remain unfilled), but errors must be included in the thrown `AggregateError`.
  * Explicitly document this behavior.

---

## 7. AbortSignal propagation (Phase 4.4)

### 7.1 Standard abort helpers
Create `src/shared/abort.js` exporting:
* `createAbortError(message?): Error` (name: "AbortError", code: "ABORT_ERR")
* `throwIfAborted(signal, message?)`
* `isAbortError(err): boolean`

### 7.2 Where to thread signals
All of the following must accept and use `AbortSignal`:

* Index pipeline orchestration:
  * `src/index/build/indexer/pipeline.js` (or whichever top-level orchestrator exists)
* File processing loops:
  * any `runWithQueue` invocation should pass `signal`
* Subprocess calls:
  * embeddings tool
  * indexer-service
* Watch mode:
  * already passes signals; must ensure deeper layers honor them

### 7.3 Abort semantics for artifact writers
On abort:
* never promote temp artifacts to final locations
* best-effort cleanup:
  * remove temp files when possible
  * close streams
  * kill subprocesses

This is largely already satisfied by temp+atomic replace patterns, but the key is to ensure code checks `throwIfAborted` before the "promote/replace" step.

---

## 8. Tests

### 8.1 Thread precedence
Create: `tests/shared/runtime/thread-limits-precedence-cli-over-env.test.js`

* Call `resolveThreadLimits()` with:
  * `argv.threads = 8`
  * `envConfig.threads = 4`
  * expect `threads === 8`

Also add:
* configThreads vs envThreads precedence tests (depends on desired semantics; chosen order is CLI > config > env > default).

### 8.2 IO cap clamping
Create: `tests/shared/concurrency/io-concurrency-cap-uv-threadpool.test.js`

* Use `resolveThreadLimits()` (or the new `resolveThreadLimitsV2`) with:
  * cpuCount = 64
  * uvThreadpoolSize = 4 (effective)
  * threads requested = 64
  * expect `ioConcurrency <= 16` (uv*4 cap)
  * expect `fileConcurrency/importConcurrency <= 16` unless oversubscribe

Add oversubscribe case:
* with ioOversubscribe true, expect `fileConcurrency` can be 64 and `ioConcurrency` up to platform cap.

### 8.3 createShardRuntime uses computed IO
Create: `tests/indexing/shards/shard-runtime-uses-threadlimits-io.test.js`
* Call `createShardRuntime({ threadLimits: { ..., ioConcurrency: 12, fileConcurrency: 32, importConcurrency: 32 } ... })`
* Assert `runtimeRef.threadLimits.ioConcurrency === 12` and `runtimeRef.queues.io.concurrency === 12`.

### 8.4 runWithQueue bestEffort
Create: `tests/shared/concurrency/concurrency-run-with-queue-best-effort.test.js`
* Worker fails for some items
* With `bestEffort=true`, ensure:
  * all items processed
  * `AggregateError` thrown with correct number of inner errors
  * onResult called for successes only
  * onError called exactly once per failure

### 8.5 runWithQueue abort signal
Create: `tests/shared/concurrency/concurrency-run-with-queue-abort.test.js`
* Create AbortController; abort after a few items start.
* Ensure:
  * scheduling stops
  * queue cleared
  * function rejects with AbortError
  * no unhandled rejection warnings

---

## 9. Files to modify (Phase 4.2-4.4)

* `src/shared/threads.js` -- fix precedence + implement IO cap clamping + accept effective uv threadpool size and ioOversubscribe input.
* `src/index/build/runtime/workers.js` -- pass effective uv threadpool size from envelope; ensure warning logic uses effective.
* `src/index/build/indexer/steps/process-files/runtime.js` -- use `threadLimits.ioConcurrency` rather than recomputing.
* `src/shared/concurrency.js` -- extend `runWithQueue` contract (bestEffort, onError, signal).
* `src/shared/abort.js` -- new helper module.
* Pipeline call sites to pass signals (Phase 4.4) -- list depends on actual pipeline entry points, but must include every `runWithQueue` usage and every long-running stage boundary.

