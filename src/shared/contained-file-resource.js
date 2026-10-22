import { randomUUID } from 'node:crypto';
import { withSchedulerCpuSuspended } from './concurrency/scheduler-task-scope.js';
import { addStorageFailureContext, readStorageFailureContext } from './storage/operation-error.js';
import { observeStorageResource } from './storage/failure-observation.js';

const sessions = new WeakSet(), failures = new WeakMap(), retained = new Map();
const objectLike = value => value !== null && ['object', 'function'].includes(typeof value);
const asError = value => objectLike(value) ? value : new Error(String(value), { cause: value });
export const isContainedFileSession = value => objectLike(value) && sessions.has(value);
export const getContainedFileSession = error => {
  if (!objectLike(error)) return null;
  if (failures.has(error)) return failures.get(error);
  try {
    const candidate = Object.getOwnPropertyDescriptor(error, 'containedFileSession')?.value;
    return isContainedFileSession(candidate) ? candidate : null;
  } catch { return null; }
};

/** Acquire lazily on first next(), and retain the exact session on this actual
 * iterator as well as its failures. A return/throw before first next opens nothing.
 */
export const iterateContainedFileResourceSync = acquire => {
  const iterator = (function* () {
    const { owner, action, onComplete } = acquire();
    const borrowed = owner.iterateSync(action);
    let result;
    try { result = yield* borrowed; }
    finally {
      const session = getContainedFileSession(borrowed);
      if (session) failures.set(iterator, session);
    }
    // Only normal exhaustion after confirmed close can publish a consumer witness.
    // Close-only recovery never invokes this callback or resumes the generator.
    onComplete?.();
    return result;
  })();
  return iterator;
};

/** Own only one actual opened descriptor. This grants no path mutation or
 * lease authority. Failed synchronous close cannot safely be retried by fd
 * number: even a matching stat does not establish its descriptor generation.
 */
