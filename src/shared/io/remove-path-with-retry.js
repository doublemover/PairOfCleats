import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { observeStorageResource } from '../storage/failure-observation.js';
import { readPersistenceFailureCode, retainPersistenceFailure } from './persistence-helpers.js';
import { persistenceDirectoryIdentity, assertPersistenceDirectoryIdentity } from './directory-identity.js';

export const RETRYABLE_REMOVE_ERROR_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE', 'EAGAIN']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unknown = message => Object.assign(new Error(message), { cacheOwnershipPending: true });
const changed = () => Object.assign(new Error('Removal path no longer identifies its admitted original object.'), { code: 'ERR_REMOVE_PATH_CHANGED' });
const identity = stat => {
  if (!stat || typeof stat !== 'object' || !['dev', 'ino', 'mode'].every(field => typeof stat[field] === 'bigint') || stat.ino === 0n) throw Object.assign(
    new Error('Removal cannot establish the original native path identity.'), { code: 'ERR_REMOVE_PATH_IDENTITY_UNAVAILABLE' });
  return Object.freeze({ dev: String(stat.dev), ino: String(stat.ino), mode: String(stat.mode),
    birthtime: String(stat.birthtimeNs ?? stat.birthtimeMs) });
};

/** Bounded removal of a caller-authorized path. This is not a lease or cleanup
 * authority. Native retries compare the admitted root/parent; injected exists
 * adapters retain their legacy synchronous boolean contract, not native proof.
 *
 * @param {string} targetPath
 * @param {{recursive?:boolean,force?:boolean,attempts?:number,baseDelayMs?:number,maxDelayMs?:number,
 *   rm?:(path:string,options:{recursive:boolean,force:boolean})=>Promise<void>,
 *   exists?:(path:string)=>boolean}} [options]
 * @returns {Promise<{ok:boolean,attempts:number,error:Error|null}>}
 */
export const removePathWithRetry = async (targetPath, options = {}) => {
  const { recursive = true, force = true, attempts = 12, baseDelayMs = 25, maxDelayMs = 1000,
    rm = fsPromises.rm, exists = null } = options;
  const maxAttempts = Number.isFinite(Number(attempts)) ? Math.max(1, Math.floor(Number(attempts))) : 12;
  const delayFloor = Number.isFinite(Number(baseDelayMs)) ? Math.max(1, Math.floor(Number(baseDelayMs))) : 25;
  const delayCap = Number.isFinite(Number(maxDelayMs)) ? Math.max(delayFloor, Math.floor(Number(maxDelayMs))) : 1000;
  const lstat = fs.lstatSync, operationPath = exists === null ? path.resolve(targetPath) : targetPath;
  const parentPath = path.dirname(path.resolve(operationPath));
  const observations = [], failures = [];
  let count = 0, originalIdentity = null, parentIdentity = null, overflow = false;
  let primaryPresent = false, primary;
  const overflowFailure = unknown('Removal prerequisite history exceeded its bounded limit.');
  const remember = (error, phase) => {
    if (observations.length === 128) { overflow = true; return; }
    failures.push(error); observations.push(observeStorageResource(error, { phase }));
  };
  const requireSettled = () => {
    if (overflow) throw overflowFailure;
    for (const observation of observations) observation.requireSettled();
  };
  const failed = (error, phase) => {
    remember(error, phase);
    const selected = primaryPresent ? primary : error;
    return { ok: false, attempts: count, error: retainPersistenceFailure(selected, [
      ...[...new Set(failures)].filter(value => value !== selected),
      ...observations.map(observation => observation.retain()), ...(overflow ? [overflowFailure] : [])
    ], { removalPath: targetPath, removalResolvedPath: operationPath, removalAttempts: count, removalFailurePhase: phase }) };
  };
  const probe = () => {
    requireSettled();
    if (exists !== null) {
      const result = exists(targetPath);
      if (typeof result !== 'boolean') {
        // A malformed async adapter is not an absence witness. Observe rejection
        // for host hygiene only; no settlement authority is inferred from it.
        if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
        throw unknown('Removal existence adapter did not return a synchronous boolean.');
      }
      requireSettled(); return result;
    }
    let current;
    try { current = lstat.call(fs, operationPath, { bigint: true }); }
    catch (error) {
      remember(error, 'remove-path-probe'); requireSettled();
      const code = readPersistenceFailureCode(error); requireSettled();
      if (code === 'ENOENT') {
        if (parentIdentity) assertPersistenceDirectoryIdentity(lstat.call(fs, parentPath, { bigint: true }), parentIdentity);
        requireSettled(); return false;
      }
      throw error;
    }
    const currentIdentity = identity(current), parentStat = lstat.call(fs, parentPath, { bigint: true });
    requireSettled();
    if (!originalIdentity) {
      originalIdentity = currentIdentity; parentIdentity = persistenceDirectoryIdentity(parentStat);
    } else {
      if (Object.keys(originalIdentity).some(key => originalIdentity[key] !== currentIdentity[key])) throw changed();
      assertPersistenceDirectoryIdentity(parentStat, parentIdentity);
    }
    requireSettled(); return true;
  };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try { if (!probe()) return { ok: true, attempts: count, error: null }; }
    catch (error) { return failed(error, 'remove-path-before-native'); }
    let rejected = false, error;
    try {
      requireSettled(); count++;
      if (await rm(operationPath, { recursive, force }) !== undefined) throw unknown('Removal did not confirm its standard void result.');
      requireSettled();
    } catch (value) {
      rejected = true; error = value; primaryPresent = true; primary = value; remember(value, 'remove-path-native');
    }
    if (rejected) {
      try {
        requireSettled(); const code = readPersistenceFailureCode(error); requireSettled();
        if (code === 'ENOENT') {
          if (!probe()) return { ok: true, attempts: count, error: null };
          return failed(error, 'remove-path-still-present');
        }
        if (!RETRYABLE_REMOVE_ERROR_CODES.has(code) || attempt === maxAttempts - 1) return failed(error, 'remove-path-failed');
      } catch (inspection) { return failed(inspection, 'remove-path-classification'); }
    } else {
      try { if (!probe()) return { ok: true, attempts: count, error: null }; }
      catch (inspection) { return failed(inspection, 'remove-path-after-native'); }
    }
    if (attempt < maxAttempts - 1) await sleep(Math.min(delayCap, delayFloor * (attempt + 1)));
  }
  return failed(new Error('Failed to remove path: ' + targetPath), 'remove-path-exhausted');
};
