import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Close the existing SQLite cache owner before publishing a successful report.
 * No direct handle close, retry or forced release replaces its lease authority. */
export const withMicrobenchCacheOwner = async (cache, run) => {
  let primary, primaryPresent = false;
  try { return await run(); }
  catch (error) { primary = error; primaryPresent = true; throw error; }
  finally {
    try { await cache.dispose(); }
    catch (cleanup) {
      if (!primaryPresent) throw cleanup;
      throw addStorageFailureContext(primary, { microbenchCleanupPhase: 'sqlite-cache-dispose' }, cleanup, { secondaryPresent: true });
    }
  }
};
