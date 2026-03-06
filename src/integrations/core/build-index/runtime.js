import { shutdownPythonAstPool } from '../../../lang/python.js';
import { shutdownTreeSitterWorkerPool } from '../../../lang/tree-sitter.js';
import { log as defaultLog } from '../../../shared/progress.js';
import { terminateTrackedSubprocesses } from '../../../shared/subprocess.js';
import {
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../../../index/build/cleanup-timeout.js';
import { drainLspSessionPool } from '../../tooling/providers/lsp/session-pool.js';

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
    : defaultLog;
  const teardownErrors = [];
  const runTeardownStepWithTimeout = async (label, cleanup, timeoutMs = cleanupTimeoutMs) => {
    const startedAtMs = Date.now();
    if (typeof log === 'function') {
      try {
        log(`[cleanup] ${label} start`);
      } catch {}
    }
    try {
      await runBuildCleanupWithTimeout({
        label,
        cleanup,
        timeoutMs,
        log,
        swallowTimeout: false
      });
      if (typeof log === 'function') {
        try {
          log(`[cleanup] ${label} done (${Math.max(0, Date.now() - startedAtMs)}ms)`);
        } catch {}
      }
    } catch (error) {
      if (typeof log === 'function') {
        try {
          log(
            `[cleanup] ${label} failed after ${Math.max(0, Date.now() - startedAtMs)}ms: `
            + `${error?.message || error}`
          );
        } catch {}
      }
      teardownErrors.push(error);
    }
  };
  await runTeardownStepWithTimeout(
    'runtime.tooling.lsp-session-pool.drain',
    async () => {
      const drainResult = await drainLspSessionPool({
        timeoutMs: cleanupTimeoutMs,
        log
      });
      if (drainResult?.timedOut) {
        throw new Error(
          `LSP session pool drain timed out after ${drainResult.timeoutMs}ms.`
        );
      }
      if (Number(drainResult?.rejected || 0) > 0) {
        throw new Error(
          `LSP session pool drain reported ${drainResult.rejected} rejected cleanup operation(s).`
        );
      }
      return drainResult;
    },
    cleanupTimeoutMs + 10_000
  );
  if (runtime.workerPools?.destroy) {
    await runTeardownStepWithTimeout(
      'runtime.worker-pools.destroy',
      () => runtime.workerPools.destroy(),
      cleanupTimeoutMs + 15000
    );
  } else if (runtime.workerPool?.destroy) {
    await runTeardownStepWithTimeout(
      'runtime.worker-pool.destroy',
      () => runtime.workerPool.destroy(),
      cleanupTimeoutMs + 15000
    );
  }
  await runTeardownStepWithTimeout(
    'runtime.scheduler.shutdown',
    () => Promise.resolve(runtime.scheduler?.shutdown?.({
      awaitRunning: true,
      timeoutMs: cleanupTimeoutMs
    }))
  );
  await runTeardownStepWithTimeout(
    'runtime.stage1-subprocesses.terminate',
    () => {
      const ownershipPrefix = runtime?.subprocessOwnership?.stage1FilePrefix || null;
      if (!ownershipPrefix) return null;
      return terminateTrackedSubprocesses({
        reason: 'runtime_teardown_stage1',
        force: true,
        ownershipPrefix
      });
    }
  );
  await runTeardownStepWithTimeout(
    'runtime.preflight-subprocesses.terminate',
    () => terminateTrackedSubprocesses({
      reason: 'runtime_teardown_preflight',
      force: true,
      ownershipPrefix: 'tooling-preflight:'
    })
  );
  await runTeardownStepWithTimeout(
    'runtime.tree-sitter-worker-pool.shutdown',
    () => shutdownTreeSitterWorkerPool({
      cleanupTimeoutMs: Math.max(1000, cleanupTimeoutMs - 5000),
      log
    }),
    cleanupTimeoutMs + 10000
  );
  await runTeardownStepWithTimeout(
    'runtime.python-ast-pool.shutdown',
    () => Promise.resolve(shutdownPythonAstPool())
  );
  if (teardownErrors.length === 1) {
    throw teardownErrors[0];
  }
  if (teardownErrors.length > 1) {
    throw new AggregateError(teardownErrors, '[cleanup] runtime teardown failed.');
  }
};
