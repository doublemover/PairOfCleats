import { acquireRepoCacheAccessLease } from '../../../src/shared/cache/repo-access.js';
const [root, coordinationRoot] = process.argv.slice(2);
try {
  const lease = acquireRepoCacheAccessLease(root, coordinationRoot ? { coordinationRoot } : {});
  lease.release();
  process.exitCode = 2;
} catch (error) {
  if (error.code !== 'ERR_REPO_CACHE_DELEGATION_PENDING') throw error;
}
