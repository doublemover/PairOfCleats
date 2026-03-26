# Shared Module Review: #412

Issue: `#412`  
Scope: `src/shared` concurrency, queue, subprocess, lifecycle, lock, worker, and progress helpers assigned to `#412` in the shared-module ledger.

## Overall Assessment

This shared surface contains several of the repo's most correctness-critical runtime helpers. The main risks are not duplication alone; they are policy and mechanism being entangled inside lock ownership, tracked subprocess cleanup, adaptive scheduling, and progress or logging helpers.

Highest-priority follow-ups:

- split [file-lock.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/locks/file-lock.js)
- split [tracking.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/tracking.js)
- split [runner.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/runner.js)
- split [progress.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/progress.js)
- split [adaptive-controller.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/concurrency/scheduler-core/adaptive-controller.js)
- keep the canonical queue implementation at [queue.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/service/queue.js) and avoid reintroducing root shared aliases

## Runtime-Risk Notes

- [file-lock.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/locks/file-lock.js): stale-owner reclamation, Windows tasklist ownership checks, and release semantics are correctness-critical.
- [tracking.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/tracking.js): AsyncLocalStorage scope propagation, cleanup hooks, and termination audits are all coupled together.
- [runner.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/subprocess/runner.js): async and sync spawn behavior, timeout or abort termination, and tracked cleanup registration all live together.
- [adaptive-controller.js](C:/Users/sneak/Development/DOUBLECLEAT/src/shared/concurrency/scheduler-core/adaptive-controller.js): scheduler adaptation mixes queue pressure, system signals, and policy response in one file.

## Maintainability Notes

- [progress-format.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/bench/progress-format.js) is now correctly bench-specific rather than living in the generic root shared bucket.
- [perf-progress.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/build/embeddings/perf-progress.js) is now correctly embeddings-specific rather than living in the generic root shared bucket.
- [queue.js](C:/Users/sneak/Development/DOUBLECLEAT/tools/service/queue.js) is the canonical queue implementation now that the old `src/shared` re-export has been removed.

## File Ledger

