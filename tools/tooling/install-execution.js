import path from 'node:path';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { runManagedChildWithStorage } from '../../src/shared/storage/managed-child-session.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

import { normalizeInstallAllocationWrites } from './install-allocation-contract.js';
export { resolveDeclaredInstallAdmission } from './install-allocation-contract.js';

/** Pure destination projection. Forecast destinations grant no write admission. */
export const resolveInstallEstimateDestinations = (estimates, { storagePlan, artifactRoot } = {}) => {
  if (!path.isAbsolute(artifactRoot || '')) return null;
  const normalized = normalizeInstallAllocationWrites(estimates);
  if (!normalized) return null;
  const writes = normalized.map(write => {
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
  const identity = root => process.platform === 'win32' ? root.toLowerCase() : root;
  for (const write of writes) {
    const key = identity(write.root), prior = byRoot.get(key);
    if (prior && ['requiredBytes', 'minimumFreeBytes', 'hardBytes'].some(field => prior[field] !== write[field])) {
      throw new Error('Conflicting allocation estimates for the same actual destination.');
    }
    if (!prior) byRoot.set(key, write);
  }
  return { writes: [...byRoot.values()] };
};

export const bindDeclaredInstallAdmission = (declared, options = {}) => declared?.state === 'estimate-declared'
  ? resolveInstallEstimateDestinations(declared.writes, options) : null;

// Projection neither grants settlement nor replaces a primary failure. Capture
// each original before its fields, and recheck every enclosing owner per read.
const installFields = (initial = [], primary = null) => {
  const observations = [...initial];
  const preserve = error => primary === null ? error : addStorageFailureContext(primary, {}, error, { secondaryPresent: true });
  const requireSettled = () => {
    try { for (const observation of observations) observation.requireSettled(); }
    catch (error) { throw preserve(error); }
  };
  return { requireSettled,
    observe(value) {
      requireSettled(); const observation = observeStorageResource(value, { phase: 'tool-install-result' });
      observations.push(observation); requireSettled(); return observation;
    },
    read(observation, field) {
      requireSettled(); let value;
      try { value = observation.read(field); } catch (error) { throw preserve(error); }
      requireSettled(); return value;
    }
  };
};
const projectInstallResult = (reader, observation) => ({ exitCode: reader.read(observation, 'exitCode'),
  signal: reader.read(observation, 'signal'), stdout: reader.read(observation, 'stdout') || '', stderr: reader.read(observation, 'stderr') || '' });

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
      const reader = installFields(), observation = reader.observe(result);
      const projected = projectInstallResult(reader, observation);
      return Object.freeze(Object.defineProperties({ result: projected, storage, closeObserved: true }, {
        cacheOwnershipPending: { value: true }, cacheOwnershipReleased: { value: () => { reader.requireSettled(); return true; } }
      }));
    }, { settlement: ({ value, error, resourceId, resourceObservation }) => {
      const reader = installFields([resourceObservation], error);
      reader.requireSettled();
      const action = reader.observe(value);
      if (reader.read(action, 'closeObserved') === true || !spawned) return { resourceId, settled: true, pending: false };
      const failure = reader.observe(error);
      if (failure.hasResourceObservation) return { resourceId, settled: true, pending: false };
      const result = reader.observe(reader.read(failure, 'result'));
      const termination = reader.observe(reader.read(result, 'termination'));
      const settled = reader.read(termination, 'closeObserved') === true
        && reader.read(termination, 'treeCleanupSettled') === true && reader.read(termination, 'treeCleanupFailed') === false;
      return { resourceId, settled, pending: !settled };
    } });
    const result = session.value.result;
    return { ok: result.exitCode === 0, status: result.exitCode ?? null, signal: result.signal || null,
      stdout: result.stdout || '', stderr: result.stderr || '', error: null,
      storage: { ...session.storage, settlement: { resourceId: session.resourceId, settled: true, pending: false } },
      settlement: { resourceId: session.resourceId, settled: true, pending: false } };
  } catch (error) {
    const original = observeStorageResource(error, { phase: 'tool-install-failure' }); original.requireSettled();
    const reader = installFields([original], original.primary);
    if (reader.read(original, 'cacheOwnershipPending')) throw error;
    const result = reader.observe(reader.read(original, 'result') || {}), projected = projectInstallResult(reader, result);
    return { ok: false, status: projected.exitCode ?? null, signal: projected.signal || null,
      stdout: projected.stdout, stderr: projected.stderr, error: original.primary,
      settlement: { settled: true, pending: false } };
  }
};
