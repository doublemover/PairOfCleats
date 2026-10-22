#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { once } from 'node:events';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { releaseCacheWriterOwnership } from '../../../src/index/build/cache-writer-drain.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-pending-close-lease-'));
const lock = await acquireIndexLock({ repoCacheRoot: root });
const lease = createIndexCacheLease(lock, root);
const originalSpawn = childProcess.spawn;
let child, emit, delayedClose, suppress = true;
childProcess.spawn = (...args) => {
  child = originalSpawn(...args); emit = child.emit;
  child.emit = function(event, ...values) {
    if (event === 'close' && suppress) { delayedClose = values; return true; }
    return emit.call(this, event, ...values);
  };
  return child;
};
syncBuiltinESMExports();
try {
  const controller = new AbortController();
  const error = await spawnSubprocess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore', signal: controller.signal, killTree: false, timeoutAbortReapWaitMs: 25,
    ownershipId: 'stage1:delayed-fixture:child', onSpawn: () => controller.abort()
  }).then(() => assert.fail('cancellation must reject'), value => value);
  assert.equal(error.cacheOwnershipPending, true);
  const release = () => releaseCacheWriterOwnership({ lease, release: () => lock.release(), operationError: error });
  await assert.rejects(release(), value => value === error);
  lease.assertOwned(root);
  assert.equal(await acquireIndexLock({ repoCacheRoot: root }), null, 'another writer cannot enter while close is unobserved');
  if (child.exitCode == null && child.signalCode == null) await once(child, 'exit');
  suppress = false;
  if (delayedClose) emit.call(child, 'close', ...delayedClose);
  else await once(child, 'close');
  assert.equal(error.cacheOwnershipReleased(), true);
  await release();
  const successor = await acquireIndexLock({ repoCacheRoot: root });
  const nextLease = createIndexCacheLease(successor, root);
  try {
    await assert.rejects(release(), /active repository cache writer lease/,
      'late completion from the prior handle cannot release a successor lock');
    nextLease.assertOwned(root);
  } finally { nextLease.invalidate(); await successor.release(); }
} finally {
  suppress = false;
  if (delayedClose) emit.call(child, 'close', ...delayedClose);
  childProcess.spawn = originalSpawn; syncBuiltinESMExports();
  if (child && child.exitCode == null && child.signalCode == null) { const closed = once(child, 'close'); child.kill(); await closed; }
  lease.invalidate(); await lock.release();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('delayed child close retains its exact cache lease until confirmed');
