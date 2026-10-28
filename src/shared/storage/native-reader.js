import path from 'node:path';
import { resolveRepoCacheRootPath } from '../repo-paths.js';
import { isPathWithinRoot } from '../file-paths.js';
import { acquireRepoStorageSession } from './repository-session.js';
import { isStorageSessionReleaseFailure } from './session.js';
import { observeStorageResource } from './failure-observation.js';
import { addStorageFailureContext } from './operation-error.js';
import { getApplicationHome, getCacheRoot } from '../cache-roots.js';
import { resolveConfiguredNativeReaderSelection, acquireConfiguredNativeReaderSession } from './configured-native-reader.js';

const pending = new Set();
const registered = new WeakMap(), knownOwners = new WeakSet();
const identity = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const scopeKey = (target, coordinationRoot) => `${identity(coordinationRoot)}\0${identity(target)}`;
const selectedRepoRoot = context => resolveRepoCacheRootPath(context.repoRoot, context.userConfig, {
  getCacheRoot: () => getCacheRoot({ env: context.env || process.env })
});
const validateContext = context => {
  if (typeof context.repoRoot !== 'string' || !path.isAbsolute(context.repoRoot)
    || !context.userConfig || typeof context.userConfig !== 'object' || Array.isArray(context.userConfig)
    || context.env !== undefined && (!context.env || typeof context.env !== 'object' || Array.isArray(context.env))) {
    throw new TypeError('Native reader storage requires its explicit repository, effective configuration and launch environment.');
  }
  const configured = context.userConfig.cache?.root || null;
  if (configured !== null && (typeof configured !== 'string' || !path.isAbsolute(configured))) {
    throw Object.assign(new Error('Native reader requires its effective absolute cache root.'), { code: 'ERR_INDEX_STORAGE_SELECTION' });
  }
};
export const getPendingNativeStorageReaders = () => Object.freeze([...pending]);

/** Cache reuse retains one lease set per actual native object and selected
 * launch namespace, rather than adding metadata and hooks on every request.
 */
export const findNativeReaderStorage = (resource, target, context) => {
  if (!context) return null;
  validateContext(context);
  const repoRoot = selectedRepoRoot(context);
  if (!isPathWithinRoot(target, repoRoot) && !resolveConfiguredNativeReaderSelection(target, context)) return null;
  const coordination = path.join(getApplicationHome({ env: context.env || process.env }), 'state', 'storage-access');
  const scopes = registered.get(resource), owner = scopes?.get(scopeKey(target, coordination));
  if (!owner && scopes?.size >= 64) throw new Error('Native reader launch-namespace budget exceeded.');
  return owner || null;
};
export const registerNativeReaderStorage = (resource, owner) => {
  if (!knownOwners.has(owner) || !resource || !['object', 'function'].includes(typeof resource)) {
    throw new TypeError('Native storage registration requires its original resource and admission owner.');
  }
  let scopes = registered.get(resource);
  if (!scopes) { scopes = new Map(); registered.set(resource, scopes); }
  const key = scopeKey(owner.target, owner.session.coordinationRoot);
  if (!scopes.has(key) && scopes.size >= 64) throw new Error('Native reader launch-namespace budget exceeded.');
  if (scopes.has(key) && scopes.get(key) !== owner) throw new Error('Native resource already has its original launch admission.');
  scopes.set(key, owner);
};

/** Protect actual canonical storage or an explicitly selected backend namespace.
 * Configured external readers acquire lifetime leases, never deletion authority.
 * Unregistered roots retain their existing report-only cleanup protection.
 */
export const acquireNativeReaderStorage = (target, storageContext, nativeSettled) => {
  if (!storageContext) return null;
  validateContext(storageContext);
  if (typeof nativeSettled !== 'function' || typeof target !== 'string' || !path.isAbsolute(target)) {
    throw new TypeError('Native reader storage requires an absolute selected path and original settlement owner.');
  }
  const repoCacheRoot = selectedRepoRoot(storageContext);
  const admission = isPathWithinRoot(target, repoCacheRoot)
    ? acquireRepoStorageSession(repoCacheRoot, storageContext, { scope: 'native-index-reader', resourceRoots: [target] })
    : acquireConfiguredNativeReaderSession(target, storageContext);
  if (!admission) return null;
  const observations = new Map(), failures = [], described = new WeakSet();
  let started = false, attempted = false, released = false, overflow = false, owner;
  const captureObservation = (value, phase) => observeStorageResource(
    observeStorageResource(value, { phase }).retain(), { phase });
  // The existing composer records independently thrown observer errors even
  // when a caller only asks for a boolean settlement observation.
  const nativeObservation = captureObservation(Object.freeze({ cacheOwnershipPending: true,
    cacheOwnershipReleased: () => !started || nativeSettled() === true }), 'native-reader-original-close');
  const resourceClosed = () => nativeObservation.isSettled();
  const originalsSettled = () => !overflow && [...observations.values()].every(observe => observe.isSettled());
  const isSettled = () => {
    try { return released && resourceClosed() && originalsSettled(); } catch { return false; }
  };
  const retain = error => {
    if (!described.has(error) && !failures.includes(error)) {
      if (failures.length === 128) overflow = true;
      else {
        failures.push(error);
        if (!isStorageSessionReleaseFailure(error, admission.session)) {
          observations.set(error, captureObservation(error, 'native-reader-storage'));
        }
      }
    }
    const primary = failures.length ? failures[0] : error;
    let failure = addStorageFailureContext(primary, { nativeStorageOwner: owner,
      cacheOwnershipPending: true, cacheOwnershipReleased: isSettled }, null,
    { forceAggregate: true, nonEnumerable: ['nativeStorageOwner'] });
    for (const secondary of failures.slice(1)) failure = addStorageFailureContext(failure, {}, secondary,
      { secondaryPresent: true, forceAggregate: true });
    described.add(failure);
    return failure;
  };
  owner = Object.freeze({ kind: 'native-index-reader', target, session: admission.session, isSettled,
    selection: admission.selection || null,
    start() {
      if (attempted || released) throw new Error('Native reader admission cannot be reused.');
      attempted = true;
      try { admission.revalidate(); started = true; }
      catch (error) { throw retain(error); }
    },
    retainFailure: retain,
    failedOpen(error) {
      const observation = observeStorageResource(error, { phase: 'native-reader-open' });
      try { observation.requireSettled(); }
      catch (inspection) { throw retain(observation.retain(inspection, { inspectionPresent: true })); }
      started = false;
      try { owner.releaseAfterClosure(); }
      catch (cleanup) { throw addStorageFailureContext(error, {}, cleanup, { secondaryPresent: true, forceAggregate: true }); }
    },
    releaseAfterClosure() {
      if (released) return true;
      try {
        for (const observation of observations.values()) observation.requireSettled();
        if (overflow || !resourceClosed()) throw Object.assign(new Error('Original native reader closure remains unconfirmed.'),
          { code: 'ERR_NATIVE_STORAGE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: () => resourceClosed() });
        admission.session.releaseAfterSettlement({ resourceId: admission.session.resourceId, settled: true, pending: false });
        released = true; pending.delete(owner); return true;
      } catch (error) { throw retain(error); }
    }
  });
  knownOwners.add(owner);
  pending.add(owner);
  return owner;
};
