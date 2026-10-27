import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { acquireIndexLock } from '../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../src/index/build/cache-lease.js';
import { releaseCacheWriterOwnership } from '../../src/index/build/cache-writer-drain.js';
import { resolveRepoCacheRootPath } from '../../src/shared/repo-paths.js';

/** Empty fixture attempts have no background writers. Admit creation through
 * the real writer owner and acknowledge settlement only after its release. */
export const createSettledWatchAttempt = async (manager, repoRoot, userConfig = {}) => {
  const repoCacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig);
  const lock = await acquireIndexLock({ repoCacheRoot, requireSettlement: true,
    storageContext: { repoRoot, userConfig } });
  assert.ok(lock, 'fixture must own its writer lock');
  const lease = createIndexCacheLease(lock, repoCacheRoot);
  try {
    const attempt = await manager.createAttempt({ lease });
    await fs.mkdir(attempt.buildRoot, { recursive: true });
    return attempt;
  }
  finally { await releaseCacheWriterOwnership({ lease, release: () => lock.release() }); }
};
