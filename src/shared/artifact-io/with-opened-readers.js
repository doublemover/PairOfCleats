import fs from 'node:fs/promises';
import { withContainedFile } from '../contained-file.js';
import { createContainedFileResource, getContainedFileSession } from '../contained-file-resource.js';
import { addStorageFailureContext } from '../storage/operation-error.js';
import { observeStorageResource } from '../storage/failure-observation.js';

/** Scope a small exact file set using existing descriptor owners, including
 * partial parallel admission. This creates no group resource ID or registry.
 * Every recovery capability remains an actual individual descriptor session.
 */
export const withOpenedFileReaders = async (paths, action, { containedRoot = null } = {}) => {
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 8 || typeof action !== 'function') {
    throw new TypeError('A bounded file reader set and read callback are required.');
  }
  const errors = [], seen = new Set();
  const remember = value => {
    if (value !== null && ['object', 'function'].includes(typeof value)) {
      if (seen.has(value)) return;
      seen.add(value);
    }
    errors.push(observeStorageResource(value, { phase: 'opened-file-readers' }).retain());
  };
  const readers = paths.map(target => {
    const ready = Promise.withResolvers(), finish = Promise.withResolvers();
    const borrow = descriptor => { ready.resolve(descriptor); return finish.promise; };
    const lifetime = containedRoot ? withContainedFile(containedRoot, target, borrow) : (async () => {
      const handle = await fs.open(target, 'r');
      return createContainedFileResource({ handle, sync: false }).run(borrow);
    })();
    const outcome = lifetime.then(() => ({ status: 'fulfilled' }), reason => {
      remember(reason); ready.reject(reason); return { status: 'rejected', reason };
    });
    return { ready: ready.promise, finish, outcome };
  });
  const admission = await Promise.allSettled(readers.map(reader => reader.ready));
  let result;
  if (!errors.length) {
    try { result = await action(admission.map(entry => entry.value)); }
    catch (error) { remember(error); }
  }
  // Capture before resolving the lifetime gates. Rejection delivers this exact
  // original observation to every descriptor owner before actual destruction.
  const original = errors[0];
  for (const reader of readers) {
    if (original) reader.finish.reject(original);
    else reader.finish.resolve();
  }
  // An admission failure may never have entered borrow(). Its unused finish
  // gate must still have a rejection handler, without pretending it owned an fd.
  await Promise.allSettled(readers.map(reader => reader.finish.promise));
  await Promise.all(readers.map(reader => reader.outcome));
  if (!errors.length) return result;

  const sessions = [];
  for (const error of errors) {
    const single = getContainedFileSession(error);
    if (single && !sessions.includes(single)) sessions.push(single);
  }
  let failure = errors[0];
  for (const secondary of errors.slice(1)) failure = addStorageFailureContext(failure, {}, secondary, { secondaryPresent: true });
  if (sessions.length) failure = addStorageFailureContext(failure, {
    containedFileSession: sessions[0], containedFileSessions: Object.freeze(sessions)
  }, null, { nonEnumerable: ['containedFileSession', 'containedFileSessions'], forceAggregate: true });
  throw failure;
};