| File | Classification | Review Note |
| --- | --- | --- |
| `src/shared/abort.js` | `keep`, `document`, `test` | Keep as the canonical abort helper surface. |
| `tools/bench/progress-format.js` | `move`, `document`, `test` | Bench-specific formatter now kept under bench ownership. |
| `src/shared/bounded-object-pool.js` | `keep`, `document`, `test` | Keep as the small bounded pool helper. |
| `src/shared/concurrency.js` | `keep`, `document`, `test` | Healthy public facade for the concurrency family. |
| `src/shared/concurrency/adaptive-surfaces.js` | `keep`, `document`, `test` | Keep internal to scheduler adaptation behavior. |
| `src/shared/concurrency/ordered-completion.js` | `keep`, `document`, `test` | Keep as the ordered completion primitive. |
| `src/shared/concurrency/queue-adapter.js` | `keep`, `document`, `test` | Keep as the adapter between facade and scheduler internals. |
| `src/shared/concurrency/run-with-queue.js` | `keep`, `document`, `test` | Keep, but avoid letting more scheduler policy accumulate here. |
| `src/shared/concurrency/scheduler-core-policy.js` | `keep`, `document`, `test` | Keep policy normalization separate from execution mechanics. |
| `src/shared/concurrency/scheduler-core-queue-state.js` | `keep`, `document`, `test` | Keep internal to scheduler queue-state accounting. |
| `src/shared/concurrency/scheduler-core-stats.js` | `keep`, `document`, `test` | Keep scheduler stats separate from policy and dispatch. |
| `src/shared/concurrency/scheduler-core-telemetry-capture.js` | `keep`, `document`, `test` | Keep as the scheduler telemetry capture helper. |
| `src/shared/concurrency/scheduler-core.js` | `keep`, `document`, `test` | Keep as the scheduler-core facade. |
| `src/shared/concurrency/scheduler-core/adaptive-controller.js` | `split`, `document`, `test` | Split signal sampling, adaptive snapshots, and token-scaling policy. |
| `src/shared/concurrency/scheduler-core/config.js` | `keep`, `document`, `test` | Keep config resolution separate from live scheduler state. |
| `src/shared/concurrency/scheduler-core/dispatch.js` | `keep`, `document`, `test` | Keep as the scheduler dispatch layer. |
| `src/shared/concurrency/scheduler-core/index.js` | `keep`, `document`, `test` | Keep as the family index surface. |
| `src/shared/concurrency/scheduler-core/queue-lifecycle.js` | `keep`, `document`, `test` | Keep queue lifecycle separate from dispatch and telemetry. |
| `src/shared/concurrency/scheduler-core/shutdown.js` | `keep`, `document`, `test` | Keep as the scheduler shutdown helper. |
| `src/shared/concurrency/scheduler-telemetry.js` | `keep`, `document`, `test` | Keep as the scheduler telemetry support layer. |
| `src/shared/concurrency/task-queues.js` | `keep`, `document`, `test` | Keep as the task-queue primitive layer. |
| `tools/build/embeddings/perf-progress.js` | `move`, `document`, `test` | Embeddings-specific formatter now kept under embeddings ownership. |
| `src/shared/kill-tree.js` | `split`, `document`, `test` | Split platform-specific kill behavior from generic tree orchestration. |
| `src/shared/lifecycle/registry.js` | `keep`, `document`, `test` | Keep as the lifecycle registration surface. |
| `src/shared/locks/file-lock.js` | `split`, `document`, `test` | Split lock info parsing, stale-owner detection, and release semantics from acquisition flow. |
| `src/shared/piscina-cleanup.js` | `keep`, `document`, `test` | Keep explicitly tied to Piscina cleanup semantics. |
| `src/shared/process-signals.js` | `keep`, `document`, `test` | Keep as the process-signal helper layer. |
| `src/shared/progress.js` | `split`, `document`, `test` | Split TTY progress rendering, structured logging, ring-buffer capture, and env propagation. |
| `src/shared/promise-keepalive.js` | `keep`, `document`, `test` | Keep as the promise keepalive helper. |
| `src/shared/promise-timeout.js` | `keep`, `document`, `test` | Keep as the shared timeout primitive. |
| `tools/service/queue.js` | `move`, `document`, `test` | Canonical queue implementation now that the `src/shared` alias has been removed. |
| `src/shared/retry.js` | `keep`, `document`, `test` | Keep as the generic retry-with-backoff primitive. |
| `src/shared/scheduler/debounce.js` | `keep`, `document`, `test` | Keep focused on debounce semantics only. |
| `src/shared/sleep.js` | `keep`, `document`, `test` | Keep as the tiny sleep helper. |
| `src/shared/subprocess.js` | `keep`, `document`, `test` | Healthy main facade for the subprocess family. |
| `src/shared/subprocess/options.js` | `keep`, `document`, `test` | Keep as the subprocess option-normalization layer. |
| `src/shared/subprocess/runner.js` | `split`, `document`, `test` | Split async runner, sync runner, and isolated-node helpers behind one facade. |
| `src/shared/subprocess/signals.js` | `keep`, `document`, `test` | Keep as the subprocess signal-hook helper. |
| `src/shared/subprocess/snapshot.js` | `keep`, `document`, `test` | Keep as the subprocess snapshot helper. |
| `src/shared/subprocess/sync-command.js` | `keep`, `document`, `test` | Keep sync-command timeout behavior separate from the async runner. |
| `src/shared/subprocess/tracking.js` | `split`, `document`, `test` | Split scope propagation from tracked-child registry and termination-audit logic. |
| `src/shared/subprocess/windows-cmd-core.cjs` | `keep`, `document`, `test` | Keep as the Windows-specific command-core layer. |
| `src/shared/subprocess/windows-cmd.js` | `keep`, `document`, `test` | Keep as the Windows wrapper facade above the core layer. |
| `src/shared/threads.js` | `keep`, `document`, `test` | Keep as the thread-resolution helper. |
| `src/shared/workers/bundle-transform-worker.js` | `keep`, `document`, `test` | Keep as a worker-target module under bundle IO ownership. |
