import { addStorageFailureContext } from '../shared/storage/operation-error.js';

/** Preserve each original descriptor failure and its private recovery session.
 * Composition grants no group release capability and never retries a close.
 */
export const semanticReaderFailure = failures => {
  const unique = [...new Set(failures)];
  return unique.slice(1).reduce((primary, secondary) =>
    addStorageFailureContext(primary, {}, secondary, { secondaryPresent: true }), unique[0]);
};

export const completeSemanticReaderCleanup = async (cleanup, primary, primaryPresent = false) => {
  try { await cleanup(); }
  catch (secondary) {
    throw primaryPresent ? semanticReaderFailure([primary, secondary]) : secondary;
  }
};

export const withSemanticReaderCleanup = async (run, cleanup) => {
  let primary, primaryPresent = false;
  try { return await run(); }
  catch (caught) { primary = caught; primaryPresent = true; throw caught; }
  finally { await completeSemanticReaderCleanup(cleanup, primary, primaryPresent); }
};

/** Drain all admitted opens and attempt every independent reader close. Only a
 * fulfilled close removes its exact entry; failed owners remain represented by
 * their original errors, including when opening/verification never returned one.
 */
export const closeSemanticReaders = async readers => {
  const entries = [...readers.entries()];
  const opened = await Promise.allSettled(entries.map(([, pending]) => pending));
  const closed = await Promise.allSettled(opened.map(async (result, index) => {
    if (result.status === 'rejected') throw result.reason;
    await result.value.close();
    const [key, pending] = entries[index];
    if (readers.get(key) === pending) readers.delete(key);
  }));
  const failures = closed.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw semanticReaderFailure(failures);
};
