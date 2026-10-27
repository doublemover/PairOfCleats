import path from 'node:path';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { runManagedChildWithStorage } from '../../src/shared/storage/managed-child-session.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';

export { resolveDeclaredInstallAdmission } from './install-allocation-contract.js';

/** Pure destination projection. Forecast destinations grant no write admission. */
export const resolveInstallEstimateDestinations = (estimates, { storagePlan, artifactRoot } = {}) => {
  if (!Array.isArray(estimates) || !estimates.length || estimates.length > 64 || !path.isAbsolute(artifactRoot || '')) return null;
  const writes = estimates.map(write => {
    if (write.root) return write;
    const location = write.environmentKey ? storagePlan.locations.find(value => value.environmentKey.toLowerCase() === write.environmentKey.toLowerCase()) : null;
    const root = write.destination === 'artifacts' ? artifactRoot : write.destination === 'scratch' ? storagePlan.scratch
      : location ? location.file ? path.dirname(location.path) : location.path : null;
    if (!root) throw new Error('Declared allocation owner does not match an actual child write destination.');
    return { root: path.resolve(root), requiredBytes: write.requiredBytes, minimumFreeBytes: write.minimumFreeBytes, hardBytes: write.hardBytes };
  });
  const actual = [artifactRoot, ...storagePlan.locations.map(location => location.file ? path.dirname(location.path) : location.path)];
  if (actual.some(root => !writes.some(write => isPathWithinRoot(path.resolve(root), write.root)))) return null;
  const byRoot = new Map();
  for (const write of writes) {
    const prior = byRoot.get(write.root);
    if (prior && JSON.stringify(prior) !== JSON.stringify(write)) throw new Error('Conflicting allocation estimates for the same actual destination.');
    byRoot.set(write.root, write);
  }
  return { writes: [...byRoot.values()] };
};

export const bindDeclaredInstallAdmission = (declared, options = {}) => declared?.state === 'estimate-declared'
  ? resolveInstallEstimateDestinations(declared.writes, options) : null;

/** Owned async child close/termination evidence controls storage-session release. */
export const runToolInstallChild = async ({ command, args, options, storagePlan, layout, artifactRoot,
  admission = null, spawn = spawnResolvedSubprocess } = {}) => {
  if (storagePlan?.managed) {
    const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (!path.isAbsolute(storagePlan.cwd || '') || normalize(storagePlan.cwd) !== normalize(options?.cwd || process.cwd())) {
      throw Object.assign(new Error('Managed install launch working directory differs from its reviewed storage routes; re-plan before preparation.'),
        { code: 'ERR_INSTALL_STORAGE_CWD_CHANGED' });
    }
  }
  const destinations = storagePlan?.managed ? [artifactRoot, ...storagePlan.locations.map(location => location.file ? path.dirname(location.path) : location.path)] : [];
  if (storagePlan?.managed && (!Array.isArray(admission?.writes) || !admission.writes.length
    || destinations.some(root => !root || !admission.writes.some(write => path.isAbsolute(write.root || '') && isPathWithinRoot(root, write.root))))) {
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
      admission: storagePlan?.managed ? admission : null }, async ({ env, storage }) => {
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
      storage: { ...session.storage, settlement: { resourceId: session.resourceId, settled: true, pending: false } },
      settlement: { resourceId: session.resourceId, settled: true, pending: false } };
  } catch (error) {
    if (error.cacheOwnershipPending) throw error;
    const result = error.result || {};
    return { ok: false, status: result.exitCode ?? null, signal: result.signal || null,
      stdout: result.stdout || '', stderr: result.stderr || '', error,
      settlement: { settled: true, pending: false } };
  }
};
