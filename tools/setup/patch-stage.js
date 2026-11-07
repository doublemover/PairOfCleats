import fs from 'node:fs';
import path from 'node:path';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { assertDirectoryIdentity } from '../../src/shared/io/directory-sync.js';
import { requireCheckoutMutationSession } from './checkout-mutation.js';

const sessions = new WeakSet(), failures = new WeakMap();
export const getPackagePatchStageSession = error => {
  const session = error && ['object', 'function'].includes(typeof error)
    ? failures.get(error) || readErrorDataProperty(error, 'patchStageSession') : null;
  return session && sessions.has(session) ? session : null;
};

/** One producer-owned staging directory. Original native-resource settlement
 * gates cleanup; directory-artifact retention is a separate observation and
 * never evidence that an outstanding Git child has retired.
 */
export const withPackagePatchStage = async (root, session, operation, { remove = fs.rmSync } = {}) => {
  requireCheckoutMutationSession(root, session);
  if (typeof operation !== 'function' || typeof remove !== 'function') throw new TypeError('Invalid package patch stage owner.');
  let parent = session.root;
  for (const part of ['.tmp', 'checkout-bootstrap', 'patches']) {
    parent = path.join(parent, part);
    try { fs.mkdirSync(parent); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Package patch staging requires regular owned directories.');
  }
  const stage = fs.mkdtempSync(path.join(parent, 'p-'));
  if (path.dirname(stage) !== parent) throw new Error('Package patch stage escaped its owned parent.');
  let identity;
  try {
    identity = fs.lstatSync(stage, { bigint: true });
    assertDirectoryIdentity(identity);
    if (typeof identity.ino !== 'bigint' || identity.ino === 0n || typeof identity.dev !== 'bigint') throw new Error(
      'Package patch staging requires an exact original directory identity.');
  } catch (error) {
    throw addStorageFailureContext(error, { recoveryPath: stage,
      patchStageCleanup: 'retained; original directory identity could not be admitted' });
  }
  const observations = createStorageObservationLedger(), cleanupErrors = [];
  let disposed = false;
  const cleanup = () => {
    if (disposed) return true;
    observations.requireSettled();
    let result, inspecting = true;
    try {
      const actual = fs.lstatSync(stage, { bigint: true });
      assertDirectoryIdentity(actual, identity);
      inspecting = false;
      result = remove(stage, { recursive: true, force: false });
    } catch (error) {
      observations.remember(error);
      if (cleanupErrors.length < 64) cleanupErrors.push(error); else observations.markIncomplete();
      try { observations.requireSettled(); }
      catch (pending) { throw addStorageFailureContext(error, { patchStageSession: actualSession, recoveryPath: stage }, pending,
        { secondaryPresent: true, nonEnumerable: ['patchStageSession'] }); }
      // ENOENT from an inner recursive removal is not proof that the stage
      // itself disappeared. Only this exact path's missing lstat admits it.
      if (inspecting && readErrorDataProperty(error, 'code') === 'ENOENT') { disposed = true; return true; }
      throw error;
    }
    if (result !== undefined) {
      observations.markIncomplete();
      throw Object.assign(new Error('Package patch stage removal did not confirm its standard void result.'), {
        code: 'ERR_PATCH_STAGE_CLEANUP_UNKNOWN', cacheOwnershipPending: true, cacheOwnershipReleased: observations.isSettled
      });
    }
    disposed = true; return true;
  };
  const actualSession = Object.freeze({ root: session.root, path: stage, cleanup, isDisposed: () => disposed,
    resourcesSettled: observations.isSettled, cleanupErrors: () => Object.freeze([...cleanupErrors]) });
  sessions.add(actualSession);
  let value, primary, failed = false;
  try { value = await operation(stage); }
  catch (error) { primary = error; failed = true; observations.remember(error); }
  try { cleanup(); }
  catch (cleanupError) {
    const error = failed ? addStorageFailureContext(primary, { patchStageSession: actualSession, recoveryPath: stage,
      patchStageCleanup: 'retained; original resources must settle before exact cleanup' }, cleanupError,
    { secondaryPresent: true, nonEnumerable: ['patchStageSession'] })
      : addStorageFailureContext(cleanupError, { patchStageSession: actualSession, recoveryPath: stage,
        patchStageCleanup: 'retained; exact cleanup remains unconfirmed' }, null, { nonEnumerable: ['patchStageSession'] });
    failures.set(error, actualSession); throw error;
  }
  if (failed) throw primary;
  return value;
};
