// Fresh-process lock lifetime controls authored during development; UNVALIDATED.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { acquireIndexLock, attachIndexLockSignalCleanup } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { releaseCacheWriterOwnership } from '../../../src/index/build/cache-writer-drain.js';
import { acquireFileLock } from '../../../src/shared/locks/file-lock.js';
import { removeLockFileSyncIfOwned } from '../../../src/shared/locks/file-lock-info.js';
import { removeLockFileIfOwned } from '../../../src/shared/locks/file-lock-owner.js';
import { checkIndexLock } from '../../../tools/bench/language/locks.js';
import { makeTempDir } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const [role, cache, scenario] = process.argv.slice(2);
if (role === 'admitting-owner') {
  const resource = scenario.startsWith('resource-');
  const lock = await acquireIndexLock({ repoCacheRoot: cache, requireSettlement: resource });
  assert.ok(lock);
  const lease = resource ? createIndexCacheLease(lock, cache) : null;
  if (scenario === 'resource-signal') attachIndexLockSignalCleanup(lock, {
    signals: ['SIGTERM'], reemitSignal: () => process.exit(0)
  });
  process.send({ payload: lock.payload });
  await new Promise(resolve => process.once('message', resolve));
  if (scenario === 'resource-release') {
    await releaseCacheWriterOwnership({ lease, release: () => lock.release() });
  }
  if (scenario === 'resource-signal') process.emit('SIGTERM', 'SIGTERM');
  process.exit(0);
} else {
  const root = await makeTempDir('writer-parent-exit-fence-');
  applyTestEnv({ cacheRoot: path.join(root, 'cache') });
  const children = [];
  try {
    for (const scenario of ['process-exit', 'process-kill', 'resource-exit', 'resource-kill', 'resource-signal', 'resource-release']) {
      const cache = path.join(root, scenario);
      const child = fork(fileURLToPath(import.meta.url), ['admitting-owner', cache, scenario], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
      });
      const closed = once(child, 'close');
      children.push({ child, closed });
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Writer did not reach the bounded admission barrier.')), 5000);
        child.once('message', message => { clearTimeout(timer); resolve(message); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', () => { clearTimeout(timer); reject(new Error('Writer closed before admission.')); });
      });
      if (scenario.endsWith('-kill')) child.kill('SIGKILL');
      else child.send({ finish: true });
      await closed;
      const lockPath = path.join(cache, 'locks', 'index.lock');
      const retained = scenario.startsWith('resource-') && scenario !== 'resource-release';
      if (retained) {
        assert.deepEqual(JSON.parse(await fs.readFile(lockPath, 'utf8')), ready.payload,
          'parent exit/signal never substitutes for explicit resource settlement');
        assert.equal(await acquireIndexLock({ repoCacheRoot: cache, staleMs: 1 }), null);
        assert.equal(await acquireFileLock({ lockPath, staleMs: 1, forceStaleCleanup: true }), null,
          'the common stale-lock owner also preserves the durable marker');
        const benchmark = await checkIndexLock({ repoCacheRoot: cache, repoLabel: 'fixture',
          lockMode: 'fail-fast', lockWaitMs: 0, lockStaleMs: 1 });
        assert.equal(benchmark.ok, false);
        assert.equal(benchmark.detail.resourcePending, true);
        // This fixture admitted no external resource. Delete its exact owned
        // metadata only after observing the actual fixture process close;
        // production gains no dead-PID recovery capability from this cleanup.
        await fs.rm(lockPath);
      }
      const successor = await acquireIndexLock({ repoCacheRoot: cache });
      assert.ok(successor, 'process-only recovery and explicit resource release preserve replacement admission');
      await successor.release();
    }
    const cache = path.join(root, 'throwing-observer');
    const lock = await acquireIndexLock({ repoCacheRoot: cache, requireSettlement: true });
    const lease = createIndexCacheLease(lock, cache);
    assert.equal(removeLockFileSyncIfOwned(lock.lockPath, { pid: process.pid }), false,
      'a legacy PID-only owner cannot unlink a resource fence admitted by the same process');
    assert.equal(removeLockFileSyncIfOwned(lock.lockPath, null, { force: true }), false);
    assert.equal(await removeLockFileIfOwned(lock.lockPath, null, { force: true }), false,
      'stale-owner fallback force cannot erase a newly protected resource lock');
    const error = Object.assign(new Error('pending exact owner'), { cacheOwnershipPending: true,
      cacheOwnershipReleased: () => { throw new Error('unavailable observer'); } });
    await assert.rejects(releaseCacheWriterOwnership({ lease, release: () => lock.release(), operationError: error }), value => value === error);
    lease.assertOwned();
    lease.invalidate(); await lock.release();
  } finally {
    for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.allSettled(children.map(({ closed }) => closed));
    await fs.rm(root, { recursive: true, force: true });
  }
  console.log('Resource writer fences survive parent exit while process-only recovery stays available.');
}
