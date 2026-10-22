import path from 'node:path';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { runManagedChildWithStorage } from '../../src/shared/storage/managed-child-session.js';

/** Canonical recipes declare the peak additional allocation, including expanded
 * artifacts, package/build caches and staging. Archive length alone is not that
 * estimate; unknown transitive package writes stay unknown rather than zero.
 */
export const resolveDeclaredInstallAdmission = recipe => {
  const estimate = recipe?.storageEstimate;
  const known = estimate?.complete === true && Number.isSafeInteger(estimate.peakAdditionalBytes) && estimate.peakAdditionalBytes >= 0;
  const budget = key => {
    const value = estimate?.[key];
    if (value === undefined || value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Declared install storage budget must be a nonnegative safe integer.');
    return value;
  };
  return { requiredBytes: known ? estimate.peakAdditionalBytes : null,
    minimumFreeBytes: budget('minimumFreeBytes'), hardBytes: budget('hardBytes'),
    source: known ? 'canonical-recipe-declared-peak-additional-bytes' : 'unknown-artifact-build-allocation',
    state: known ? 'estimate-declared' : 'deferred-unknown-allocation' };
};

/** Owned async child close/termination evidence controls storage-session release. */
export const runToolInstallChild = async ({ command, args, options, storagePlan, layout,
  admission = null, spawn = spawnResolvedSubprocess } = {}) => {
  if (storagePlan?.managed && (!Number.isSafeInteger(admission?.requiredBytes) || admission.requiredBytes < 0)) {
    const error = Object.assign(new Error('Managed install deferred: its canonical recipe has no complete artifact/build allocation estimate.'),
      { code: 'ERR_INSTALL_STORAGE_ESTIMATE_REQUIRED' });
    return { ok: false, status: null, signal: null, stdout: '', stderr: '', error,
      storage: { managed: true, prepared: false, admission: 'deferred-unknown-allocation', cleanupAttempted: false },
      settlement: { settled: true, pending: false } };
  }
  let spawned = false;
  try {
    const session = await runManagedChildWithStorage({ plan: storagePlan,
      authorizedRoots: Object.values(layout.descriptors).map(descriptor => descriptor.path),
      coordinationRoot: path.join(layout.descriptors.state.path, 'storage-access'),
      admission: storagePlan?.managed ? { requiredBytes: admission.requiredBytes,
        minimumFreeBytes: admission.minimumFreeBytes, hardBytes: admission.hardBytes } : null }, async ({ env, storage }) => {
      const result = await spawn(command, args, { ...options, env, outputEncoding: 'utf8',
        maxOutputBytes: 1024 * 1024, rejectOnNonZeroExit: false,
        onSpawn: () => { spawned = true; } });
      // The existing async owner resolves this path only after the close event.
      return { result, storage, closeObserved: true };
    }, { settlement: ({ value, error, resourceId }) => {
      const termination = error?.result?.termination;
      const reconciled = error?.cacheOwnershipReleased?.() === true;
      const settled = value?.closeObserved === true || !spawned || reconciled
        || (termination?.closeObserved === true && termination.treeCleanupSettled === true && termination.treeCleanupFailed === false);
      return { resourceId, settled, pending: !settled };
    } });
    const result = session.value.result;
    return { ok: result.exitCode === 0, status: result.exitCode ?? null, signal: result.signal || null,
      stdout: result.stdout || '', stderr: result.stderr || '', error: null,
      storage: session.storage, settlement: { resourceId: session.resourceId, settled: true, pending: false } };
  } catch (error) {
    if (error.cacheOwnershipPending) throw error;
    const result = error.result || {};
    return { ok: false, status: result.exitCode ?? null, signal: result.signal || null,
      stdout: result.stdout || '', stderr: result.stderr || '', error,
      settlement: { settled: true, pending: false } };
  }
};
