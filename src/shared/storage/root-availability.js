import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { describeStorageFailure, observeStorageResource } from './failure-observation.js';

const errorRecord = error => describeStorageFailure(error, { phase: 'storage-volume-observation',
  defaultCode: 'ERR_STORAGE_ROOT_AVAILABILITY' });

const observeFailureCode = error => {
  const observation = observeStorageResource(error, { phase: 'storage-root-classification' });
  observation.requireSettled();
  let code;
  try { code = observation.primary.code; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  return { code, observation };
};

const classifyObservedFailure = ({ code, observation }, volume) => {
  let status;
  try { if (code === 'ENOENT') status = volume?.status; }
  catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
  observation.requireSettled();
  if (code !== 'ENOENT') return { status: 'inaccessible', complete: false, absenceObserved: false, volume };
  if (status !== 'observed-directory') return { status: 'unavailable-or-offline', complete: false,
    absenceObserved: false, volume };
  return { status: 'missing', complete: true, absenceObserved: true, volume,
    consistency: 'missing-path-with-separately-observed-volume; not-a-filesystem-snapshot' };
};

/** An ENOENT for a registered root is not evidence that its drive/share is
 * online. Probe only the filesystem root, with no traversal or writes, before
 * reporting an observed missing path as zero bytes. This is an observation,
 * never mount continuity, ownership, writable-space or deletion authority.
 */
export const observeStorageVolume = async root => {
  const volume = path.parse(path.resolve(root)).root;
  try {
    assertNoSymlinkPath(volume, volume);
    const stat = await fs.lstat(volume, { bigint: true });
    if (!stat.isDirectory()) throw Object.assign(new Error('Storage volume root is not an ordinary directory.'), { code: 'ERR_STORAGE_VOLUME_TYPE' });
    return { path: volume, status: 'observed-directory', dev: String(stat.dev), ino: String(stat.ino),
      observedAt: new Date().toISOString(), mutationPerformed: false };
  } catch (error) { return { path: volume, status: 'unavailable-or-offline', error: errorRecord(error),
    observedAt: new Date().toISOString(), mutationPerformed: false }; }
};

/** Pure classification also serves failure-injection fixtures; serialized
 * observations confer no mutation authority anywhere in the storage owners.
 */
export const classifyStorageRootFailure = (error, volume = null) => classifyObservedFailure(observeFailureCode(error), volume);

export const inspectStorageRootFailure = async (root, error) => {
  const captured = observeFailureCode(error);
  let volume = null;
  try { if (captured.code === 'ENOENT') volume = await observeStorageVolume(root); }
  catch (inspection) { throw captured.observation.retain(inspection, { inspectionPresent: true }); }
  return classifyObservedFailure(captured, volume);
};
