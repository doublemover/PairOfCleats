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
  try {
    if (runtime.workerPools?.destroy) {
      await runBuildCleanupWithTimeout({
        label: 'runtime.worker-pools.destroy',
        cleanup: () => runtime.workerPools.destroy(),
        timeoutMs: cleanupTimeoutMs,
        log
      });
    } else if (runtime.workerPool?.destroy) {
      await runBuildCleanupWithTimeout({
        label: 'runtime.worker-pool.destroy',
        cleanup: () => runtime.workerPool.destroy(),
        timeoutMs: cleanupTimeoutMs,
        log
      });
    }
  } catch {}
  try {
    await runBuildCleanupWithTimeout({
      label: 'runtime.scheduler.shutdown',
      cleanup: () => Promise.resolve(runtime.scheduler?.shutdown?.()),
      timeoutMs: cleanupTimeoutMs,
      log
    });
  } catch {}
  try {
    await runBuildCleanupWithTimeout({
      label: 'runtime.tree-sitter-worker-pool.shutdown',
      cleanup: () => shutdownTreeSitterWorkerPool(),
      timeoutMs: cleanupTimeoutMs,
      log
    });
  } catch {}
  try {
    await runBuildCleanupWithTimeout({
      label: 'runtime.python-ast-pool.shutdown',
      cleanup: () => Promise.resolve(shutdownPythonAstPool()),
      timeoutMs: cleanupTimeoutMs,
      log
    });
  } catch {}
};
