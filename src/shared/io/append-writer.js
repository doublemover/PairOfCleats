import { runWithIndependentSchedulerOwner } from '../concurrency/scheduler-task-scope.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createContainedFileResource, getContainedFileSession } from '../contained-file-resource.js';
import { observeStorageResource } from '../storage/failure-observation.js';
import { addStorageFailureContext } from '../storage/operation-error.js';

/**
 * Serialize best-effort diagnostic appends on one original FileHandle. Enqueue
 * completion is not a persistence receipt. Flush/close reject unknown resource
 * settlement and retain the actual descriptor's close-only recovery capability.
 *
 * @param {{filePath:string,ensureDir?:boolean,syncOnFlush?:boolean,
 *   onError?:(stage:'open'|'write'|'flush'|'close',err:unknown)=>void}} input
 * @returns {{enqueue:(text:string)=>Promise<void>,flush:()=>Promise<void>,close:()=>Promise<void>}}
 */
export const createQueuedAppendWriter = ({
  filePath,
  ensureDir = true,
  syncOnFlush = false,
  onError = null
} = {}) => {
  let handlePromise = null, owner = null, writeChain = Promise.resolve(), queuedBatch = null;
  let acceptingWrites = true, closePromise = null, finishPromise = null, closed = false, captureFailed = false;
  let terminalFailure = null, observationOverflow = false;
  const observations = [], failures = [], maxBatchBytes = 64 * 1024;
  const overflowFailure = Object.assign(new Error('Append failure observation history exceeded its bounded limit.'), { cacheOwnershipPending: true });
  const remember = (error, phase) => {
    // Only this exact private outward value is self-produced. A copied marker,
    // cause or borrowed session field must never excuse independent work.
    if (terminalFailure !== null && error === terminalFailure) return;
    if (observations.length === 128) { observationOverflow = true; owner?.remember(overflowFailure); return; }
    failures.push(error); observations.push(observeStorageResource(error, { phase }));
    owner?.remember(error);
  };
  const requireSettled = () => {
    if (observationOverflow) throw overflowFailure;
    for (const observation of observations) observation.requireSettled();
  };
  const reportError = async (stage, error) => {
    if (typeof onError !== 'function') return;
    try { await onError(stage, error); }
    catch (secondary) { remember(secondary, 'append-error-callback'); }
  };
  const retainFailure = primary => {
    const originals = Object.freeze([...observations]), additional = [...new Set(failures)].filter(error => error !== primary);
    const sessions = [...new Set([primary, ...additional].map(getContainedFileSession).filter(Boolean))];
    let failure = addStorageFailureContext(primary, {
      appendPath: filePath, cacheOwnershipPending: true,
      cacheOwnershipReleased: () => !observationOverflow && originals.every(observation => observation.isSettled()),
      ...(sessions.length ? { containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions) } : {})
    }, null, { forceAggregate: true, nonEnumerable: ['containedFileSession', 'containedFileSessions'] });
    for (const secondary of additional) failure = addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true });
    for (const field of ['cacheOwnershipPending', 'cacheOwnershipReleased']) {
      const descriptor = Object.getOwnPropertyDescriptor(failure, field);
      if (descriptor) Object.defineProperty(failure, field, { ...descriptor, configurable: false,
        ...('value' in descriptor ? { writable: false } : {}) });
    }
    return failure;
  };
  const finishOwner = () => {
    acceptingWrites = false;
    if (finishPromise) return finishPromise;
    finishPromise = (async () => {
      if (owner) {
        try { await owner.run(() => undefined); }
        catch (error) {
          // A settled ordinary write failure was already reported and remains
          // best effort. Failed or blocked original close must never be forgotten.
          if (captureFailed || !owner.isSettled()) await reportError(captureFailed ? 'open' : 'close', error);
          if (!owner.isSettled()) { terminalFailure = retainFailure(error); throw terminalFailure; }
        }
      }
      try { requireSettled(); }
      catch (error) { terminalFailure = retainFailure(error); throw terminalFailure; }
      closed = true; handlePromise = null;
    })();
    // Callers may deliberately ignore a diagnostic promise. Its actual outcome
    // remains available to awaiting callers and the retained resource owner.
    finishPromise.catch(() => {});
    return finishPromise;
  };
  const stopIfUnsettled = async () => {
    try { requireSettled(); return false; }
    catch (error) {
      acceptingWrites = false;
      if (!owner) { terminalFailure = retainFailure(error); return true; }
      try { await finishOwner(); }
      catch (failure) { terminalFailure = failure; }
      return true;
    }
  };
  const ensureHandle = () => {
    if (closed || terminalFailure) return Promise.resolve(null);
    if (handlePromise) return handlePromise;
    handlePromise = (async () => {
      try {
        requireSettled();
        if (ensureDir) await fs.mkdir(path.dirname(filePath), { recursive: true });
        requireSettled();
        const handle = await fs.open(filePath, 'a');
        owner = createContainedFileResource({ handle, sync: false, additionalMethods: ['writeFile', 'sync'] });
        captureFailed = owner.hasFailure();
        if (captureFailed) { await finishOwner(); return null; }
        return owner;
      } catch (error) {
        if (!owner) {
          remember(error, 'append-open'); await reportError('open', error); await stopIfUnsettled();
          handlePromise = null;
          return null;
        }
        throw error;
      }
    })();
    return handlePromise;
  };
  const append = task => {
    // The serialized writer owns these bytes until flush/close. A producer's
    // file task may retire while its diagnostic append is still outstanding.
    const result = runWithIndependentSchedulerOwner(() => writeChain.then(task));
    // Retain a fulfilled drain chain without suppressing the public task result.
    writeChain = result.then(() => undefined, () => undefined);
    return result;
  };
  const enqueue = text => {
    if (!acceptingWrites || closed || closePromise || typeof text !== 'string' || text.length === 0) return Promise.resolve();
    const encoded = Buffer.from(text), bytes = encoded.length;
    if (!queuedBatch || queuedBatch.bytes + bytes > maxBatchBytes) {
      const batch = { parts: [], bytes: 0, promise: null };
      queuedBatch = batch;
      batch.promise = append(async () => {
        if (queuedBatch === batch) queuedBatch = null;
        try {
          if (closed || terminalFailure || await stopIfUnsettled()) return;
          const resource = await ensureHandle();
          if (!resource || closed || terminalFailure || await stopIfUnsettled()) return;
          if (await resource.operations.writeFile(Buffer.concat(batch.parts, batch.bytes)) !== undefined) throw Object.assign(
            new Error('Append write did not confirm its standard void result.'), { cacheOwnershipPending: true });
        } catch (error) {
          remember(error, 'append-write'); await reportError('write', error); await stopIfUnsettled();
        } finally { batch.parts = []; }
      });
    }
    queuedBatch.parts.push(encoded); queuedBatch.bytes += bytes;
    return queuedBatch.promise;
  };
  const sync = async () => {
    if (closed || finishPromise || !syncOnFlush || !owner) return;
    if (await stopIfUnsettled()) return;
    try {
      if (await owner.operations.sync() !== undefined) throw Object.assign(
        new Error('Append sync did not confirm its standard void result.'), { cacheOwnershipPending: true });
    } catch (error) { remember(error, 'append-flush'); await reportError('flush', error); await stopIfUnsettled(); }
  };
  const flush = () => {
    if (closed) return Promise.resolve();
    if (closePromise) return closePromise;
    return append(async () => {
      if (terminalFailure) throw terminalFailure;
      await sync();
      if (terminalFailure) throw terminalFailure;
    });
  };
  const close = () => {
    if (closePromise) return closePromise;
    acceptingWrites = false;
    closePromise = runWithIndependentSchedulerOwner(async () => {
      await writeChain;
      if (terminalFailure) throw terminalFailure;
      await sync();
      if (terminalFailure) throw terminalFailure;
      await finishOwner();
    });
    closePromise.catch(() => {});
    return closePromise;
  };
  return { enqueue, flush, close };
};
