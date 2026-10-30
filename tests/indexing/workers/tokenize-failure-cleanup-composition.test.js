import assert from 'node:assert/strict';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

// Actual facade, original backend hooks; no simulated successful cleanup and no
// ordinary fallback may erase a failed shutdown or a falsey thrown task value.
for (const primary of [undefined, null, false, 0, '']) {
  const worker = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true, maxWorkers: 1,
    taskTimeoutMs: 1000 }, { cpuLimit: 1 }), dictWords: new Set(), dictConfig: {}, postingsConfig: {}, log: () => {} });
  assert.ok(worker);
  const owner = worker.pool, run = owner.run, destroy = owner.destroy;
  const cleanup = new Error('original tokenizer shutdown remains unconfirmed');
  let closed = 0;
  try {
    owner.run = async () => { throw primary; };
    owner.destroy = async () => { closed++; throw cleanup; };
    await assert.rejects(worker.tokenizeChunk({ text: 'alpha', mode: 'code', file: 'fixture.js', ext: '.js' }), error => {
      assert.equal(error.code, 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED');
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary, cleanup]);
      assert.equal(error.workerOwnershipPending, true);
      return true;
    });
    assert.equal(closed, 1);
    assert.equal(worker.pool, owner);
    assert.equal(worker.stats().activeTasks, 0);
    assert.equal(worker.stats().dispatchedTasks, 0);
    assert.equal(worker.stats().waitingForThrottle, 0);
  } finally {
    owner.run = run; owner.destroy = destroy;
    await worker.destroy();
  }
}
console.log('Tokenizer facade preserves falsey original tasks and failed shutdown without leaking dispatch counters.');
