import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';

/** Each service resource gets its cleanup attempt; retain original independent
 * errors and observers without finally replacing an earlier failure.
 */
export const closeApiRouterResources = async ({ closeArtifacts, closeRepoCaches, closeEmbeddings }) => {
  let failed = false, primary, repoCaches;
  for (const close of [closeArtifacts, async () => { repoCaches = await closeRepoCaches(); }, closeEmbeddings]) {
    try { await close(); }
    catch (error) { primary = failed ? addStorageFailureContext(primary, {}, error, { secondaryPresent: true }) : error; failed = true; }
  }
  if (failed) throw primary;
  return Object.freeze({ repoCaches });
};
