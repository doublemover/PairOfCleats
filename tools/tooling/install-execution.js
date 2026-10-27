import path from 'node:path';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { runManagedChildWithStorage } from '../../src/shared/storage/managed-child-session.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';

/** Canonical recipes declare the peak additional allocation, including expanded
 * artifacts, package/build caches and staging. Archive length alone is not that
 * estimate; unknown transitive package writes stay unknown rather than zero.
 */
export const resolveDeclaredInstallAdmission = recipe => {
  const estimate = recipe?.storageEstimate;
  const budget = (write, key, fallback) => {
    const value = write?.[key];
    if (value === undefined || value === null) return fallback;
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('Declared install storage budget must be a nonnegative safe integer.');
    return value;
  };
  if (estimate?.complete !== true || !Array.isArray(estimate.writes) || !estimate.writes.length || estimate.writes.length > 64) {
    return { writes: null, state: 'deferred-unknown-allocation', source: 'unknown-artifact-build-allocation' };
  }
  const writes = estimate.writes.map(write => {
    const selectors = [write.root, write.destination, write.environmentKey].filter(value => value !== undefined);
    if (selectors.length !== 1 || selectors.some(value => typeof value !== 'string' || !value)
      || (write.root && !path.isAbsolute(write.root))
      || (write.destination && !['artifacts', 'scratch'].includes(write.destination))) throw new TypeError('Declared install allocation needs one exact root, artifact/scratch destination or environment-key owner.');
    const requiredBytes = budget(write, 'requiredBytes', null);
    if (requiredBytes === null) throw new TypeError('Declared install destination requires an exact byte estimate.');
    return { ...(write.root ? { root: path.resolve(write.root) } : write.destination ? { destination: write.destination } : { environmentKey: write.environmentKey }),
      requiredBytes, minimumFreeBytes: budget(write, 'minimumFreeBytes', 0), hardBytes: budget(write, 'hardBytes', null) };
  });
  if (estimate.basis !== undefined && !['canonical-build-forecast-v1', 'bounded-archive-owner-v1'].includes(estimate.basis)) {
    throw new TypeError('Unknown canonical install allocation basis.');
  }
  return { writes, source: estimate.basis === 'canonical-build-forecast-v1'
    ? 'canonical-recipe-build-forecast' : 'canonical-recipe-declared-destination-peaks', state: 'estimate-declared',
  ...(estimate.basis ? { basis: estimate.basis, measured: false } : {}),
  ...(typeof estimate.recipe === 'string' ? { recipe: estimate.recipe } : {}) };
};

export const bindDeclaredInstallAdmission = (declared, { storagePlan, artifactRoot } = {}) => {
  if (declared?.state !== 'estimate-declared' || !path.isAbsolute(artifactRoot || '')) return null;
  const writes = declared.writes.map(write => {
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
