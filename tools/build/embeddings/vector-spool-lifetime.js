import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNoSymlinkPath, verifyContainedFileHandle } from '../../../src/shared/contained-file.js';
import { createContainedFileResource, getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { observeStorageResource, describeStorageFailure } from '../../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

const failureOwners = new WeakMap();
const CHANNELS = new Set(['code', 'doc', 'merged']);
const sameObject = (left, right) => left && right && left.dev === right.dev && left.ino === right.ino;
const hasObjectIdentity = stat => typeof stat?.dev === 'bigint' && stat.dev >= 0n && typeof stat.ino === 'bigint' && stat.ino > 0n;

/** The original mkdtemp allocation and opened handles grant this attempt's
 * scratch authority. Paths, prefixes or serialized errors cannot reconstruct it.
 * Native close/recovery stays with the existing contained-file descriptor owner. */
export const allocateVectorSpoolLifetime = async (parentDir, drain) => {
  if (typeof drain !== 'function') throw new TypeError('Vector spool requires its original accepted-work drain.');
  parentDir = path.resolve(parentDir);
  assertNoSymlinkPath(parentDir, parentDir);
  const allocated = await fs.mkdtemp(path.toNamespacedPath(path.join(parentDir, '.stage3-vector-spool-')));
  const directory = path.join(parentDir, path.basename(allocated));
  const files = new Map(), observations = new Map();
  let directoryIdentity = null, removed = false, retiring = false, overflow = false, closing = null, initialClose = null;
  let metadataObservation = null, draining = null, owner;
  const remember = error => {
    if (failureOwners.get(error) === owner || observations.has(error)) return;
    const observation = observeStorageResource(error, { phase: 'vector-spool-original-work' });
    if (!observation.hasResourceObservation) return;
    if (observations.size === 128) { overflow = true; return; }
    observations.set(error, observeStorageResource(observation.retain(), { phase: 'vector-spool-original-work' }));
  };
  const isSettled = () => {
    try { return removed && !overflow && [...files.values()].every(file => file.resource.isSettled())
      && [...observations.values()].every(observation => observation.isSettled())
      && (!metadataObservation || metadataObservation.isSettled()); }
    catch { return false; }
  };
  const retain = (primary, secondary = []) => {
    let error = addStorageFailureContext(primary, { vectorSpoolLifetime: owner, vectorSpoolPath: directory,
      cacheOwnershipPending: true, cacheOwnershipReleased: isSettled }, undefined,
    { forceAggregate: true, nonEnumerable: ['vectorSpoolLifetime'] });
    for (const value of secondary) error = addStorageFailureContext(error, {}, value, { secondaryPresent: true });
    failureOwners.set(error, owner); return error;
  };
  const removeFiles = async () => {
    metadataObservation?.requireSettled();
    assertNoSymlinkPath(parentDir, directory, { allowMissing: true });
    let current;
    try { current = await fs.lstat(directory, { bigint: true }); }
    catch (error) {
      if (describeStorageFailure(error, { phase: 'vector-spool-directory' }).code !== 'ENOENT') throw error;
      removed = true; return;
    }
    if (!directoryIdentity || !current.isDirectory() || !sameObject(current, directoryIdentity)) {
      throw new Error('Original vector spool directory identity changed or was not observed.');
    }
    for (const file of files.values()) {
      if (file.removed) continue;
      assertNoSymlinkPath(parentDir, file.path, { allowMissing: true });
      let stat;
      try { stat = await fs.lstat(file.path, { bigint: true }); }
      catch (error) {
        if (describeStorageFailure(error, { phase: 'vector-spool-file' }).code !== 'ENOENT') throw error;
        file.removed = true; continue;
      }
      if (!stat.isFile() || stat.nlink !== 1n || !sameObject(stat, file.identity)) throw new Error('Original vector spool file changed or is shared.');
      await fs.unlink(file.path); file.removed = true;
    }
    // Unknown files/children keep the exact directory nonempty and protected.
    assertNoSymlinkPath(parentDir, directory);
    if (!sameObject(await fs.lstat(directory, { bigint: true }), directoryIdentity)) throw new Error('Vector spool directory changed before retirement.');
    await fs.rmdir(directory); removed = true;
  };
  const settle = async explicit => {
    retiring = true;
    if (isSettled()) return;
    const errors = [];
    if (!draining) draining = Promise.resolve().then(() => drain());
    try { await draining; } catch (error) { remember(error); throw retain(error); }
    const nativeResults = await Promise.allSettled([...files.values()].map(async file => {
      if (file.resource.isSettled()) return;
      try {
        if (file.recovery) {
          if (!explicit) throw file.failure;
          await file.recovery.release.call(file.recovery.session);
        } else await file.resource.run(() => {});
      } catch (error) {
        // Earlier work may have failed even though this exact descriptor and
        // all independent observations now confirm physical closure.
        if (!file.resource.isSettled()) {
          file.failure = error;
          const session = getContainedFileSession(error);
          if (session && !file.recovery) file.recovery = { session, release: session.releaseAfterClose };
          throw error;
        }
      }
    }));
    for (const result of nativeResults) if (result.status === 'rejected') errors.push(result.reason);
    try {
      if (overflow) throw new Error('Vector spool observation budget remains unresolved.');
      for (const observation of observations.values()) observation.requireSettled();
    } catch (error) { errors.push(error); }
    if (!errors.length) try { await removeFiles(); }
    catch (error) {
      metadataObservation = observeStorageResource(observeStorageResource(error, { phase: 'vector-spool-retirement' }).retain(),
        { phase: 'vector-spool-retirement' });
      errors.push(error);
    }
    if (errors.length) throw retain(errors[0], errors.slice(1));
  };
  owner = Object.freeze({ directory, isSettled, remember, retain,
    async open(channel) {
      if (retiring || !CHANNELS.has(channel) || files.has(channel)) throw new TypeError('Vector spool channel admission is invalid or retired.');
      const filename = path.join(directory, `${channel}.uint8`);
      assertNoSymlinkPath(parentDir, filename, { allowMissing: true });
      const handle = await fs.open(filename, 'wx+', 0o600);
      const resource = createContainedFileResource({ handle, sync: false, additionalMethods: ['write', 'sync', 'truncate'] });
      const file = { path: filename, resource, identity: null, recovery: null, removed: false, failure: null };
      files.set(channel, file);
      const identity = await resource.operations.stat({ bigint: true });
      if (!identity.isFile() || identity.nlink !== 1n || !hasObjectIdentity(identity)) throw new Error('Vector spool channel lacks an exact ordinary file identity.');
      file.identity = identity;
      resource.inspect(() => verifyContainedFileHandle(handle, parentDir, filename));
      return Object.freeze({ handle, resource, operations: resource.operations, filename });
    },
    close() {
      if (!initialClose) initialClose = settle(false);
      return isSettled() ? Promise.resolve() : initialClose;
    },
    recoverAfterClose() {
      if (!closing) closing = (async () => {
        if (initialClose) await initialClose.catch(() => {});
        await settle(true);
        return Object.freeze({ settled: isSettled(), pending: !isSettled() });
      })().finally(() => { closing = null; });
      return closing;
    }
  });
  try {
    const identity = await fs.lstat(directory, { bigint: true });
    if (!identity.isDirectory() || !hasObjectIdentity(identity)) throw new Error('Allocated vector spool lacks its original directory identity.');
    directoryIdentity = identity;
  } catch (error) { remember(error); throw retain(error); }
  return owner;
};
