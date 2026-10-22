import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease, assertIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { acquireIndexLockWithBackoff } from '../../../src/index/build/watch/lock.js';
import { rebuildRepoCache } from '../../../src/integrations/core/build-index/cache-rebuild.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const [role, repoRoot, cacheRoot, phase] = process.argv.slice(2);
if (role) {
  if (role === 'owner' || role === 'process-owner') {
    const lock = await acquireIndexLock({ repoCacheRoot: cacheRoot, requireSettlement: role === 'owner' });
    assert.ok(lock);
    if (role === 'process-owner') {
      process.send({ ready: true });
      await new Promise(resolve => process.once('message', resolve));
      await lock.release(); process.exit(0);
    }
    const lease = createIndexCacheLease(lock, cacheRoot);
    const filename = path.join(cacheRoot, 'incremental', phase, 'live-write');
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const handle = await fs.open(filename, 'wx');
    await handle.write('owned');
    process.send({ ready: true, filename });
    await new Promise(resolve => process.once('message', resolve));
    assertIndexCacheLease(lease, cacheRoot);
    await fs.access(filename);
    await handle.write(' drained'); await handle.close();
    lease.invalidate(); await lock.release();
    process.exit(0);
  }
  let busy = false;
  if (role === 'cache-rebuild') {
    try { await rebuildRepoCache({ root: repoRoot, userConfig: {} }); }
    catch (error) { busy = /Index lock unavailable/.test(error.message); }
  } else {
    const lock = role === 'watch' ? await acquireIndexLockWithBackoff({ repoCacheRoot: cacheRoot,
      shouldExit: () => false, log: () => {}, backoff: { baseMs: 1, maxMs: 2, maxWaitMs: 5 } })
      : await acquireIndexLock({ repoCacheRoot: cacheRoot });
    busy = !lock;
    await lock?.release();
  }
  process.send({ busy }); process.exit(busy ? 0 : 1);
} else {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-cache-writer-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  applyTestEnv({ testing: '1', cacheRoot: path.join(root, 'cache') });
  const cache = getRepoCacheRoot(repo, {});
  const children = new Set();
  const start = (kind, point) => {
    const child = fork(fileURLToPath(import.meta.url), [kind, repo, cache, point], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child);
    const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
    const message = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Cache ownership child did not reach its bounded barrier.')), 5000);
      child.once('message', value => { clearTimeout(timer); resolve(value); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    return { child, message, exited };
  };
  try {
    for (const point of ['pending-object', 'completion-published', 'stage2-writeback']) {
      for (const contender of ['ordinary', 'watch', 'cache-rebuild']) {
        const owner = start('owner', point + '-' + contender);
        const ready = await owner.message;
        const competing = start(contender, point);
        assert.equal((await competing.message).busy, true);
        assert.equal(await competing.exited, 0);
        await fs.access(ready.filename);
        owner.child.send({ drain: true });
        assert.equal(await owner.exited, 0);
      }
    }
    // A dead admitting PID cannot establish settlement for a resource writer.
    // Preserve the old recovery control on the process-only lock it qualifies.
    const abandoned = start('process-owner', 'killed-owner');
    await abandoned.message;
    abandoned.child.kill('SIGKILL'); await abandoned.exited;
    const recovered = await acquireIndexLock({ repoCacheRoot: cache });
    assert.ok(recovered, 'a dead process-only lock is recoverable without the stale-age deadline');
    assert.throws(() => createIndexCacheLease(recovered, cache), { code: 'ERR_INDEX_CACHE_OWNERSHIP' },
      'process lifetime alone cannot grant resource-writer authority');
    await recovered.release();
    const resourceOwner = await acquireIndexLock({ repoCacheRoot: cache, requireSettlement: true });
    const lease = createIndexCacheLease(resourceOwner, cache);
    assert.equal(assertIndexCacheLease(lease, cache), resourceOwner);
    lease.invalidate();
    assert.throws(() => assertIndexCacheLease(lease, cache), { code: 'ERR_INDEX_CACHE_OWNERSHIP' });
    await resourceOwner.release();
    console.log('Cross-process ordinary/watch/rebuild ownership barriers and killed-owner recovery passed');
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await fs.rm(root, { recursive: true, force: true });
  }
}
