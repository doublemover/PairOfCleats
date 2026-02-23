import { shutdownPythonAstPool } from '../../../lang/python.js';
import { shutdownTreeSitterWorkerPool } from '../../../lang/tree-sitter.js';

/**
 * Teardown build runtime resources (workers, scheduler, parser pools).
 *
 * @param {object|null} runtime
 * @returns {Promise<void>}
 */
export const teardownRuntime = async (runtime) => {
  if (!runtime) return;
  try {
    if (runtime.workerPools?.destroy) {
      await runtime.workerPools.destroy();
    } else if (runtime.workerPool?.destroy) {
      await runtime.workerPool.destroy();
    }
  } catch {}
  try {
    runtime.scheduler?.shutdown?.();
  } catch {}
  await shutdownTreeSitterWorkerPool();
  shutdownPythonAstPool();
};
