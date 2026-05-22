# Shared Module Review: #412

Issue: `#412`  
Scope: `src/shared` concurrency, queue, subprocess, lifecycle, lock, worker, and progress helpers assigned to `#412` in the shared-module ledger.

## Overall Assessment

This shared surface contains several of the repo's most correctness-critical runtime helpers. The main risks are not duplication alone; they are policy and mechanism being entangled inside lock ownership, tracked subprocess cleanup, adaptive scheduling, and progress or logging helpers.

Highest-priority follow-ups:

- keep [file-lock.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/locks/file-lock.js) as the acquisition facade; constants, timing, info parsing, owner probing, stale cleanup, release errors, and metrics now live in focused leaves, and startup-sensitive callers lazy-load lock behavior
- keep [tracking.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/tracking.js) as the public tracking facade; scope propagation, child registration, runtime bookkeeping, and termination flow now live in focused leaves
- keep [runner.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/runner.js) as the subprocess runner facade; async, sync, isolated-node, and error-shape behavior already live in focused leaves
- keep [progress-runtime.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/progress-runtime.js) as the shared progress runtime owner; `progress-context.js` moved under the TUI supervisor because only that tool owns child-process context env propagation
- keep [adaptive-controller.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/concurrency/scheduler-core/adaptive-controller.js) as the adaptive scheduler composition layer; signal sampling, snapshots, surface decisions, and token policy already live in focused leaves
- keep the canonical queue implementation at [queue.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/service/queue.js) and avoid reintroducing root shared aliases

## Runtime-Risk Notes

- [file-lock.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/locks/file-lock.js): file locking remains correctness-critical, but constants, timing, info parsing, owner probing, stale cleanup, release errors, and metrics are now split behind the acquisition facade; retrieval/build startup paths lazy-load lock behavior.
- [tracking.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/tracking.js): tracked cleanup remains correctness-critical, but scope propagation, registration, runtime bookkeeping, and termination flow are now split behind the facade.
- [runner.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/runner.js): async and sync spawn behavior, isolated-node helpers, and subprocess error shapes are now split behind the facade.
- [adaptive-controller.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/concurrency/scheduler-core/adaptive-controller.js): scheduler adaptation remains correctness-critical, but signal sampling, snapshots, surface decisions, and token policy are now split behind the composition layer.

## Maintainability Notes

