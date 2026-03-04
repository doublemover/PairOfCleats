import { shutdownPythonAstPool } from '../../../lang/python.js';
import { shutdownTreeSitterWorkerPool } from '../../../lang/tree-sitter.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../../../index/build/cleanup-timeout.js';

/**
 * Teardown build runtime resources (workers, scheduler, parser pools).
 *
 * @param {object|null} runtime
 * @returns {Promise<void>}
 */
export const teardownRuntime = async (runtime) => {
  if (!runtime) return;
  const cleanupTimeoutMs = resolveBuildCleanupTimeoutMs(
    runtime?.indexingConfig?.stage1?.watchdog?.cleanupTimeoutMs,
    runtime?.stage1Queues?.watchdog?.cleanupTimeoutMs
  );
  const log = typeof runtime?.log === 'function'
    ? runtime.log
    : null;
  const runTeardownStep = async (label, cleanup) => {
    try {
      await runBuildCleanupWithTimeout({
        label,
        cleanup,
        timeoutMs: cleanupTimeoutMs,
        log,
        swallowTimeout: false
      });
    } catch (error) {
      if (typeof log === 'function') {
        try {
          log(`[cleanup] ${label} failed: ${error?.message || error}`);
        } catch {}
      }
    }
  };
  if (runtime.workerPools?.destroy) {
    await runTeardownStep(
      'runtime.worker-pools.destroy',
      () => runtime.workerPools.destroy()
    );
  } else if (runtime.workerPool?.destroy) {
    await runTeardownStep(
      'runtime.worker-pool.destroy',
      () => runtime.workerPool.destroy()
    );
  }
  await runTeardownStep(
    'runtime.scheduler.shutdown',
    () => Promise.resolve(runtime.scheduler?.shutdown?.({
      awaitRunning: true,
      timeoutMs: cleanupTimeoutMs
    }))
  );
  await runTeardownStep(
    'runtime.tree-sitter-worker-pool.shutdown',
    () => shutdownTreeSitterWorkerPool()
  );
  await runTeardownStep(
    'runtime.python-ast-pool.shutdown',
    () => Promise.resolve(shutdownPythonAstPool())
  );
};
