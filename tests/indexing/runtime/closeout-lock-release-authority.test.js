// Actual closeout and cache-lock owners; UNVALIDATED during development.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCloseoutRegistry } from '../../../src/integrations/core/build-index/closeout-registry.js';
import { acquireIndexLock } from '../../../src/index/build/lock.js';
import { createIndexCacheLease } from '../../../src/index/build/cache-lease.js';
import { releaseCacheWriterOwnership, combineCacheWriterErrors } from '../../../src/index/build/cache-writer-drain.js';
import { makeTempDir } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await makeTempDir('closeout-lock-authority-');
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const lock = await acquireIndexLock({ repoCacheRoot: root, requireSettlement: true });
const lease = createIndexCacheLease(lock, root);
try {
  const calls = [];
  const primary = Object.assign(new Error('required state writer did not settle'), { code: 'ERR_STATE_WRITER' });
  const closeout = createCloseoutRegistry({ stage: 'stage2', log: () => {}, warn: () => {} });
  closeout.addStep({ label: 'build-state.flush', run: () => { calls.push('flush'); throw primary; } });
  closeout.addStep({ label: 'runtime.teardown', run: () => { calls.push('runtime'); } });
  closeout.addStep({ label: 'lock.release', requiresPriorSuccess: true, run: async () => {
    calls.push('release'); await releaseCacheWriterOwnership({ lease, release: () => lock.release(), drained: true });
  } });
  const result = await closeout.run();
  assert.deepEqual(calls, ['flush', 'runtime'], 'a prior writer failure does not skip teardown or authorize lock release');
  assert.equal(result.steps[2].ok, false);
  assert.equal(result.error.cacheOwnershipPending, true);
  assert.equal(result.error.errors[0], primary);
  assert.equal(result.error.cacheOwnershipReleased(), false,
    'the generic closeout registry cannot infer resource closure from completed later steps');
  lease.assertOwned(root);
  assert.equal(await acquireIndexLock({ repoCacheRoot: root }), null, 'an independent writer cannot enter the retained exact lock');

  const optional = createCloseoutRegistry();
  optional.addStep({ label: 'optional', required: false, run: () => { throw new Error('optional observation'); } });
  let ran = false;
  optional.addStep({ label: 'after-optional', requiresPriorSuccess: true, run: () => { ran = true; } });
  assert.equal((await optional.run()).error, null);
  assert.equal(ran, true, 'optional observations do not become new authority prerequisites');

  let firstClosed = false, secondClosed = false;
  const first = Object.assign(new Error('first owner'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => firstClosed });
  const second = Object.assign(new Error('second owner'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => secondClosed });
  const combined = combineCacheWriterErrors(first, second);
  firstClosed = true;
  assert.equal(combined.cacheOwnershipReleased(), false);
  secondClosed = true;
  assert.equal(combined.cacheOwnershipReleased(), true, 'every original pending owner must confirm release');
  const unknown = combineCacheWriterErrors(first, Object.assign(new Error('unknown owner'), { cacheOwnershipPending: true }));
  assert.equal(unknown.cacheOwnershipReleased(), false);
} finally {
  lease.invalidate(); await lock.release();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Required closeout failures preserve exact cache authority while remaining finalizers run.');
