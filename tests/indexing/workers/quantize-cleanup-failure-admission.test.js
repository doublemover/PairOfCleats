import assert from 'node:assert/strict';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';

const worker = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true, maxWorkers: 1,
  taskTimeoutMs: 1000 }, { cpuLimit: 1 }), poolName: 'quantize', dictWords: new Set(), postingsConfig: {}, log: () => {} });
assert.ok(worker, 'this supported Windows fixture requires its ordinary worker facade');
const owned = worker.pool, originalRun = owned.run, originalDestroy = owned.destroy;
const taskFailure = new Error('settled task failure'), cleanupFailure = new Error('native cleanup ownership unresolved');
const source = Float32Array.of(.1, .2), before = source.slice(), logs = [];
let teardownAttempts = 0;
try {
  owned.run = async () => { throw taskFailure; };
  owned.destroy = async () => { teardownAttempts++; throw cleanupFailure; };
  await assert.rejects(buildDenseVectors({ chunks: [{ embedding: source }], quantizePool: worker, log: message => logs.push(message) }), error => {
    assert.equal(error.code, 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED');
    assert.equal(error.workerOwnershipPending, true);
    assert.ok(error.errors.includes(taskFailure)); assert.ok(error.errors.includes(cleanupFailure));
    return true;
  });
  assert.equal(teardownAttempts, 1);
  assert.equal(worker.pool, owned, 'failed teardown retains the original owner');
  assert.equal(source.byteLength, 8); assert.deepEqual(source, before);
  assert.ok(!logs.some(message => message.includes('falling back to inline')), 'an unresolved pool is never reported as successful inline recovery');
} finally {
  owned.run = originalRun; owned.destroy = originalDestroy;
  await worker.destroy();
}
console.log('The real quantize facade preserves task/cleanup failure and retained worker authority through dense admission.');

// Actual facade failures may be falsey JavaScript values. A later drain failure
// must preserve presence rather than testing the truthiness of the thrown value.
for (const taskValue of [undefined, null, false, 0, '']) {
  const pool = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true, maxWorkers: 1,
    taskTimeoutMs: 1000 }, { cpuLimit: 1 }), poolName: 'quantize', dictWords: new Set(), postingsConfig: {}, log: () => {} });
  assert.ok(pool);
  const original = pool.pool, run = original.run, destroy = original.destroy;
  try {
    original.run = async () => { throw taskValue; };
    original.destroy = async () => { throw cleanupFailure; };
    await assert.rejects(pool.runQuantize({ vectors: [[.1, .2]] }), error => {
      assert.equal(error.code, 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED');
      assert.equal(error.cause, taskValue);
      assert.deepEqual(error.errors, [taskValue, cleanupFailure]);
      assert.equal(pool.pool, original);
      return true;
    });
  } finally {
    original.run = run; original.destroy = destroy;
    await pool.destroy();
  }
}
// Recovery diagnostics are a separately failing consumer. A subsequent original
// pool drain must retain that composed failure as well as the original task.
const recoveryFailure = new Error('recovery diagnostics unavailable');
const recovered = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true, maxWorkers: 1,
  taskTimeoutMs: 1000 }, { cpuLimit: 1 }), poolName: 'quantize', dictWords: new Set(), postingsConfig: {}, log: () => {},
crashLogger: { enabled: true, logError: () => { throw recoveryFailure; } } });
assert.ok(recovered);
const recoveryOwner = recovered.pool, savedRun = recoveryOwner.run, savedDestroy = recoveryOwner.destroy;
try {
  recoveryOwner.run = async () => { throw taskFailure; };
  recoveryOwner.destroy = async () => { throw cleanupFailure; };
  await assert.rejects(recovered.runQuantize({ vectors: [[.1, .2]] }), error => {
    assert.equal(error.code, 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED');
    assert.deepEqual(error.errors[0].errors, [taskFailure, recoveryFailure]);
    assert.equal(error.errors[0].cause, taskFailure);
    assert.equal(error.errors[1], cleanupFailure);
    return true;
  });
} finally {
  recoveryOwner.run = savedRun; recoveryOwner.destroy = savedDestroy;
  await recovered.destroy();
}
