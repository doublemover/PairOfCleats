import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { assertNoSymlinkPath, readVerifiedContainedFile, getContainedFileSession } from '../contained-file.js';
import { isPathWithinRoot } from '../file-paths.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../locks/file-lock.js';
import { createLockPayload } from '../locks/file-lock-info.js';
import { getFileLockReleaseFailureObservation } from '../locks/file-lock-producer-observations.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { inspectStorageFreeSpace } from './destination.js';
import { inspectStorageInventory } from './inventory.js';
import { withStorageDirectory, getStorageDirectorySession } from './directory.js';
import { observeStorageResource } from './failure-observation.js';
import { addStorageFailureContext } from './operation-error.js';

const admissionFailures = new WeakMap();
/** Exact producer association; copied fields and matching IDs grant no owner. */
export const getStorageWriteAdmissionFailure = error => error !== null && ['object', 'function'].includes(typeof error)
  ? admissionFailures.get(error) || null : null;

const exact = (value, field) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Storage admission requires exact nonnegative ${field}.`);
  return value;
};
const fail = (reason, details = {}) => Object.assign(new Error(`Storage write admission deferred: ${reason}`), {
  code: 'ERR_STORAGE_ADMISSION', admission: 'defer-or-deny-before-write', reason, ...details
});
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameRootScope = (left, right) => isPathWithinRoot(left, right) || isPathWithinRoot(right, left);
const reservationKeys = ['schemaVersion', 'kind', 'hostname', 'scope', 'resourceId', 'pid', 'lockId', 'startedAt',
  'root', 'device', 'requiredBytes', 'minimumFreeBytes', 'hardBytes', 'measuredBytes', 'metric', 'id'].sort().join(',');
const readReservation = async file => {
  const read = await readVerifiedContainedFile(path.parse(file).root, file, { maxBytes: 64 * 1024 });
  // Default Stats numeric inode values can round native Windows file IDs.
  // The verified reader already captured exact BigInt descriptor identity.
  const fileIdentity = read.fileIdentity;
  if (!fileIdentity || !['dev', 'ino'].every(key => typeof fileIdentity[key] === 'string' && /^\d+$/u.test(fileIdentity[key]))) {
    throw fail('write-reservation-file-identity-unknown');
  }
  return { value: JSON.parse(read.buffer.toString('utf8')), hash: read.hash, stat: read.stat, fileIdentity };
};
const reservations = async directory => {
  const entries = [];
  let opened = false;
  try {
    return await withStorageDirectory(directory, async iterator => {
      opened = true;
      for (;;) {
        const entry = await iterator.read();
        if (!entry) break;
        if (entries.length >= 10000 || !entry.isFile() || !/^[a-f0-9-]{36}\.json$/u.test(entry.name)) throw fail('unknown-or-incomplete-reservation-inventory');
        const file = path.join(directory, entry.name);
        const current = await readReservation(file);
        const value = current.value;
        if (value?.schemaVersion !== 1 || value.kind !== 'pairofcleats-storage-write-reservation'
          || Object.keys(value).sort().join(',') !== reservationKeys || value.id !== entry.name.slice(0, -5)
          || value.hostname !== os.hostname() || !Number.isSafeInteger(value.pid) || value.pid <= 0
          || typeof value.resourceId !== 'string' || !value.resourceId || typeof value.lockId !== 'string' || !value.lockId
          || value.scope !== 'storage-write-reservation' || value.metric !== 'unique-logical-file-bytes'
          || typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt))
          || typeof value.root !== 'string' || !path.isAbsolute(value.root) || !/^\d+$/u.test(value.device)
          || !Number.isSafeInteger(value.requiredBytes) || value.requiredBytes < 0
          || !Number.isSafeInteger(value.minimumFreeBytes) || value.minimumFreeBytes < 0
          || (value.hardBytes !== null && (!Number.isSafeInteger(value.hardBytes) || value.hardBytes < 0))
          || (value.measuredBytes !== null && (!Number.isSafeInteger(value.measuredBytes) || value.measuredBytes < 0))) throw fail('unreadable-or-foreign-write-reservation');
        // Dead parent PID does not settle a possibly surviving managed child.
        entries.push({ file, ...current });
      }
      return entries;
    });
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'storage-reservation-inventory' });
    observation.requireSettled();
    if (opened) throw observation.primary;
    let code;
    try { code = observation.primary.code; }
    catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
    observation.requireSettled();
    if (code === 'ENOENT') return [];
    throw observation.primary;
  }
};

/** Cooperative admission before writes. This reserves declared estimates among
 * adopted callers, not filesystem capacity against unrelated applications.
 * Unknown budgets, allocation or pending ownership never trigger eviction.
 */
export const acquireStorageWriteReservation = async ({ root, resourceId, coordinationRoot, authorizedRoots = [],
  requiredBytes, minimumFreeBytes = 0, hardBytes = null, maxEntries = 100000, maxDurationMs = 10000,
  freeSpaceOwner = inspectStorageFreeSpace } = {}) => {
  exact(requiredBytes, 'requiredBytes'); exact(minimumFreeBytes, 'minimumFreeBytes');
  if (hardBytes !== null) exact(hardBytes, 'hardBytes');
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof coordinationRoot !== 'string' || !path.isAbsolute(coordinationRoot)
    || typeof resourceId !== 'string' || !resourceId || resourceId.length > 256 || typeof freeSpaceOwner !== 'function') throw fail('explicit-resource-and-coordination-owner-required');
  root = path.resolve(root); coordinationRoot = path.resolve(coordinationRoot);
  for (const target of [root, coordinationRoot]) {
    if (!authorizedRoots.some(approved => isPathWithinRoot(target, path.resolve(approved)))) throw fail('outside-launch-authorized-storage');
    assertNoSymlinkPath(path.parse(target).root, target, { allowMissing: true });
  }
  const directory = path.join(coordinationRoot, 'write-reservations');
  const lockPath = path.join(coordinationRoot, 'write-admission.lock');
  const lock = await acquireFileLock({ lockPath, waitMs: 0, staleMs: Number.MAX_SAFE_INTEGER,
    metadata: { scope: 'storage-write-admission', hostname: os.hostname(), resourceId } });
  if (!lock) throw fail('admission-owner-busy');
  let admissionLock = lock;
  let admittedReservation = null;
  let reservationSettled = false;
  let admissionError = null;
  let originalObserver = () => true;
  try {
    assertNoSymlinkPath(path.parse(directory).root, directory, { allowMissing: true });
    const pending = await reservations(directory);
    const freeResponse = await freeSpaceOwner({ destination: root, requiredBytes, minimumFreeBytes });
    const freeObservation = observeStorageResource(freeResponse, { phase: 'storage-write-free-space' });
    freeObservation.requireSettled();
    let free;
    try { free = Object.freeze({ complete: freeResponse?.complete, availableBytes: freeResponse?.availableBytes,
      observedPath: freeResponse?.observedPath }); }
    catch (inspection) { throw freeObservation.retain(inspection, { inspectionPresent: true, inspectionPrimary: true }); }
    freeObservation.requireSettled();
    if (free?.complete !== true || !Number.isSafeInteger(free.availableBytes) || free.availableBytes < 0
      || typeof free.observedPath !== 'string' || !path.isAbsolute(free.observedPath)) throw fail('free-space-accounting-unknown');
    if (!isPathWithinRoot(root, free.observedPath)) throw fail('free-space-observation-does-not-belong-to-destination');
    assertNoSymlinkPath(path.parse(free.observedPath).root, free.observedPath);
    const observed = await fs.lstat(free.observedPath, { bigint: true });
    freeObservation.requireSettled();
    const device = String(observed.dev);
    const reservedDeviceBytes = pending.filter(entry => entry.value.device === device)
      .reduce((sum, entry) => sum + BigInt(entry.value.requiredBytes), 0n);
    const reservedRootBytes = pending.filter(entry => sameRootScope(entry.value.root, root))
      .reduce((sum, entry) => sum + BigInt(entry.value.requiredBytes), 0n);
    const reserveFloor = pending.filter(entry => entry.value.device === device)
      .reduce((floor, entry) => BigInt(entry.value.minimumFreeBytes) > floor ? BigInt(entry.value.minimumFreeBytes) : floor, BigInt(minimumFreeBytes));
    const needed = BigInt(requiredBytes) + reserveFloor + reservedDeviceBytes;
    if (BigInt(free.availableBytes) < needed) throw fail('minimum-free-space-or-pending-reservations', {
      availableBytes: free.availableBytes, requiredBytes, minimumFreeBytes, pendingReservedBytesExact: String(reservedDeviceBytes)
    });
    let measuredBytes = null;
    if (hardBytes !== null) {
      const inventory = await inspectStorageInventory({ roots: [{ id: 'write-admission', path: root }], maxEntries, maxDurationMs });
      measuredBytes = inventory.totals.uniqueLogicalBytes;
      if (!inventory.complete || !Number.isSafeInteger(measuredBytes)) throw fail('hard-budget-inventory-incomplete');
      if (BigInt(measuredBytes) + reservedRootBytes + BigInt(requiredBytes) > BigInt(hardBytes)) {
        throw fail('hard-logical-budget-would-be-exceeded', { measuredBytes, requiredBytes, hardBytes });
      }
    }
    freeObservation.requireSettled();
    await fs.mkdir(directory, { recursive: true });
    assertNoSymlinkPath(path.parse(directory).root, directory);
    const id = randomUUID();
    const file = path.join(directory, `${id}.json`);
    const value = { schemaVersion: 1, kind: 'pairofcleats-storage-write-reservation', ...createLockPayload({
      hostname: os.hostname(), scope: 'storage-write-reservation', resourceId }), root, device,
    requiredBytes, minimumFreeBytes, hardBytes, measuredBytes, metric: 'unique-logical-file-bytes', id };
    freeObservation.requireSettled();
    await atomicWriteJson(file, value, { mkdir: false, createOnly: true });
    const sealed = await readReservation(file);
    if (digest(sealed.value) !== digest(value) || Number(sealed.stat.nlink) !== 1) throw fail('write-reservation-publication-changed');
    let released = false;
    let removed = false;
    let releasing = null;
    let settlementLock = null;
    const settlementErrors = [], settlementSeen = new WeakMap(), settlementFailures = new WeakSet();
    const settlementPrerequisites = new WeakMap();
    let settlementOverflow = false;
    const rememberSettlement = value => {
      const objectLike = value !== null && ['object', 'function'].includes(typeof value);
      if (objectLike && settlementFailures.has(value)) return value;
      if (objectLike && settlementSeen.has(value)) return settlementSeen.get(value);
      if (settlementErrors.length >= 128) {
        settlementOverflow = true;
        return settlementErrors[0];
      }
      const retained = observeStorageResource(value, { phase: 'storage-write-settlement' }).retain();
      // The exact coordinator owner may retry metadata release once its own
      // captured prerequisites settle. Its outward failure still includes the
      // metadata session, which cannot be an internal prerequisite to itself.
      const independent = getFileLockReleaseFailureObservation(value, settlementLock);
      if (independent) settlementPrerequisites.set(retained, independent);
      settlementErrors.push(retained); if (objectLike) settlementSeen.set(value, retained);
      return retained;
    };
    const settlementResourcesSettled = () => !settlementOverflow && settlementErrors.every(error => {
      const independent = settlementPrerequisites.get(error);
      if (independent) return independent() === true;
      const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased').value;
      return observe.call(error) === true;
    });
    const settlementFailure = (preferred = null) => {
      let error = preferred === null ? settlementErrors[0] || fail('reservation-settlement-unconfirmed') : preferred;
      for (const secondary of settlementErrors) if (secondary !== error) {
        error = addStorageFailureContext(error, {}, secondary, { secondaryPresent: true });
      }
      const files = [], directories = [];
      for (const original of settlementErrors) {
        const fileSession = getContainedFileSession(original), directorySession = getStorageDirectorySession(original);
        if (fileSession && !files.includes(fileSession)) files.push(fileSession);
        if (directorySession && !directories.includes(directorySession)) directories.push(directorySession);
      }
      error = addStorageFailureContext(error, {
        cacheOwnershipPending: true,
        cacheOwnershipReleased: () => released && settlementLock === null && settlementResourcesSettled(),
        storageWriteReservations: Object.freeze([admittedReservation]), storageAdmissionSession: admittedReservation,
        ...(files.length ? { containedFileSession: files[0], containedFileSessions: Object.freeze(files) } : {}),
        ...(directories.length ? { storageDirectorySession: directories[0], storageDirectorySessions: Object.freeze(directories) } : {})
      }, null, { forceAggregate: true, nonEnumerable: ['storageWriteReservations', 'storageAdmissionSession',
        'containedFileSession', 'containedFileSessions', 'storageDirectorySession', 'storageDirectorySessions'] });
      const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased').value;
      Object.defineProperties(error, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
        cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
      admissionFailures.set(error, Object.freeze({ owner: admittedReservation, reservations: Object.freeze([admittedReservation]) }));
      settlementFailures.add(error); return error;
    };
    const settle = async () => {
      let operationError = null, cleanupError = null;
      try {
        if (!settlementResourcesSettled()) throw settlementFailure();
        if (!removed) {
          settlementLock ||= admissionLock;
          // Independent admitted writers can finish together. Join the existing
          // metadata lock briefly; contention cannot imply original release.
          settlementLock ||= await acquireFileLock({ lockPath, waitMs: 5000, pollMs: 20, staleMs: Number.MAX_SAFE_INTEGER,
            metadata: { scope: 'storage-write-settlement', hostname: os.hostname(), resourceId } });
          if (!settlementLock) throw fail('admission-owner-busy-during-settlement');
          const current = await readReservation(file);
          if (!settlementResourcesSettled()) throw settlementFailure();
          if (current.hash !== sealed.hash || digest(current.value) !== digest(value)) throw fail('write-reservation-owner-changed');
          const stat = await fs.lstat(file, { bigint: true });
          if (!settlementResourcesSettled()) throw settlementFailure();
          if (!stat.isFile() || stat.nlink !== 1n || String(stat.dev) !== current.fileIdentity.dev
            || String(stat.ino) !== current.fileIdentity.ino || String(stat.dev) !== sealed.fileIdentity.dev
            || String(stat.ino) !== sealed.fileIdentity.ino) throw fail('write-reservation-file-changed');
          const removal = await fs.unlink(file);
          if (removal !== undefined) throw fail('reservation-removal-unconfirmed');
          removed = true;
        }
      } catch (error) { operationError = rememberSettlement(error); }
      finally {
        if (settlementLock && settlementResourcesSettled()) {
          try {
            await releaseFileLockOrThrow(settlementLock);
            if (settlementLock === admissionLock) admissionLock = null;
            settlementLock = null;
          }
          catch (error) { cleanupError = rememberSettlement(error); }
        }
      }
      if (operationError !== null || cleanupError !== null || !settlementResourcesSettled()) {
        throw settlementFailure(operationError === null ? cleanupError : operationError);
      }
      // Removing the record alone is not the complete owner release. A failed
      // lock release keeps its exact handle for retry, without unlinking again.
      released = true;
      reservationSettled = true;
      return true;
    };
    admittedReservation = Object.freeze({ schemaVersion: 1, resourceId, root, requiredBytes, reservationId: id,
      admission: 'admitted-declared-write-estimate', metric: value.metric,
      releaseAfterSettlement: async receipt => {
        let valid;
        try { valid = receipt?.resourceId === resourceId && receipt.settled === true && receipt.pending === false; }
        catch (error) { throw settlementFailure(rememberSettlement(error)); }
        if (!valid) throw fail('resource-settlement-unconfirmed');
        if (!settlementResourcesSettled()) throw settlementFailure();
        if (released) return true;
        if (!releasing) releasing = settle().finally(() => { releasing = null; });
        return releasing;
      } });
    freeObservation.requireSettled();
    return admittedReservation;
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'storage-write-admission' });
    admissionError = observation.retain();
    const observe = Object.getOwnPropertyDescriptor(admissionError, 'cacheOwnershipReleased').value;
    originalObserver = () => observe.call(admissionError) === true;
    throw originalObserver() ? observation.primary : admissionError;
  }
  finally {
    try {
      if (!originalObserver()) throw fail('original-admission-resources-unconfirmed');
      await releaseFileLockOrThrow(lock); admissionLock = null;
    }
    catch (cleanupError) {
      // Publication may already have sealed a reservation even though its
      // acquisition promise cannot return it. Preserve that exact owner and
      // the original coordinator handle for actual caller reconciliation.
      let reconciling = null;
      const session = Object.freeze({ resourceId, releaseAfterSettlement: async receipt => {
        if (receipt?.resourceId !== resourceId || receipt.settled !== true || receipt.pending !== false || !originalObserver()) {
          throw fail('resource-settlement-unconfirmed');
        }
        if (!reconciling) reconciling = (async () => {
          if (admittedReservation) await admittedReservation.releaseAfterSettlement(receipt);
          else if (admissionLock) { await releaseFileLockOrThrow(admissionLock); admissionLock = null; }
          return true;
        })().finally(() => { reconciling = null; });
        return reconciling;
      } });
      const primary = fail('admission-lock-release-unconfirmed', {
        cause: admissionError === null ? cleanupError : admissionError,
        storageAdmissionCleanupError: cleanupError });
      // Preserve only capabilities validated by the actual existing producers.
      // An arbitrary field, cause chain or resourceId supplies no authority.
      const fileSession = getContainedFileSession(admissionError);
      const directorySession = getStorageDirectorySession(admissionError);
      let error = addStorageFailureContext(primary, {
        cacheOwnershipPending: true,
        cacheOwnershipReleased: () => originalObserver() && admissionLock === null && (!admittedReservation || reservationSettled),
        storageWriteReservations: Object.freeze(admittedReservation ? [admittedReservation] : []), storageAdmissionSession: session,
        ...(fileSession ? { containedFileSession: fileSession } : {}),
        ...(directorySession ? { storageDirectorySession: directorySession } : {})
      }, admissionError === null ? cleanupError : admissionError,
      { secondaryPresent: true, nonEnumerable: ['storageWriteReservations', 'storageAdmissionSession',
        'containedFileSession', 'storageDirectorySession'] });
      if (admissionError !== null) error = addStorageFailureContext(error, {}, cleanupError, { secondaryPresent: true });
      const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased').value;
      Object.defineProperties(error, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
        cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
      admissionFailures.set(error, Object.freeze({ owner: session,
        reservations: Object.freeze(admittedReservation ? [admittedReservation] : []) }));
      throw error;
    }
  }
};
