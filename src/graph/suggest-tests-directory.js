import fs from 'node:fs';
import { observeStorageResource } from '../shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../shared/storage/operation-error.js';

/** Read one bounded directory with explicit synchronous ownership. An unsettled
 * read forbids close; an unconfirmed close retains the same handle for recovery.
 * Neither case may turn into an empty inventory or start heuristic fallback. */
export const readSuggestionDirectory = ({ directoryPath, maxEntries, budget, openDirectory = fs.opendirSync }) => {
  let directory = null, closed = false, scanned = 0, eof = false;
  const entries = [], observations = [];
  const settled = () => closed && observations.every(observation => observation.isSettled());
  let session;
  const retain = error => addStorageFailureContext(error, { storageSuggestTestsDirectory: session,
    cacheOwnershipPending: true, cacheOwnershipReleased: settled });
  const close = () => {
    for (const observation of observations) observation.requireSettled();
    if (!closed && directory) {
      budget.count('directoryCloses');
      try { directory.closeSync(); }
      catch (error) { observations.push(observeStorageResource(error, { phase: 'suggest-tests-directory-close' })); throw retain(error); }
    }
    closed = true;
    return true;
  };
  session = Object.freeze({ operation: 'suggest-tests-directory', release: close, isSettled: settled });
  let failure = null, failed = false;
  try {
    if (budget.check('discovery')) {
      budget.count('directoryOpens');
      directory = openDirectory(directoryPath, { bufferSize: 1 }); scanned += 1;
      while (scanned < maxEntries && budget.check('discovery')) {
        budget.count('directoryReads');
        const entry = directory.readSync();
        if (!entry) { eof = true; break; }
        scanned += 1; budget.count('inventoryEntries'); entries.push(entry);
      }
    }
  } catch (error) {
    const observation = observeStorageResource(error, { phase: 'suggest-tests-directory-read' });
    observations.push(observation); failure = observation.primary; failed = true;
  }
  try { close(); }
  catch (error) {
    failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error;
    failed = true;
  }
  if (failed) throw closed ? failure : retain(failure);
  // Include time spent in the final read and required close before admitting a
  // directory's sorted candidates. A timed-out prefix has no admission authority.
  const complete = budget.check('discovery') && eof;
  return { entries: complete ? entries : [], scanned, complete };
};
