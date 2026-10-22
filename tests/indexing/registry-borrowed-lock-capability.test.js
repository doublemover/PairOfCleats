import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireRegistryLock } from '../../src/index/registry-lock.js';
import { withRegistryLock } from '../../src/index/registry-support.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-capability-'));
const use = lock => withRegistryLock({ repoCacheRoot: root, domain: 'snapshots', options: { lock }, worker: async () => 42 });
try {
  await assert.rejects(use({ release() {} }), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
  const wrong = await acquireRegistryLock({ repoCacheRoot: root, domain: 'diffs' });
  try { await assert.rejects(use(wrong), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' }); }
  finally { await wrong.release(); }
  const lock = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
  try { assert.equal(await use(lock), 42); }
  finally { await lock.release(); }
  await assert.rejects(use(lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('borrowed registry capabilities passed');
