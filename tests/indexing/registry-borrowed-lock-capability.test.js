import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { acquireRegistryLock, resolveRegistryLockPath } from '../../src/index/registry-lock.js';
import { withRegistryLock } from '../../src/index/registry-support.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
const { dir: root } = await prepareIsolatedTestCacheDir('registry-capability');
const use = lock => withRegistryLock({ repoCacheRoot: root, domain: 'snapshots', options: { lock }, worker: async () => 42 });
try {
  await assert.rejects(use({ release() {} }), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
  const wrong = await acquireRegistryLock({ repoCacheRoot: root, domain: 'diffs' });
  try { await assert.rejects(use(wrong), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' }); }
  finally { await wrong.release(); }
  const completed = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
  assert.equal(await use(completed), 42);
  await completed.release();
  await assert.rejects(use(completed), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
  const lock = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
  try {
    assert.equal(await use(lock), 42);
    await assert.rejects(withRegistryLock({ repoCacheRoot: path.join(root, 'other'), domain: 'snapshots',
      options: { lock }, worker() { assert.fail('cross-root borrowed lock cannot enter mutation'); } }), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
    const lockPath = resolveRegistryLockPath(root, 'snapshots');
    const original = await fs.readFile(lockPath);
    const replaced = { ...JSON.parse(original.toString('utf8')), lockId: 'replacement-owner' };
    await fs.writeFile(lockPath, JSON.stringify(replaced));
    try { await assert.rejects(use(lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' }); }
    finally { await fs.writeFile(lockPath, original); }
  }
  finally {
    // Restoring bytes cannot restore the sealed native metadata identity.
    // A changed owner must preserve evidence rather than pretend release.
    await assert.rejects(lock.release(), /lock.*release|metadata identity/i);
    assert.equal(JSON.parse(await fs.readFile(resolveRegistryLockPath(root, 'snapshots'), 'utf8')).lockId, lock.payload.lockId);
  }
  await assert.rejects(use(lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('borrowed registry capabilities passed');
