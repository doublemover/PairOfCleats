import path from 'node:path';
import { captureSceneFailure } from '../isometric/client/scene-failure-inspection.js';

const invalid = () => Object.assign(new Error('Graph artifact reads require an explicit retained index root and validated capability id.'), { status: 400 });
export const captureMapGraphSelection = input => {
  const indexRoot = input?.indexRoot, capabilityId = input?.capabilityId;
  if (indexRoot === undefined && capabilityId === undefined) return null;
  if (typeof indexRoot !== 'string' || !indexRoot.length || typeof capabilityId !== 'string' || !/^[a-f0-9]{64}$/.test(capabilityId)) throw invalid();
  return Object.freeze({ indexRoot: path.resolve(indexRoot), capabilityId });
};
export const mapGraphSelectionKey = selection => selection ? JSON.stringify([selection.indexRoot, selection.capabilityId]) : null;
const backend = async (repoRoot, options, consume) => (await import('../../integrations/core/build-index/index.js')).withBuildGraphCapability(repoRoot, options, consume);
const originalGraphWork = primary => {
  const values = [], pending = [primary], visited = new Set(); let unreadable = false;
  while (pending.length) {
    const value = pending.pop(); if (visited.has(value)) continue;
    if (visited.size >= 128) { unreadable = true; break; }
    visited.add(value); values.push(value);
    const captured = captureSceneFailure(value); pending.push(...captured.inspectionErrors);
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
    for (const key of ['cause', 'errors']) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        if (!Object.hasOwn(descriptor, 'value')) { unreadable = true; continue; }
        if (key === 'cause') pending.push(descriptor.value);
        else if (Array.isArray(descriptor.value)) {
          const errors = descriptor.value, size = Object.getOwnPropertyDescriptor(errors, 'length')?.value;
          if (!Number.isSafeInteger(size) || size > 128) { unreadable = true; continue; }
          for (let index = 0; index < size; index++) {
            const item = Object.getOwnPropertyDescriptor(errors, index);
            if (!item || !Object.hasOwn(item, 'value')) { unreadable = true; continue; }
            pending.push(item.value);
          }
        }
      } catch (error) { unreadable = true; pending.push(error); }
    }
  }
  return { values, released: () => !unreadable && values.every(value => captureSceneFailure(value).released()) };
};

/** Keep the existing backend callback/collector lease active across bounded
 * artifact pages. Only backend-produced capability.indexDir seeds actual reads. */
export const openMapGraphReader = async (repoRoot, selection, { signal = null, withCapability = backend } = {}) => {
  let entered, failed, finish, started = false, closing = null;
  const admitted = new Promise((resolve, reject) => { entered = resolve; failed = reject; });
  const completion = new Promise(resolve => { finish = resolve; });
  const flight = Promise.resolve().then(() => withCapability(repoRoot, {
    indexRoot: selection.indexRoot, capabilityId: selection.capabilityId, abortSignal: signal
  }, async capability => {
    started = true; entered(capability);
    const outcome = await completion;
    if (outcome.hasPrimary) throw outcome.primaryError;
  }));
  // Admission and retirement observe the same original flight. The rejection
  // handler also prevents an idle failed scope from becoming unhandled.
  flight.catch(error => { if (!started) failed(error); });
  const capability = await admitted;
  return Object.freeze({ capability, selection,
    close({ hasPrimary = false, primaryError } = {}) {
      if (!closing) closing = Promise.resolve().then(() => {
        let callbackFailure;
        if (hasPrimary) {
          const original = originalGraphWork(primaryError);
          callbackFailure = new AggregateError(original.values, captureSceneFailure(primaryError).message, { cause: primaryError });
          Object.defineProperties(callbackFailure, { cacheOwnershipPending: { get: () => !original.released() },
            cacheOwnershipReleased: { value: original.released } });
        }
        finish({ hasPrimary, primaryError: callbackFailure });
        return flight.catch(error => { if (!hasPrimary || error !== callbackFailure) throw error; });
      });
      return closing;
    }
  });
};

/** A callback's exact operation rejection is not a second cleanup failure. */
export const closeMapGraphReader = (reader, options = {}) => reader.close(options);
