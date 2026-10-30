import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, verifyContainedFileHandle } from '../contained-file.js';
import { isPathWithinRoot, isRootPath } from '../file-paths.js';
import { acquireStorageSession, isStorageSessionReleaseFailure } from './session.js';
import { addStorageFailureContext } from './operation-error.js';
import { describeStorageFailure, observeStorageResource } from './failure-observation.js';

const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
const observePending = error => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};
const diagnostic = (error, fallback) => {
  if (!error) return null;
  let code = fallback, message = fallback;
  try { const value = error.code; if (typeof value === 'string') code = value; } catch {}
  try { const value = error.message; if (typeof value === 'string') message = value; } catch {}
  return { code, message };
};

/** Native free-space observation, distinct from allocation or reclaimed bytes. */
export const inspectStorageFreeSpace = async ({ destination, requiredBytes = 0, minimumFreeBytes = 0 } = {}) => {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)
    || !Number.isSafeInteger(requiredBytes) || requiredBytes < 0
    || !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) throw new TypeError('Free-space inspection requires an absolute path and exact nonnegative budgets.');
  const target = path.resolve(destination);
  let observed = target;
  try {
    for (;;) {
      assertNoSymlinkPath(path.parse(observed).root, observed, { allowMissing: true });
      try { await fs.lstat(observed); break; }
      catch (error) {
        const parent = path.dirname(observed);
        const failure = describeStorageFailure(error, { phase: 'storage-free-space-ancestor' });
        if (failure.code !== 'ENOENT' || parent === observed) throw error;
        observed = parent;
      }
    }
    const stat = await fs.statfs(observed, { bigint: true });
    const observation = observeStorageResource(stat, { phase: 'storage-free-space-result' });
    observation.requireSettled();
    let blockBytes, available;
    try {
      const availableBlocks = stat.bavail;
      blockBytes = stat.bsize;
      if (typeof availableBlocks !== 'bigint' || typeof blockBytes !== 'bigint') throw new TypeError('Filesystem free-space accounting requires exact bigint fields.');
      available = availableBlocks * blockBytes;
    } catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
    observation.requireSettled();
    if (blockBytes <= 0n || available < 0n || available > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Filesystem free-space accounting is unsupported or outside exact range.');
    const availableBytes = Number(available);
    return { schemaVersion: 1, complete: true, destination: target, observedPath: observed,
      observedAt: new Date().toISOString(), availableBytes, requiredBytes, minimumFreeBytes,
      reserveSatisfied: available >= BigInt(requiredBytes) + BigInt(minimumFreeBytes),
      provenance: 'native-statfs-bavail-times-bsize', mutationPerformed: false,
      limitation: 'Observation is not a reservation; recheck before publication and handle disk-full failures.' };
  } catch (error) {
    const failure = describeStorageFailure(error, { phase: 'storage-free-space', defaultCode: 'ERR_STORAGE_SPACE_UNKNOWN' });
    return { schemaVersion: 1, complete: false, destination: target, observedPath: observed,
      observedAt: new Date().toISOString(), availableBytes: null, requiredBytes, minimumFreeBytes,
      reserveSatisfied: false, mutationPerformed: false,
      error: failure };
  }
};

/** Explicit, reversible destination probe. It does not adopt storage, move data,
 * create ownership markers, or modify a user's machine/project configuration.
 */
