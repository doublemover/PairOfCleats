import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, verifyContainedFileHandle } from '../contained-file.js';
import { isPathWithinRoot, isRootPath } from '../file-paths.js';
import { acquireStorageSession } from './session.js';

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
        if (error.code !== 'ENOENT' || parent === observed) throw error;
        observed = parent;
      }
    }
    const stat = await fs.statfs(observed, { bigint: true });
    const available = stat.bavail * stat.bsize;
    if (stat.bsize <= 0n || available < 0n || available > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Filesystem free-space accounting is unsupported or outside exact range.');
    const availableBytes = Number(available);
    return { schemaVersion: 1, complete: true, destination: target, observedPath: observed,
      observedAt: new Date().toISOString(), availableBytes, requiredBytes, minimumFreeBytes,
      reserveSatisfied: available >= BigInt(requiredBytes) + BigInt(minimumFreeBytes),
      provenance: 'native-statfs-bavail-times-bsize', mutationPerformed: false,
      limitation: 'Observation is not a reservation; recheck before publication and handle disk-full failures.' };
  } catch (error) {
    return { schemaVersion: 1, complete: false, destination: target, observedPath: observed,
      observedAt: new Date().toISOString(), availableBytes: null, requiredBytes, minimumFreeBytes,
      reserveSatisfied: false, mutationPerformed: false,
      error: { code: error.code || 'ERR_STORAGE_SPACE_UNKNOWN', message: error.message } };
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
  let cleanupError = null;
  let resourceSettled = true;
  let probeRemoved = false;
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
  } catch (error) { operationError = error; }
  finally {
    if (handle) await handle.close().catch(error => { cleanupError = error; resourceSettled = false; });
    if (probeFile && identity) {
      try {
        assertNoSymlinkPath(path.parse(target).root, probeFile);
        const current = await fs.lstat(probeFile, { bigint: true });
        if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino || current.nlink !== 1n) {
          throw new Error('Probe file changed; replacement is preserved.');
        }
        await fs.unlink(probeFile);
        probeRemoved = true;
      } catch (error) { cleanupError = error; }
    }
    // All writes are local file operations with settled callbacks and closed
    // handles; a failed unlink is retained evidence, not a running writer.
    if (resourceSettled) session.releaseAfterSettlement({ resourceId: id, settled: true, pending: false });
  }
  const receipt = { schemaVersion: 1, destination: target, writable: !operationError,
    observedAt: new Date().toISOString(), createdDirectory, mutationPerformed: true,
    probeFileRemoved: probeRemoved, cleanupPending: Boolean(cleanupError), cacheOwnershipPending: !resourceSettled,
    recoveryPath: cleanupError ? probeFile : null,
    error: operationError ? { code: operationError.code || 'ERR_STORAGE_DESTINATION_PROBE', message: operationError.message } : null,
    cleanupError: cleanupError ? { code: cleanupError.code || 'ERR_STORAGE_PROBE_CLEANUP', message: cleanupError.message } : null,
    ownershipAdopted: false, configurationChanged: false };
  if (!resourceSettled) Object.defineProperty(receipt, 'storageSession', { value: session });
  return receipt;
};
