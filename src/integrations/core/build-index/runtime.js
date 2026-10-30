import { log as defaultLog } from '../../../shared/progress-runtime.js';
import { terminateTrackedSubprocesses } from '../../../shared/subprocess/tracking-terminate.js';
import { assertSubprocessTerminationReceipt } from '../../../shared/subprocess/termination-receipt.js';
import {
  isOwnedBuildCleanupTimeout,
  resolveBuildCleanupTimeoutMs,
  runBuildCleanupWithTimeout
} from '../../../index/build/cleanup-timeout.js';
import { releaseBuildRuntimeStorage, retainBuildRuntimeStorageFailure } from '../../../index/build/runtime/storage.js';
import { captureRuntimeFailureObservation, composeRuntimeTeardownFailures } from '../../../index/build/runtime/failure.js';

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
  const report = line => {
    if (typeof log !== 'function') return;
    try { Promise.resolve(log(line)).catch(() => {}); } catch {}
  };
  const teardownErrors = [];
  const teardownObservations = [];
  const runTeardownStepWithTimeout = async (label, cleanup, timeoutMs = cleanupTimeoutMs, observeSettlement = null) => {
    const startedAtMs = Date.now();
    const deadlineOwner = {};
    report(`[cleanup] ${label} start`);
    try {
      await runBuildCleanupWithTimeout({
        label,
        cleanup,
        timeoutMs,
        deadlineOwner,
        log: report,
        swallowTimeout: false
      });
      report(`[cleanup] ${label} done (${Math.max(0, Date.now() - startedAtMs)}ms)`);
    } catch (error) {
      // Only this exact deadline can be enriched by its actual resource owner.
      // A code/label or a later fulfilled cleanup promise grants no authority.
      if (observeSettlement && isOwnedBuildCleanupTimeout(error, deadlineOwner)) {
        Object.defineProperty(error, 'cacheOwnershipReleased', { value: observeSettlement });
      }
      const observation = captureRuntimeFailureObservation(error);
      teardownObservations.push(observation);
      teardownErrors.push(error);
      report(`[cleanup] ${label} failed after ${Math.max(0, Date.now() - startedAtMs)}ms: ${observation.context.message}`);
    }
  };
  let resourceScope = null, closeResources = null, observeResources = null;
  await runTeardownStepWithTimeout('runtime.resources.stop-admission', () => {
    resourceScope = runtime.resourceScope || null;
    if (!resourceScope) return;
    resourceScope.stopAdmission();
    closeResources = resourceScope.close;
    const isSettled = resourceScope.isSettled;
    if (typeof isSettled === 'function') observeResources = () => isSettled.call(resourceScope) === true;
  });
  await runTeardownStepWithTimeout(
    'runtime.scheduler.shutdown',
    async () => {
      const result = await runtime.scheduler?.shutdown?.({ awaitRunning: true, timeoutMs: cleanupTimeoutMs });
      if (result?.timedOut) throw Object.assign(new Error('Runtime scheduler did not drain.'), { code: 'ERR_INDEX_CACHE_DRAIN_INCOMPLETE' });
    },
    cleanupTimeoutMs > 0 ? cleanupTimeoutMs + 25 : 0
  );
  await runTeardownStepWithTimeout(
    'runtime.worker-pools.destroy',
    async () => {
      // Selection is fallible cleanup work too. Capture one original owner and
      // method inside the bounded step so a getter cannot bypass later cleanup
      // or substitute a different pool between checking and invoking destroy.
      const pools = runtime.workerPools;
      const destroyPools = pools?.destroy;
      if (destroyPools) {
        if (typeof destroyPools !== 'function') throw new TypeError('Runtime worker-pools destroy must be callable.');
        return destroyPools.call(pools);
      }
      const pool = runtime.workerPool;
      const destroyPool = pool?.destroy;
      if (destroyPool) {
        if (typeof destroyPool !== 'function') throw new TypeError('Runtime worker-pool destroy must be callable.');
        return destroyPool.call(pool);
      }
    },
    cleanupTimeoutMs + 15000
  );
  await runTeardownStepWithTimeout(
    'runtime.stage1-subprocesses.terminate',
    async () => {
      const ownershipPrefix = runtime?.subprocessOwnership?.stage1FilePrefix || null;
      if (!ownershipPrefix) return null;
      return assertSubprocessTerminationReceipt(await terminateTrackedSubprocesses({
        reason: 'runtime_teardown_stage1',
        force: true,
        ownershipPrefix
      }), { ownershipPrefix });
    }
  );
  await runTeardownStepWithTimeout('runtime.embeddings.close', () => runtime.closeEmbeddingRuntime?.());
  await runTeardownStepWithTimeout(
    'runtime.preflight-subprocesses.terminate',
    async () => {
      const ownershipPrefix = runtime?.subprocessOwnership?.preflightPrefix || null;
      if (!ownershipPrefix) return null;
      return assertSubprocessTerminationReceipt(await terminateTrackedSubprocesses({
        reason: 'runtime_teardown_preflight',
        force: true,
        ownershipPrefix
      }), { ownershipPrefix });
    }
  );
  await runTeardownStepWithTimeout(
    'runtime.resources.release',
    () => observeResources?.() ? null : closeResources?.call(resourceScope),
    cleanupTimeoutMs,
    observeResources
  );
  await runTeardownStepWithTimeout('runtime.cache-writers.drain', () => runtime.cacheWriterDrain?.());
  await runTeardownStepWithTimeout('runtime.semantic-replay.clear', () => runtime.semanticReplayVerification?.clear());
  await runTeardownStepWithTimeout('runtime.logger.close', () => runtime.closeLogger?.());
  if (teardownErrors.length) {
    const failure = composeRuntimeTeardownFailures(teardownObservations);
    throw retainBuildRuntimeStorageFailure(runtime, teardownErrors.length === 1 ? teardownErrors[0] : failure, {
      originalObservations: teardownObservations, unownedFailure: failure
    });
  }
  releaseBuildRuntimeStorage(runtime);
};
