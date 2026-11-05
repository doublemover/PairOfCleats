import assert from 'node:assert/strict';
import { once } from 'node:events';
import path from 'node:path';
import fs from 'node:fs';
import { createHook } from 'node:async_hooks';
import Piscina from 'piscina';
import { IndexerThreadPool } from '../../../src/index/build/workers/thread-pool.js';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';
import { WORKER_OBSERVATION_QUEUE_BYTES, WORKER_OBSERVATION_QUEUE_EVENTS } from '../../../src/index/build/workers/observation.js';

const filename = path.resolve('tests/indexing/workers/worker-fatal-fixture.js');
const pools = [];
const resources = new Map();
const resourceHook = createHook({
  init(id, type, trigger, resource) {
    if (!['MESSAGEPORT', 'PROCESSWRAP', 'Timeout'].includes(type) || resources.size >= 128) return;
    resources.set(id, { type, trigger, resource: new WeakRef(resource), stack: new Error().stack });
  },
  destroy(id) { resources.delete(id); }
}).enable();
// Bound a survivor failure in the original parallel CI context too. This
// unref'ed assertion cannot keep healthy cleanup alive or turn a leak into 0;
// the outer focused runner retains its independent 30-second hard deadline.
const survivorDeadline = setTimeout(() => {
  assert.fail('Worker fatal fixture retained runtime resources after 25000ms; inspect its survivor receipt.');
}, 25000).unref();
process.once('beforeExit', () => { clearTimeout(survivorDeadline); resourceHook.disable(); });
const create = backend => {
  const pool = backend === 'worker'
    ? new IndexerThreadPool(new Piscina({ filename, name: 'run', minThreads: 1, maxThreads: 1 }))
    : new IndexerProcessPool({ filename, maxThreads: 1, oldSpaceMb: 128, maxRestartAttempts: 1,
      taskTimeout: 3000, budgetAccount: createProcessMemoryAccount(1024 * 1024 * 1024) });
  pools.push({ backend, pool });
  return pool;
};
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
pools.push({ backend: 'worker-warning', pool: warning });
try {
  const fatal = once(warning, 'fatal');
  await assert.rejects(warning.run({ mode: 'rejection' }, { name: 'run' }), { code: 'ERR_WORKER_FATAL' });
  const [error] = await fatal; await error.workerSettlement;
  assert.equal(warning.threads.length, 0);
} finally { await warning.destroy(); }
// This observation cannot keep a completed fixture alive. A surviving runtime
// gets a bounded receipt with the actual libuv handles and original owners;
// neither an unref'ed leaked worker nor forced process exit can qualify cleanup.
setTimeout(() => {
  const receipt = {
    schemaVersion: 1, node: process.version, platform: process.platform, pid: process.pid,
    activeResources: process.getActiveResourcesInfo(),
    resources: [...resources].map(([id, value]) => ({ id, type: value.type, trigger: value.trigger,
      referenced: value.resource.deref()?.hasRef?.(), stack: value.stack })),
    libuv: process.report.getReport().libuv,
    pools: pools.map(({ backend, pool }) => ({ backend, closed: pool.closed, destroyed: pool.destroyed,
      fatal: pool.fatal?.message, ownedThreads: pool.threads.map(worker => worker.threadId),
      vendorThreads: pool.pool?.threads.map(worker => worker.threadId), stats: pool.stats?.() }))
  };
  fs.mkdirSync('.testLogs', { recursive: true });
  fs.writeFileSync(`.testLogs/worker-fatal-runtime-${process.pid}.json`, JSON.stringify(receipt, null, 2));
  console.error('Worker cleanup survivor:', JSON.stringify(receipt));
}, 1000).unref();
console.log('Tiny default thread/process owners retire on asynchronous exceptions and rejections; ordinary failures stay usable.');
