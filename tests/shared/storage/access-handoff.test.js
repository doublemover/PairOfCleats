import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { repoAccessPaths, retainRepoCacheAccess, prepareRepoCacheAccessHandoff,
  cancelRepoCacheAccessHandoff, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';

const temporary = await makeTempDir('poc-storage-handoff-');
try {
  const root = path.join(temporary, 'assets', 'model');
  const coordinationRoot = path.join(temporary, 'state', 'storage-access');
  const options = { coordinationRoot };
  retainRepoCacheAccess(root, options);
  const paths = repoAccessPaths(root, options);
  assert.ok(paths.directory.startsWith(coordinationRoot));
  assert.equal((await withExclusiveRepoCacheCleanup(root, () => assert.fail('retained reader blocks cleanup'), options)).protected, true);
  await assert.rejects(prepareRepoCacheAccessHandoff(root, { ...options,
    drain: async () => ({ drained: true, leaseId: 'wrong-owner' }) }), /exact retained lease/);
  const token = await prepareRepoCacheAccessHandoff(root, { ...options,
    drain: async ({ leaseId }) => ({ drained: true, pending: false, leaseId }) });
  assert.throws(() => retainRepoCacheAccess(root, options), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
  const result = await withExclusiveRepoCacheCleanup(root, async () => {
    assert.throws(() => retainRepoCacheAccess(root, options), { code: 'ERR_REPO_CACHE_ACCESS_SUSPENDED' });
    assert.equal((await fs.readdir(paths.leases)).length, 0, 'exact drained reader yields only after exclusion');
    return 'owned-mutation';
  }, { ...options, localAccessHandoff: token });
  assert.equal(result.result, 'owned-mutation');
  assert.equal((await fs.readdir(paths.leases)).length, 1, 'reader protection is restored before unlocking');
  retainRepoCacheAccess(root, options);
  await assert.rejects(withExclusiveRepoCacheCleanup(root, () => {}, { ...options, localAccessHandoff: token }), /stale/);
  const unused = await prepareRepoCacheAccessHandoff(root, { ...options,
    drain: async ({ leaseId }) => ({ drained: true, leaseId }) });
  assert.equal(cancelRepoCacheAccessHandoff(unused), true);
  retainRepoCacheAccess(root, options);
} finally { await rmDirRecursive(temporary); }
console.log('storage access handoff passed');
