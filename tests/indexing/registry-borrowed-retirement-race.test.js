import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
// Observe only the actual async admission return. This models the distinct
// promise-continuation boundary before registry-support dispatches its worker.
const hook = registerHooks({ load(url, context, next) {
  const loaded = next(url, context); if (!url.endsWith('/src/index/registry-lock.js')) return loaded;
  const original = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  const source = original.replace('export const assertBorrowedRegistryLock = async ', 'const originalAssertBorrowedRegistryLock = async ');
  assert.notEqual(source, original);
  return { ...loaded, source: source + '\nexport const assertBorrowedRegistryLock=async(...args)=>{await originalAssertBorrowedRegistryLock(...args);globalThis.__registryBeforeBorrowDispatch?.(args[0]);};\n' };
} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const { dir } = await prepareIsolatedTestCacheDir('registry-borrowed-retirement-race');
const originalOpen = fs.open, releases = [];
try {
  const { acquireRegistryLock, resolveRegistryLockPath } = await import('../../src/index/registry-lock.js');
  const { withRegistryLock } = await import('../../src/index/registry-support.js');
  let workers = 0;
  const use = (root, lock) => withRegistryLock({ repoCacheRoot: root, domain: 'snapshots',
    options: { lock }, worker: async () => { workers++; return 'accepted'; } });
  for (const scenario of ['metadata', 'dispatch', 'healthy', 'retired']) {
    const root = path.join(dir, scenario); await fs.mkdir(root);
    const lock = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
    const lockPath = resolveRegistryLockPath(root, 'snapshots');
    const before = workers;
    if (scenario === 'metadata') {
      const entered = deferred(), resume = deferred(); let intercepted = false;
      fs.open = async (filename, ...args) => {
        const handle = await originalOpen(filename, ...args);
        if (intercepted || path.resolve(String(filename)) !== lockPath) return handle;
        intercepted = true; const close = handle.close.bind(handle);
        handle.close = async () => { entered.resolve(); await resume.promise; return close(); };
        return handle;
      };
      const operation = use(root, lock), observed = operation.then(() => assert.fail('retired admission must reject'), error => error);
      await entered.promise;
      const retirement = lock.release(); releases.push(retirement);
      resume.resolve();
      assert.equal((await observed).code, 'ERR_REGISTRY_LOCK_OWNERSHIP'); await retirement;
      fs.open = originalOpen;
    } else if (scenario === 'dispatch') {
      let retirement;
      globalThis.__registryBeforeBorrowDispatch = captured => { assert.equal(captured, lock); retirement = lock.release(); releases.push(retirement); };
      await assert.rejects(use(root, lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
      delete globalThis.__registryBeforeBorrowDispatch; await retirement;
    } else if (scenario === 'retired') {
      await lock.release(); await assert.rejects(use(root, lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
    } else {
      assert.equal(await use(root, lock), 'accepted'); await lock.release();
    }
    assert.equal(workers - before, scenario === 'healthy' ? 1 : 0);
    const replacement = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
    try {
      await assert.rejects(use(root, lock), { code: 'ERR_REGISTRY_LOCK_OWNERSHIP' });
      assert.equal(JSON.parse(await fs.readFile(lockPath, 'utf8')).lockId, replacement.payload.lockId,
        'rejected borrowing never releases or removes another owner');
    } finally { await replacement.release(); }
  }
} finally {
  fs.open = originalOpen; delete globalThis.__registryBeforeBorrowDispatch; hook.deregister();
  await Promise.all(releases); await fs.rm(dir, { recursive: true, force: true });
}
console.log('Actual metadata admission and promise-to-dispatch retirement races reject before borrowed mutation.');
