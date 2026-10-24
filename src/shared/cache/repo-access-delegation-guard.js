import fs from 'node:fs';
import path from 'node:path';
import { readVerifiedContainedFileSync } from '../contained-file.js';
import { describeStorageFailure } from '../storage/failure-observation.js';

export const repoDelegationPath = paths => path.join(paths.directory, 'delegation.json');

/** A dead parent is insufficient recovery authority: its delegated child may
 * still own native handles. Even a dead child needs its owner settlement.
 * Unknown records remain evidence and block ordinary admission and collection.
 */
export const inspectRepoCacheDelegation = paths => {
  const file = repoDelegationPath(paths);
  try {
    const { buffer, hash } = readVerifiedContainedFileSync(path.parse(file).root, file, { maxBytes: 64 * 1024 });
    const value = JSON.parse(buffer.toString('utf8'));
    return { protected: true, reason: 'delegated-exclusive-owner-unsettled', file, sha256: hash, value };
  } catch (error) {
    const diagnostic = describeStorageFailure(error, { phase: 'repo-cache-delegation-inspection', defaultCode: 'ERR_REPO_CACHE_DELEGATION' });
    if (diagnostic.code === 'ENOENT' && !fs.existsSync(file)) return { protected: false, file, value: null };
    return { protected: true, reason: 'unknown-delegated-exclusive-owner', file, value: null,
      error: diagnostic };
  }
};

export const assertNoRepoCacheDelegation = paths => {
  const state = inspectRepoCacheDelegation(paths);
  if (state.protected) throw Object.assign(new Error('Delegated cache owner has not confirmed settlement; ordinary reader admission remains blocked.'), {
    code: 'ERR_REPO_CACHE_DELEGATION_PENDING', cacheOwnershipPending: true, delegation: state
  });
};
