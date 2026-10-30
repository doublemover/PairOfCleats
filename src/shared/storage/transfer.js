import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle } from '../contained-file.js';
import { throwIfAborted } from '../abort.js';
import { sameStorageFileIdentity, storageFileIdentity } from './inventory.js';
import { addStorageFailureContext, readStorageFailureContext } from './operation-error.js';

const transferSessions = new WeakSet();
const failureOwners = new WeakMap();
const sealOwnershipObservation = error => {
  const observe = Object.getOwnPropertyDescriptor(error, 'cacheOwnershipReleased')?.value;
  Object.defineProperties(error, { cacheOwnershipPending: { value: true, writable: false, configurable: false },
    cacheOwnershipReleased: { value: observe, writable: false, configurable: false } });
  return error;
};
export const isStorageTransferSession = session => Boolean(session) && transferSessions.has(session);
const asError = value => value !== null && ['object', 'function'].includes(typeof value) ? value : new Error(String(value), { cause: value });
const captureObservation = (error, retainInspection) => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return { observe: null };
    return { observe: () => {
      try { return typeof observe === 'function' && observe.call(error) === true; }
      catch (inspectionError) { retainInspection(inspectionError); return false; }
    } };
  } catch (inspectionError) { return { observe: () => false, inspectionFailed: true, inspectionError }; }
};

/** Bounded streaming read/copy through the existing contained descriptor owner. */
export const verifyStorageFile = async ({ root, file, identity = null, expectedHash = null,
  destination = null, signal = null, deadline = null, maxBytes = Number.MAX_SAFE_INTEGER }) => {
  const handle = await openContainedFile(root, file, { expectedFileIdentity: identity ? { dev: identity.dev, ino: identity.ino } : null });
  let output = null;
  let primary = null, closing = null, overflow = false;
  const owners = [], observers = [], inspectionFailures = [], observed = new WeakSet();
  const contexts = new Set(), contextObservations = new WeakSet();
  const adopt = handle => {
    const owner = { handle, closed: false, close: null, captureError: null };
    owners.push(owner);
    try {
      owner.close = handle.close;
      if (typeof owner.close !== 'function') throw new TypeError('Storage transfer descriptor has no close owner.');
    } catch (error) { owner.captureError = asError(error); }
    return owner;
  };
  const inputOwner = adopt(handle);
  const resourceId = `storage-transfer:${randomUUID()}`;
  const retainInspection = value => {
    const error = asError(value);
    if (observed.has(error)) return;
    if (inspectionFailures.length === 64) { overflow = true; return; }
    inspectionFailures.push(error); observeFailure(error);
  };
  const rememberContext = error => {
    if (!readStorageFailureContext(error) || contexts.has(error)) return;
    if (contexts.size === 128) { overflow = true; return; }
    contexts.add(error);
  };
  const observeFailure = error => {
    const queue = [error];
    while (queue.length) {
      const current = asError(queue.pop());
      rememberContext(current);
      if (failureOwners.get(current) === session || observed.has(current)) continue;
      observed.add(current);
      const captured = captureObservation(current, retainInspection);
      if (captured.observe) { if (observers.length < 128) observers.push(captured.observe); else overflow = true; }
      if (captured.inspectionFailed) {
        if (inspectionFailures.length < 64) {
          const failure = asError(captured.inspectionError); inspectionFailures.push(failure); queue.push(failure);
        } else overflow = true;
      }
    }
  };
  const originalResourcesSettled = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context.complete) overflow = true;
      for (const inspection of context.inspectionErrors) {
        if (observed.has(inspection)) continue;
        observed.add(inspection);
        if (inspectionFailures.length < 64) inspectionFailures.push(inspection); else overflow = true;
      }
      for (const observation of context.inspectionObservations) {
        if (failureOwners.get(observation.error) === session || contextObservations.has(observation)) continue;
        contextObservations.add(observation);
        if (observers.length < 128) observers.push(observation.observe); else overflow = true;
      }
    }
    return !overflow && observers.every(observe => observe());
  };
  const isSettled = () => owners.every(owner => owner.closed) && originalResourcesSettled();
  const closeOwners = async () => {
    if (!closing) closing = (async () => {
      const failures = [];
      for (const owner of owners.filter(current => !current.closed)) {
        try {
          if (!originalResourcesSettled()) throw new Error('Original storage transfer work prohibits native descriptor close.');
          if (owner.captureError) throw owner.captureError;
          const result = await owner.close.call(owner.handle);
          if (result === false) throw new Error('Storage transfer descriptor close explicitly remained unconfirmed.');
          owner.closed = true;
        } catch (value) {
          const failure = asError(value); failures.push(failure); observeFailure(failure);
        }
      }
      return failures;
    })().finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = failures => {
    const diagnostics = [...failures, ...inspectionFailures.filter(error => !failures.includes(error))];
    const pending = sealOwnershipObservation(Object.assign(new AggregateError(diagnostics, 'Storage transfer descriptor closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined), {
      code: 'ERR_STORAGE_TRANSFER_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    }));
    failureOwners.set(pending, session);
    const failure = addStorageFailureContext(primary || failures[0] || pending, { storageTransferSession: session }, pending,
      { nonEnumerable: ['storageTransferSession'] });
    sealOwnershipObservation(failure); failureOwners.set(failure, session); rememberContext(failure);
    return failure;
  };
  const session = Object.freeze({ resourceId, isSettled, releaseAfterClose: async () => {
    const failures = await closeOwners();
    if (failures.length || !isSettled()) throw retainFailure(failures);
    return { resourceId, settled: true, pending: false };
  } });
  transferSessions.add(session);
  try {
    if (inputOwner.captureError) throw inputOwner.captureError;
    const before = storageFileIdentity(await handle.stat({ bigint: true }));
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes
      || (identity && !sameStorageFileIdentity(before, identity))) throw new Error('Migration source identity or byte budget changed.');
    if (destination) {
      output = await fs.open(destination, 'wx', before.mode & 0o777);
      const outputOwner = adopt(output);
      if (outputOwner.captureError) throw outputOwner.captureError;
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      throwIfAborted(signal);
      if (deadline !== null && Date.now() >= deadline) throw new Error('Storage transfer time budget exhausted.');
      const read = await handle.read(buffer, 0, buffer.length, null);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > maxBytes || bytes > before.size) throw new Error('Storage transfer source grew beyond its admitted bytes.');
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      if (output) {
        let written = 0;
        while (written < chunk.length) {
          const next = await output.write(chunk, written, chunk.length - written, null);
          if (!next.bytesWritten) throw new Error('Storage transfer made no write progress.');
          written += next.bytesWritten;
        }
      }
    }
    verifyContainedFileHandle(handle, root, file);
    const after = storageFileIdentity(await handle.stat({ bigint: true }));
    const sha256 = hash.digest('hex');
    if (!sameStorageFileIdentity(before, after) || bytes !== before.size || (expectedHash && sha256 !== expectedHash)) {
      throw new Error('Storage transfer checksum or source identity changed.');
    }
    if (output) {
      await output.chmod(before.mode & 0o777);
      await output.sync();
    }
    return { sha256, bytes, identity: after };
  } catch (value) {
    primary = asError(value);
    observeFailure(primary);
    throw primary;
  } finally {
    const failures = await closeOwners();
    if (failures.length || !isSettled()) throw retainFailure(failures);
  }
};