- [progress-format.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/bench/progress-format.js) is now correctly bench-specific rather than living in the generic root shared bucket.
- [perf-progress.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/build/embeddings/perf-progress.js) is now correctly embeddings-specific rather than living in the generic root shared bucket.
- [queue.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/service/queue.js) is the canonical queue implementation now that the old `src/shared` re-export has been removed.
- The old `src/shared/progress-context.js` helper moved to [tools/tui/supervisor/progress-context.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/tui/supervisor/progress-context.js) because it is a TUI supervisor env-shaping helper, not a shared progress runtime primitive.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/abort.js` | `keep`, `document`, `test` | Keep as the canonical abort helper surface. |
| `tools/bench/progress-format.js` | `move`, `document`, `test` | Bench-specific formatter now kept under bench ownership. |
| `src/shared/workers/bounded-object-pool.js` | `keep`, `document`, `test` | Keep as the small worker-family bounded pool helper. |
| `src/shared/concurrency.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to narrow concurrency owner modules. |
| `src/shared/concurrency/adaptive-surfaces.js` | `keep`, `document`, `test` | Keep internal to scheduler adaptation behavior. |
| `src/shared/concurrency/ordered-completion.js` | `keep`, `document`, `test` | Keep as the ordered completion primitive. |
| `src/shared/concurrency/queue-adapter.js` | `keep`, `document`, `test` | Keep as the adapter between facade and scheduler internals. |
| `src/shared/concurrency/run-with-queue.js` | `keep`, `document`, `test` | Keep, but avoid letting more scheduler policy accumulate here. |
| `src/shared/concurrency/scheduler-core-policy.js` | `keep`, `document`, `test` | Keep policy normalization separate from execution mechanics. |
| `src/shared/concurrency/scheduler-core-queue-state.js` | `keep`, `document`, `test` | Keep internal to scheduler queue-state accounting. |
| `src/shared/concurrency/scheduler-core-stats.js` | `keep`, `document`, `test` | Keep scheduler stats separate from policy and dispatch. |
| `src/shared/concurrency/scheduler-core-telemetry-capture.js` | `keep`, `document`, `test` | Keep as the scheduler telemetry capture helper. |
| `src/shared/concurrency/scheduler-core.js` | `keep`, `document`, `test` | Keep as the scheduler-core facade. |
| `src/shared/concurrency/scheduler-core/adaptive-controller.js` | `keep`, `document`, `test` | Keep as the composition layer over adaptive signal, snapshot, surface-controller, and token-controller leaves. |
| `src/shared/concurrency/scheduler-core/config.js` | `keep`, `document`, `test` | Keep config resolution separate from live scheduler state. |
| `src/shared/concurrency/scheduler-core/dispatch.js` | `keep`, `document`, `test` | Keep as the scheduler dispatch layer. |
| `src/shared/concurrency/scheduler-core/index.js` | `keep`, `document`, `test` | Keep as the family index surface. |
| `src/shared/concurrency/scheduler-core/queue-lifecycle.js` | `keep`, `document`, `test` | Keep queue lifecycle separate from dispatch and telemetry. |
| `src/shared/concurrency/scheduler-core/shutdown.js` | `keep`, `document`, `test` | Keep as the scheduler shutdown helper. |
| `src/shared/concurrency/scheduler-telemetry.js` | `keep`, `document`, `test` | Keep as the scheduler telemetry support layer. |
| `src/shared/concurrency/task-queues.js` | `keep`, `document`, `test` | Keep as the task-queue primitive layer. |
| `tools/build/embeddings/perf-progress.js` | `move`, `document`, `test` | Embeddings-specific formatter now kept under embeddings ownership. |
| `src/shared/kill-tree.js` | `keep`, `document`, `test` | Keep as the process-tree facade over platform-specific `kill-tree/posix.js`, `kill-tree/windows.js`, and shared defaults. |
| `src/shared/lifecycle/registry.js` | `keep`, `document`, `test` | Keep as the lifecycle registration surface. |
| `src/shared/locks/file-lock-runtime.js` | `keep`, `document`, `test` | Keep as the internal aggregation surface over focused file-lock leaves. |
| `src/shared/locks/file-lock-constants.js` | `keep`, `document`, `test` | Keep defaults, invalid-lock grace bounds, metadata key policy, and benign stale-removal race codes isolated from file IO. |
| `src/shared/locks/file-lock-timing.js` | `keep`, `document`, `test` | Keep abort-aware polling sleep, numeric coercion, and invalid-lock reclaim grace resolution separate from owner probing. |
| `src/shared/locks/file-lock-metrics.js` | `keep`, `document`, `test` | Keep runtime metrics and hook warning safety centralized. |
| `src/shared/locks/file-lock-info.js` | `keep`, `document`, `test` | Keep lock payload creation, metadata sanitization, info reads, PID extraction, and stale snapshot fingerprinting together. |
| `src/shared/locks/file-lock-owner.js` | `keep`, `document`, `test` | Keep PID liveness checks, Windows tasklist probing, ownership matching, and owned lock-file removal together. |
| `src/shared/locks/file-lock-stale.js` | `keep`, `document`, `test` | Keep stale detection, invalid-lock grace decisions, owner-first stale removal, force fallback, and cleanup error shaping together. |
| `src/shared/locks/file-lock-release.js` | `keep`, `document`, `test` | Keep release result normalization and release failure error shaping separate from acquisition flow. |
| `src/shared/locks/file-lock.js` | `keep`, `document`, `test` | Keep acquisition and `withFileLock` orchestration in the public facade; startup-sensitive build/tooling imports lazy-load lock behavior. |
| `src/shared/piscina-cleanup.js` | `keep`, `document`, `test` | Keep explicitly tied to Piscina cleanup semantics. |
| `src/shared/process-signals.js` | `keep`, `document`, `test` | Keep as the process-signal helper layer. |
| `src/shared/progress.js` | `removed`, `document`, `test` | Root facade removed after consumers moved to `progress-runtime.js` and `progress-context.js`. |
| `src/shared/promise-keepalive.js` | `keep`, `document`, `test` | Keep as the promise keepalive helper. |
| `src/shared/promise-timeout.js` | `keep`, `document`, `test` | Keep as the shared timeout primitive. |
| `tools/service/queue.js` | `move`, `document`, `test` | Canonical queue implementation now that the `src/shared` alias has been removed. |
| `src/shared/retry.js` | `keep`, `document`, `test` | Keep as the generic retry-with-backoff primitive. |
| `src/shared/scheduler/debounce.js` | `keep`, `document`, `test` | Keep focused on debounce semantics only. |
| `src/shared/sleep.js` | `keep`, `document`, `test` | Keep as the tiny sleep helper. |
| `src/shared/subprocess.js` | `removed`, `document`, `test` | Removed after active consumers moved to narrow subprocess owners. Use `src/shared/subprocess/runner.js`, `tracking.js`, `snapshot.js`, `sync-command.js`, `options.js`, or `command-invocation.js` directly. |
| `src/shared/subprocess/exit-semantics.js` | `keep`, `document`, `test` | Keep exit-code and signal interpretation isolated from runner flow control. |
| `src/shared/subprocess/options.js` | `keep`, `document`, `test` | Keep as the subprocess option-normalization layer. |
| `src/shared/subprocess/runner.js` | `keep`, `document`, `test` | Keep as the facade over async runner, sync runner, isolated-node helpers, and subprocess error types. |
| `src/shared/subprocess/signals.js` | `keep`, `document`, `test` | Keep as the subprocess signal-hook helper. |
| `src/shared/subprocess/snapshot.js` | `keep`, `document`, `test` | Keep as the subprocess snapshot helper. |
| `src/shared/subprocess/sync-command.js` | `keep`, `document`, `test` | Keep sync-command timeout behavior separate from the async runner. |
| `src/shared/subprocess/tracking-register.js` | `keep`, `document`, `test` | Keep child registration, inherited ownership resolution, close cleanup, and unregister behavior separate from scope propagation. |
| `src/shared/subprocess/tracking-runtime.js` | `keep`, `document`, `test` | Keep tracked subprocess state, ownership matching, and event bookkeeping in the runtime leaf. |
| `src/shared/subprocess/tracking-scope.js` | `keep`, `document`, `test` | Keep AsyncLocalStorage signal-scope binding separate from child registration and termination flow; heavy startup modules lazy-load this owner. |
| `src/shared/subprocess/tracking-terminate.js` | `keep`, `document`, `test` | Keep tracked-child termination and cleanup flow separate from scope propagation. |
| `src/shared/subprocess/tracking.js` | `keep`, `document`, `test` | Keep as the public and test-facing facade; startup-sensitive `src` paths import narrow tracking leaves directly. |
| `src/shared/subprocess/windows-cmd-core.cjs` | `keep`, `document`, `test` | Keep as the Windows-specific command-core layer. |
| `src/shared/subprocess/windows-cmd.js` | `keep`, `document`, `test` | Keep as the Windows wrapper facade above the core layer. |
| `src/shared/threads.js` | `keep`, `document`, `test` | Keep as the thread-resolution helper. |
| `src/shared/workers/node-argv.js` | `keep`, `document`, `test` | Keep Node argv derivation under the worker family instead of duplicating execArgv filtering in launch callsites. |
| `src/shared/workers/bundle-transform-worker.js` | `keep`, `document`, `test` | Keep as a worker-target module under bundle IO ownership. |
