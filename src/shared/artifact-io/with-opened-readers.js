import fs from 'node:fs/promises';
import { withContainedFile } from '../contained-file.js';
import { createContainedFileResource, getContainedFileSession } from '../contained-file-resource.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { observeStorageResource } from '../storage/failure-observation.js';

/** Hold a bounded borrowed file set with the existing per-descriptor owners.
 * The completion result is internal status, never a group settlement receipt or
 * a release capability. Failed native close is never retried by this scope.
 */
export const openFileReaderScope = async (paths, { containedRoot = null } = {}) => {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 8) {
    throw new TypeError('A bounded file reader set is required.');
  }
  const errors = [], seenValues = new WeakMap(), compositions = new WeakSet();
  let completing = null, terminalFailure = null, overflow = false, combined = null, combinedCount = -1;
  const remember = value => {
    // This exact completion error already observes these same descriptor
    // owners. Feeding it back through their gates would create a self-cycle.
    if (terminalFailure && value === terminalFailure) return value;
    const objectLike = value !== null && ['object', 'function'].includes(typeof value);
    if (objectLike && compositions.has(value)) return value;
    if (objectLike && seenValues.has(value)) return errors[seenValues.get(value)];
    if (errors.length >= 128) {
      if (!overflow) {
        overflow = true;
        errors.push(observeStorageResource(Object.freeze(Object.assign(new Error('File reader failure history is incomplete.'),
          { cacheOwnershipPending: true })), { phase: 'opened-file-readers' }).retain());
      }
      if (objectLike) seenValues.set(value, 128);
      return errors[128];
    }
    const retained = observeStorageResource(value, { phase: 'opened-file-readers' }).retain();
    if (objectLike) seenValues.set(value, errors.length);
    // Nested verification/read promises may report the same captured failure.
    // Its original prerequisites are already recorded; wrapping our own alias
    // again inflates the bounded diagnostic graph without adding original work.
    seenValues.set(retained, errors.length);
    errors.push(retained); return retained;
  };
  const combine = () => {
    if (combinedCount !== errors.length) {
      combined = errors.slice(1).reduce((failure, secondary) =>
        addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true }), errors[0]);
      combinedCount = errors.length;
      if (combined) compositions.add(combined);
    }
    return combined;
  };
  const requireFailuresSettled = () => {
    for (const error of errors) observeStorageResource(error, { phase: 'opened-file-readers' }).requireSettled();
  };
  const readers = paths.map(target => {
    const ready = Promise.withResolvers(), finish = Promise.withResolvers();
    let resourceSettled = null;
    const borrow = (descriptor, resource) => {
      resourceSettled = resource.isSettled;
      ready.resolve(descriptor); return finish.promise;
    };
    const lifetime = containedRoot ? withContainedFile(containedRoot, target, borrow) : (async () => {
      const handle = await fs.open(target, 'r');
      const owner = createContainedFileResource({ handle, sync: false });
      return owner.run(descriptor => borrow(descriptor, owner));
    })();
    const outcome = lifetime.then(() => ({ status: 'fulfilled' }), reason => {
      remember(reason); ready.reject(reason); return { status: 'rejected', reason };
    });
    return { ready: ready.promise, finish, outcome, isSettled: () => resourceSettled === null || resourceSettled() === true };
  });
  const admission = await Promise.allSettled(readers.map(reader => reader.ready));
  const complete = () => {
    if (!completing) completing = (async () => {
      // Capture every independent original before allowing any destruction.
      const original = combine();
      for (const reader of readers) {
        if (original) reader.finish.reject(original);
        else reader.finish.resolve();
      }
      // An admission failure may never have entered borrow(). Its unused gate
      // still needs a handler without pretending that it owned a descriptor.
      await Promise.allSettled(readers.map(reader => reader.finish.promise));
      await Promise.all(readers.map(reader => reader.outcome));
      let failure = combine(), settled = !overflow;
      for (const reader of readers) {
        try { if (!reader.isSettled()) settled = false; }
        catch (error) { remember(error); settled = false; }
      }
      failure = combine();
      if (failure) {
        const sessions = [];
        for (const error of errors) {
          const single = getContainedFileSession(error);
          if (single && !sessions.includes(single)) sessions.push(single);
        }
        if (sessions.length) failure = addStorageFailureContext(failure, {
          containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions)
        }, null, { nonEnumerable: ['containedFileSession', 'containedFileSessions'], forceAggregate: true });
        try { observeStorageResource(failure, { phase: 'opened-file-readers-completion' }).requireSettled(); }
        catch (retained) { settled = false; failure = retained; }
      }
      terminalFailure = failure;
      return Object.freeze({ failure, settled });
    })();
    return completing;
  };
  if (errors.length) throw (await complete()).failure;
  return Object.freeze({ descriptors: Object.freeze(admission.map(entry => entry.value)), remember,
    combineFailures: combine, requireFailuresSettled, complete });
};

/** Scope a small exact file set using these same owners and compositor. */
export const withOpenedFileReaders = async (paths, action, options = {}) => {
  if (typeof action !== 'function') throw new TypeError('A file reader callback is required.');
  const scope = await openFileReaderScope(paths, options);
  let result;
  try { result = await action(scope.descriptors); }
  catch (error) { scope.remember(error); }
  const { failure } = await scope.complete();
  if (failure) throw failure;
  return result;
};
