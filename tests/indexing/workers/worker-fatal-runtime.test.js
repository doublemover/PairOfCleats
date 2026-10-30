import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import Piscina from 'piscina';
import { IndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';
import { WORKER_OBSERVATION_QUEUE_BYTES, WORKER_OBSERVATION_QUEUE_EVENTS } from '../../../src/index/build/workers/observation.js';

const filename = path.resolve('tests/indexing/workers/worker-fatal-fixture.js');
const create = backend => backend === 'worker'
  ? new IndexerThreadPool(new Piscina({ filename, name: 'run', minThreads: 1, maxThreads: 1 }))
  : new IndexerProcessPool({ filename, maxThreads: 1, oldSpaceMb: 128, maxRestartAttempts: 1,
    taskTimeout: 3000, budgetAccount: createProcessMemoryAccount(1024 * 1024 * 1024) });
for (const backend of ['worker', 'process']) {
  for (const mode of ['exception', 'rejection']) {
    let pool = create(backend), replacement;
    pool.on('message', () => { throw new Error('Metric observer failure must be inert.'); });
    pool.on('error', () => { throw new Error('Crash logger failure must be inert.'); });
    try {
      const first = await pool.run({ value: 1 }, { name: 'run' });
      if (backend === 'worker') assert.ok(pool.completed > 0, 'actual worker completion remains observable');
      await assert.rejects(pool.run({ mode: 'ordinary' }, { name: 'run' }), /ordinary controlled task failure/);
      const second = await pool.run({ value: 2, flood: 1000 }, { name: 'run' });
      assert.equal(second.id, first.id, 'ordinary task rejection does not retire the healthy backend owner');
      assert.equal(second.value, 2);
      assert.ok(second.observation.peakBytes <= WORKER_OBSERVATION_QUEUE_BYTES);
      assert.ok(second.observation.queuedEvents <= WORKER_OBSERVATION_QUEUE_EVENTS);
      if (backend === 'worker') {
        await pool.destroy();
        const reused = await pool.run({ value: 'explicit ordinary reuse' }, { name: 'run' });
        assert.equal(reused.value, 'explicit ordinary reuse');
        assert.notEqual(reused.id, second.id, 'ordinary confirmed destroy retains Piscina explicit reuse semantics');
      }
      let failure;
      await assert.rejects(pool.run({ mode, value: 'never publish' }, { name: 'run' }), error => {
        failure = error; return ['ERR_WORKER_FATAL', 'ERR_PROCESS_TASK_EXIT'].includes(error.code);
      });
      if (failure.workerSettlement) {
        await failure.workerSettlement;
        assert.equal(failure.workerOwnershipReleased(), true);
      }
      if (backend === 'worker') {
        assert.equal(pool.threads.length, 0);
        await assert.rejects(pool.run({ value: 'no reuse' }, { name: 'run' }), { code: 'ERR_WORKER_FATAL' });
        replacement = create(backend);
      } else replacement = pool;
      const next = await replacement.run({ value: 3 }, { name: 'run' });
      assert.equal(next.value, 3); assert.notEqual(next.id, first.id, 'future task runs on a different execution owner');
      if (backend === 'process') assert.equal(pool.stats().restarts, 1);
    } finally {
      if (replacement && replacement !== pool) await replacement.destroy();
      await pool.destroy();
      if (backend === 'process') assert.equal(pool.stats().aggregate.reservedBytes, 0);
    }
  }
}

// Explicit warning-mode launch still uses the worker's declared fatal policy.
const warning = new IndexerThreadPool(new Piscina({ filename, name: 'run', minThreads: 1, maxThreads: 1,
  execArgv: ['--unhandled-rejections=warn'] }));
try {
  const fatal = once(warning, 'fatal');
  await assert.rejects(warning.run({ mode: 'rejection' }, { name: 'run' }), { code: 'ERR_WORKER_FATAL' });
  const [error] = await fatal; await error.workerSettlement;
  assert.equal(warning.threads.length, 0);
} finally { await warning.destroy(); }
console.log('Tiny default thread/process owners retire on asynchronous exceptions and rejections; ordinary failures stay usable.');