export const createContainedFileResource = ({ handle = null, fd, sync, methods }) => {
  let resourceId = null;
  const identity = () => resourceId ||= `contained-file:${randomUUID()}`;
  const errors = [], guards = [], seen = new WeakSet(), active = new Set(), contexts = new Set(), observations = new WeakSet();
  let primary, hasPrimary = false, overflow = false, accepting = true, closed = false, closeAttempted = false;
  let closeMethod = null, statMethod = null, readMethod = null, captureFailed = false, closing = null;
  const receiver = sync ? methods.receiver : handle;
  const remember = value => {
    const error = asError(value);
    if (failures.get(error) === session || seen.has(error)) return error;
    seen.add(error);
    if (errors.length === 128) { overflow = true; return error; }
    errors.push(error);
    if (!hasPrimary) { hasPrimary = true; primary = error; }
    const guard = observeStorageResource(error, { phase: 'contained-file-resource' }).retain();
    guards.push(Object.getOwnPropertyDescriptor(guard, 'cacheOwnershipReleased').value);
    contexts.add(guard);
    return error;
  };
  const resourcesSettled = () => {
    for (const error of contexts) {
      const context = readStorageFailureContext(error);
      if (!context?.complete) { overflow = true; continue; }
      for (const entry of context.inspectionObservations) {
        if (failures.get(entry.error) === session || observations.has(entry)) continue;
        observations.add(entry);
        if (guards.length === 256) { overflow = true; break; }
        guards.push(entry.observe);
      }
    }
    return !overflow && guards.every(observe => observe() === true);
  };
  const isSettled = () => {
    const settled = closed && resourcesSettled();
    if (settled && resourceId) retained.delete(resourceId);
    return settled;
  };
  const pendingFailure = () => {
    if (!hasPrimary) remember(new Error('Contained descriptor closure or independent original work remains unconfirmed.'));
    const witness = Object.assign(new AggregateError(errors.slice(1), 'Contained descriptor resource remains retained.'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: isSettled
    });
    failures.set(witness, session);
    const failure = addStorageFailureContext(primary, { containedFileSession: session }, witness,
      { nonEnumerable: ['containedFileSession'] });
    const observe = Object.getOwnPropertyDescriptor(failure, 'cacheOwnershipReleased').value;
    Object.defineProperties(failure, { cacheOwnershipPending: { value: true, configurable: false, writable: false },
      cacheOwnershipReleased: { value: observe, configurable: false, writable: false } });
    failures.set(failure, session);
    if (contexts.size < 256) contexts.add(failure); else overflow = true;
    retained.set(identity(), session);
    return failure;
  };
  const capture = () => {
    try {
      closeMethod = sync ? methods.close : handle.close;
      if (typeof closeMethod !== 'function') throw new TypeError('Contained descriptor has no original close method.');
    } catch (value) { captureFailed = true; remember(value); }
    try {
      if (!sync) fd = handle.fd;
      if (!Number.isInteger(fd) || fd < 0) throw new TypeError('Contained descriptor has no exact opened fd.');
    } catch (value) { remember(value); }
    for (const field of ['stat', 'read']) {
      try {
        const method = sync ? methods[field] : handle[field];
        if (typeof method !== 'function') throw new TypeError(`Contained descriptor has no original ${field} method.`);
        if (field === 'stat') statMethod = method; else readMethod = method;
      } catch (value) { remember(value); }
    }
  };
  const nativeAsync = async (method, args, onFulfilled = null) => {
    let actual = null;
    try {
      await withSchedulerCpuSuspended(() => {
        actual = Promise.resolve().then(() => method.call(receiver, ...args)).then(value => {
          onFulfilled?.(value); return value;
        });
        return actual;
      });
    } catch (value) {
      remember(value);
      if (actual) await actual.catch(remember);
      throw value;
    }
    if (!actual) throw remember(new Error('Scheduler wait did not invoke the original contained descriptor operation.'));
    // The scheduler may wrap the return value. Resource evidence is the actual
    // captured operation's fulfillment, never a wrapper's return convention.
    const nativeResult = await actual;
    return nativeResult;
  };
  const invokeAsync = (method, args) => {
    if (!accepting) return Promise.reject(new Error('Contained descriptor no longer admits reads/stat operations.'));
    const operation = nativeAsync(method, args);
    active.add(operation);
    operation.then(() => active.delete(operation), value => { active.delete(operation); remember(value); });
    return operation;
  };
  const invokeSync = (method, args) => {
    if (!accepting) throw new Error('Contained descriptor no longer admits reads/stat operations.');
    try { return method.call(receiver, fd, ...args); } catch (value) { remember(value); throw value; }
  };
  const closeSync = () => {
    if (closed) return;
    if (!resourcesSettled()) throw new Error('Independent original contained-file work prohibits descriptor close.');
    if (captureFailed) throw new Error('Original contained descriptor close method is unknown.');
    if (closeAttempted) throw new Error('An unconfirmed synchronous descriptor close cannot be retried by fd number.');
    closeAttempted = true;
    const result = closeMethod.call(receiver, fd);
    if (result !== undefined) throw new Error('Original synchronous descriptor close did not confirm its standard void result.');
    closed = true;
  };
  const closeAsync = async explicit => {
    if (!closing) closing = (async () => {
      await Promise.allSettled([...active]);
      if (closed) return;
      if (!resourcesSettled()) throw new Error('Independent original contained-file work prohibits descriptor close.');
      if (captureFailed) throw new Error('Original contained descriptor close method is unknown.');
      if (closeAttempted && !explicit) throw new Error('A failed descriptor close requires explicit original-owner recovery.');
      closeAttempted = true;
      const result = await nativeAsync(closeMethod, [], value => { if (value === undefined) closed = true; });
      if (result !== undefined) throw new Error('Original contained descriptor close did not confirm its standard void result.');
      closed = true;
    })().finally(() => { closing = null; });
    return closing;
  };
  const receipt = () => ({ resourceId: identity(), settled: true, pending: false });
  const releaseSync = () => {
    try { closeSync(); if (!isSettled()) throw new Error('Independent contained descriptor work remains pending.'); }
    catch (value) { remember(value); throw pendingFailure(); }
    return receipt();
  };
  const session = Object.freeze({ get resourceId() { return identity(); }, isSettled,
    releaseAfterClose: async () => {
      try {
        if (sync) return releaseSync();
        await closeAsync(true);
        if (!isSettled()) throw new Error('Independent contained descriptor work remains pending.');
        return receipt();
      } catch (value) { remember(value); throw pendingFailure(); }
    }, ...(sync ? { releaseAfterCloseSync: releaseSync } : {}) });
  sessions.add(session);
  capture();
  const operations = Object.freeze({ fd,
    stat: (...args) => sync ? invokeSync(statMethod, args) : invokeAsync(statMethod, args),
    read: (...args) => sync ? invokeSync(readMethod, args) : invokeAsync(readMethod, args) });
  const completedFailure = () => {
    if (errors.length === 1) return primary;
    return addStorageFailureContext(primary, {}, new AggregateError(errors.slice(1), 'Contained read has independent failures.'));
  };
  const finishSync = () => {
    accepting = false;
    try { closeSync(); } catch (value) { remember(value); }
    if (!isSettled()) throw pendingFailure();
    if (hasPrimary) throw completedFailure();
  };
  return Object.freeze({ operations, hasFailure: () => hasPrimary, remember,
    inspect: action => {
      if (!accepting) throw new Error('Contained descriptor no longer admits verification.');
      try { return action(fd); } catch (value) { remember(value); throw value; }
    },
    detach: () => { accepting = false; return sync ? fd : handle; },
    iterateSync: action => {
      if (!sync) throw new TypeError('A synchronous iterator requires its synchronous descriptor owner.');
      const iterator = (function* () {
        try {
          if (hasPrimary) throw primary;
          return yield* action(operations);
        } catch (value) { remember(value); }
        finally {
          try { finishSync(); }
          finally { failures.set(iterator, session); }
        }
      })();
      return iterator;
    },
    runSync: action => {
      let result;
      try {
        if (hasPrimary) throw primary;
        result = action(operations);
        if (result && typeof result.then === 'function') throw Object.assign(
          new Error('A synchronous contained callback returned asynchronous work with unknown descriptor ownership.'),
          { cacheOwnershipPending: true });
      } catch (value) { remember(value); }
      finishSync();
      return result;
    },
    run: async action => {
      let result;
      try { if (hasPrimary) throw primary; result = await action(operations); } catch (value) { remember(value); }
      accepting = false;
      try { await closeAsync(false); } catch (value) { remember(value); }
      if (!isSettled()) throw pendingFailure();
      if (hasPrimary) throw completedFailure();
      return result;
    } });
};
