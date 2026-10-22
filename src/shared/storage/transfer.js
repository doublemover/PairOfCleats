import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { openContainedFile, verifyContainedFileHandle } from '../contained-file.js';
import { throwIfAborted } from '../abort.js';
import { sameStorageFileIdentity, storageFileIdentity } from './inventory.js';
import { addStorageFailureContext } from './operation-error.js';

const transferSessions = new WeakSet();
export const isStorageTransferSession = session => Boolean(session) && transferSessions.has(session);
const asError = value => value && typeof value === 'object' ? value : new Error(String(value), { cause: value });
const captureObservation = error => {
  try {
    const observe = error?.cacheOwnershipReleased;
    if (error?.cacheOwnershipPending !== true && typeof observe !== 'function') return null;
    return () => { try { return typeof observe === 'function' && observe.call(error) === true; } catch { return false; } };
  } catch { return () => false; }
};

/** Bounded streaming read/copy through the existing contained descriptor owner. */
export const verifyStorageFile = async ({ root, file, identity = null, expectedHash = null,
  destination = null, signal = null, deadline = null, maxBytes = Number.MAX_SAFE_INTEGER }) => {
  const handle = await openContainedFile(root, file, { expectedFileIdentity: identity ? { dev: identity.dev, ino: identity.ino } : null });
  let output = null;
  let primary = null, closing = null, overflow = false;
  const owners = [], observers = [], observed = new WeakSet();
  const adopt = handle => {
    const owner = { handle, closed: false, close: null, captureError: null };
    owners.push(owner);
    try {
      owner.close = handle.close;
      if (typeof owner.close !== 'function') throw new TypeError('Storage transfer descriptor has no close owner.');
    } catch (error) { owner.captureError = asError(error); }
  };
  adopt(handle);
  const resourceId = `storage-transfer:${randomUUID()}`;
  const observeFailure = error => {
    if (observed.has(error)) return;
    observed.add(error);
    const observe = captureObservation(error);
    if (observe) { if (observers.length < 128) observers.push(observe); else overflow = true; }
  };
  const isSettled = () => !overflow && owners.every(owner => owner.closed) && observers.every(observe => observe());
  const closeOwners = async () => {
    if (!closing) closing = (async () => {
      const results = await Promise.allSettled(owners.filter(owner => !owner.closed).map(async owner => {
        if (owner.captureError) throw owner.captureError;
        await owner.close.call(owner.handle);
        owner.closed = true;
      }));
      const failures = results.filter(result => result.status === 'rejected').map(result => asError(result.reason));
      for (const failure of failures) observeFailure(failure);
      return failures;
    })().finally(() => { closing = null; });
    return closing;
  };
  const retainFailure = failures => {
    const pending = Object.assign(new AggregateError(failures, 'Storage transfer descriptor closure remains unconfirmed.',
      failures.length ? { cause: failures[0] } : undefined), {
      code: 'ERR_STORAGE_TRANSFER_CLOSE_PENDING', cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    });
    return addStorageFailureContext(primary || failures[0] || pending, { storageTransferSession: session }, pending,
      { nonEnumerable: ['storageTransferSession'] });
  };
  const session = Object.freeze({ resourceId, isSettled, releaseAfterClose: async () => {
    const failures = await closeOwners();
    if (failures.length || !isSettled()) throw retainFailure(failures);
    return { resourceId, settled: true, pending: false };
  } });
  transferSessions.add(session);
  try {
    const before = storageFileIdentity(await handle.stat({ bigint: true }));
    if (!Number.isSafeInteger(before.size) || before.size < 0 || before.size > maxBytes
      || (identity && !sameStorageFileIdentity(before, identity))) throw new Error('Migration source identity or byte budget changed.');
    if (destination) { output = await fs.open(destination, 'wx', before.mode & 0o777); adopt(output); }
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
