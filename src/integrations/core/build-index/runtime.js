import { shutdownPythonAstPool } from '../../../lang/python.js';
import { shutdownTreeSitterWorkerPool } from '../../../lang/tree-sitter.js';

export const teardownRuntime = async (runtime) => {
  if (!runtime) return;
  try {
    if (runtime.workerPools?.destroy) {
      await runtime.workerPools.destroy();
    } else if (runtime.workerPool?.destroy) {
      await runtime.workerPool.destroy();
    }
  } catch {}
  await shutdownTreeSitterWorkerPool();
  shutdownPythonAstPool();
};
