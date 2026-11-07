// Actual registry capability plus inert release failures; UNVALIDATED.
import assert from 'node:assert/strict';
import path from 'node:path';
import { withRegistryLock } from '../../src/index/registry-support.js';
import { acquireRegistryLock } from '../../src/index/registry-lock.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

const temporary = await makeTempDir('poc-registry-worker-cleanup-errors-');
const root = path.join(temporary, 'registry');
const originalFailure = Object.freeze(Object.assign(new Error('original registry operation failed'), { code: 'ORIGINAL_WORKER' }));
const cleanupFailure = Object.freeze(Object.assign(new Error('exact registry metadata release failed'), { code: 'EACCES' }));
let owned = null, release = null;
const run = worker => withRegistryLock({ repoCacheRoot: root, domain: 'snapshots', worker });
try {
  const result = await run(async () => 'ordinary-success');
  assert.equal(result, 'ordinary-success');
  await assert.rejects(run(async () => { throw originalFailure; }), error => error === originalFailure,
    'normal release retains the original operation rejection unchanged');

  for (const value of [originalFailure, null, undefined, false, 0, '']) {
    let failure;
    try { await run(async lock => {
      owned = lock; release = lock.release;
      lock.release = async () => { throw cleanupFailure; };
      throw value;
    }); } catch (error) { failure = error; }
    assert.equal(failure.code, 'ERR_FILE_LOCK_RELEASE_FAILED');
    assert.equal(failure.cause, cleanupFailure);
    if (value === originalFailure) assert.equal(failure.workerError, originalFailure);
    else assert.equal(failure.workerError.cause, value, 'a falsey operation failure keeps its exact cause during cleanup failure');
    assert.equal(originalFailure.code, 'ORIGINAL_WORKER');
    owned.release = release;
    assert.equal(await release.call(owned), true);
    owned = null; release = null;
  }

  const borrowed = await acquireRegistryLock({ repoCacheRoot: root, domain: 'snapshots' });
  owned = borrowed; release = borrowed.release;
  let attempted = false;
  borrowed.release = async () => { attempted = true; throw cleanupFailure; };
  await assert.rejects(withRegistryLock({ repoCacheRoot: root, domain: 'snapshots', options: { lock: borrowed },
    worker: async () => { throw originalFailure; } }), error => error === originalFailure);
  assert.equal(attempted, false, 'a borrowed capability remains owned by its actual caller');
  borrowed.release = release;
  assert.equal(await release.call(borrowed), true);
  owned = null; release = null;
} finally {
  if (owned && release) { owned.release = release; await release.call(owned); }
  await rmDirRecursive(temporary);
}
console.log('Registry worker and cleanup error preservation controls authored; execution deferred.');