export const probeStorageDestination = async ({ destination, authorizedRoots = [], coordinationRoot,
  repoRoot = null, createDirectory = false } = {}) => {
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw new TypeError('Destination probe requires an absolute launch-selected category root.');
  const target = path.resolve(destination);
  if (isRootPath(target) || (repoRoot && isPathWithinRoot(target, path.resolve(repoRoot)))) throw new Error('Destination probe cannot grant machine storage authority inside a filesystem root or project.');
  const approved = authorizedRoots.find(root => isPathWithinRoot(target, path.resolve(root)));
  if (!approved) throw new Error('Destination probe is outside launch-authorized storage.');
  assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  const id = randomUUID();
  const session = acquireStorageSession({ roots: [target], coordinationRoot, authorizedRoots,
    scope: 'storage-destination-probe', resourceId: id });
  let handle = null;
  let identity = null;
  let createdDirectory = false;
  let probeFile = null;
  let operationError = null;
  let writeSucceeded = false, closed = false, released = false, reconciling = null, closeMethod = null, closeCaptureError = null;
  let fileCreated = false, probeRemoved = false;
  let observerOverflow = false;
  const cleanupFailures = [], observers = [], observed = new WeakSet();
  const retainObservation = error => {
    if (!error || observed.has(error) || isStorageSessionReleaseFailure(error, session)) return;
    observed.add(error);
    const observe = observePending(error);
    if (observe) { if (observers.length < 128) observers.push(observe); else observerOverflow = true; }
  };
  const resourcesSettled = () => (!handle || closed) && !observerOverflow && observers.every(observe => observe());
  const settled = () => released && resourcesSettled();
  const retainFailure = value => {
    const error = asError(value);
    // Bound diagnostic history without weakening the independent observations.
    // The original operation remains separately available on the receipt.
    if (cleanupFailures.length === 64) cleanupFailures.splice(1, 1);
    cleanupFailures.push(error);
    retainObservation(error);
    const pending = Object.assign(new Error('Destination probe cleanup remains pending.', { cause: error }), {
      cacheOwnershipPending: true, cacheOwnershipReleased: settled
    });
    return addStorageFailureContext(operationError || error, { storageDestinationProbeSession: recovery, storageSession: session }, pending,
      { nonEnumerable: ['storageDestinationProbeSession', 'storageSession'] });
  };
  const cleanup = async () => {
    if (settled()) return true;
    if (handle && !closed) {
      if (!closeMethod) throw closeCaptureError || new Error('Destination probe descriptor close owner is unavailable.');
      await closeMethod();
      closed = true;
    }
    if (!resourcesSettled()) throw new Error('Original destination probe resource observation remains pending.');
    if (fileCreated && !probeRemoved) {
      if (!identity) throw new Error('Destination probe file identity was not established; unsealed evidence is preserved.');
      assertNoSymlinkPath(path.parse(target).root, probeFile);
      const current = await fs.lstat(probeFile, { bigint: true });
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== 1n) {
        throw new Error('Probe file changed; replacement is preserved.');
      }
      await fs.unlink(probeFile);
      probeRemoved = true;
    }
    if (session.releaseAfterSettlement({ resourceId: id, settled: true, pending: false }) !== true) {
      throw new Error('Destination probe storage metadata release was not confirmed.');
    }
    released = true;
    return true;
  };
  const recovery = Object.freeze({ resourceId: id, releaseAfterClose: async () => {
    if (!reconciling) reconciling = cleanup().finally(() => { reconciling = null; });
    try { return await reconciling; }
    catch (error) { throw retainFailure(error); }
  } });
  try {
    try {
      const stat = await fs.lstat(target);
      if (!stat.isDirectory()) throw new Error('Storage destination is not a directory.');
    } catch (error) {
      if (error.code !== 'ENOENT' || !createDirectory) throw error;
      await fs.mkdir(target, { recursive: true });
      createdDirectory = true;
    }
    assertNoSymlinkPath(path.parse(target).root, target);
    const directoryIdentity = await fs.lstat(target, { bigint: true });
    probeFile = path.join(target, `.poc-storage-probe-${id}`);
    handle = await fs.open(probeFile, 'wx+', 0o600);
    fileCreated = true;
    try { const close = handle.close; if (typeof close !== 'function') throw new Error('Destination probe descriptor has no close owner.'); closeMethod = close.bind(handle); }
    catch (error) { closeCaptureError = asError(error); }
    const before = await handle.stat({ bigint: true });
    identity = { dev: before.dev, ino: before.ino };
    verifyContainedFileHandle(handle, target, probeFile);
    const openedDirectory = await fs.lstat(target, { bigint: true });
    if (openedDirectory.dev !== directoryIdentity.dev || openedDirectory.ino !== directoryIdentity.ino) throw new Error('Destination directory identity changed before probe write.');
    const payload = Buffer.from(`pairofcleats-storage-destination-probe:${id}`);
    await handle.writeFile(payload);
    await handle.sync();
    const read = Buffer.alloc(payload.length);
    const { bytesRead } = await handle.read(read, 0, read.length, 0);
    verifyContainedFileHandle(handle, target, probeFile);
    if (bytesRead !== payload.length || !read.equals(payload)) throw new Error('Destination probe read-back did not match its exact write.');
    writeSucceeded = true;
  } catch (value) { operationError = asError(value); retainObservation(operationError); }
  try { await recovery.releaseAfterClose(); } catch { /* The exact owner and all failures remain on the structured receipt. */ }
  const receipt = { schemaVersion: 1, destination: target, get writable() { return writeSucceeded && settled(); },
    observedAt: new Date().toISOString(), createdDirectory, mutationPerformed: true,
    get probeFileRemoved() { return probeRemoved; }, get cleanupPending() { return !settled(); }, get cacheOwnershipPending() { return !settled(); },
    get recoveryPath() { return settled() ? null : probeFile || coordinationRoot; },
    error: diagnostic(operationError, 'ERR_STORAGE_DESTINATION_PROBE'),
    get cleanupError() { return settled() ? null : diagnostic(cleanupFailures.at(-1), 'ERR_STORAGE_PROBE_CLEANUP'); },
    ownershipAdopted: false, configurationChanged: false };
  if (!settled()) Object.defineProperties(receipt, { storageSession: { value: session }, storageDestinationProbeSession: { value: recovery },
    operationError: { value: operationError }, cleanupFailures: { get: () => [...cleanupFailures] }, cacheOwnershipReleased: { value: settled } });
  return receipt;
};
