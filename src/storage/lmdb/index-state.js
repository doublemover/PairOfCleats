import { updateIndexStateNamespace } from '../../shared/index-state-publication.js';

/** Required LMDB state publication. Read/write/manifest failures remain the
 * actual command failure; in-memory ready state cannot substitute for disk. */
export const updateLmdbState = async (indexDir, patch) => {
  if (!indexDir) return null;
  return updateIndexStateNamespace(indexDir, 'lmdb', patch);
};
