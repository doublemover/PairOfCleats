import { sha1 } from '../../shared/hash.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';

const payloadKeys = { code: 'code', prose: 'prose', 'extracted-prose': 'extractedProse', records: 'records' };

/**
 * Core search records the signature of each directory it actually selected.
 * Check that evidence before admitting hits, including when current pointers
 * changed and returned to their original value during the child request.
 * Custom search collaborators may omit retrieval metadata; they remain trusted
 * producers and retain the coordinator's final live-manifest fence.
 */
export const verifyFederatedModeGeneration = ({ repoId, modes, result, manifestRepo }) => {
  const byMode = result?.retrieval?.freshness?.byMode;
  if (byMode == null) return;
  for (const mode of modes) {
    const expected = manifestRepo?.indexes?.[mode]?.indexSignatureHash;
    const observed = byMode[payloadKeys[mode]]?.signature;
    if (typeof expected !== 'string' || typeof observed !== 'string' || `is1-${sha1(observed)}` !== expected) {
      throw createError(ERROR_CODES.INVALID_REQUEST,
        `Repository ${repoId} ${mode} generation does not match workspace admission. Restart the search.`);
    }
  }
};
