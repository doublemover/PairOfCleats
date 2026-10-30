#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';

const filename = path.resolve('tests/indexing/workers/process-pool-controlled-child.js');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const create = options => new IndexerProcessPool({ maxThreads: 2, oldSpaceMb: 128, taskTimeout: 3000,
  budgetAccount: createProcessMemoryAccount(1024 * 1024 * 1024), filename, maxRestartAttempts: 1, ...options });
const clean = async (pool, pids) => {
  await pool.destroy();
  const stats = pool.stats();
  assert.equal(stats.ownedChildren, 0); assert.equal(stats.queuedTasks, 0); assert.equal(stats.runningTasks, 0);
  assert.equal(stats.ipcReservedBytes, 0); assert.equal(stats.aggregate.reservedBytes, 0);
  for (const pid of pids) assert.equal(alive(pid), false, 'owned task process must be joined after teardown');
};
let pool = create(), pids = new Set(), observations = [];
pool.on('workerCreate', child => pids.add(child.pid));
pool.on('message', message => { if (message.type === 'worker-runtime') { pids.add(message.threadId); observations.push(message.observation); } });
try {
  const results = await Promise.all([pool.run({ id: 1, waitMs: 100, stale: true }, { name: 'quantizeVectors' }),
    pool.run({ id: 2, waitMs: 100 }, { name: 'quantizeVectors' })]);
  assert.deepEqual(results.map(result => result.id), [1, 2], 'result scatter remains caller ordered');
  assert.equal(new Set(results.map(result => result.pid)).size, 2);
  assert.equal(pool.stats().peakChildren, 2);
  assert.equal(pool.stats().peakRunningTasks, 2, 'controlled tasks overlap without increasing capacity');
  assert.ok(pool.stats().staleResults > 0);
  for (const observation of observations) {
    assert.equal(observation.startupInputs.maxOldSpaceMb.value, 128);
    assert.ok(observation.heapSizeLimitBytes < 256 * 1024 * 1024);
  }
  await assert.rejects(pool.run({ oversize: true }, { name: 'quantizeVectors' }), { code: 'ERR_PROCESS_TASK_BUDGET' });
} finally { await clean(pool, pids); }

for (const variant of ['pre', 'queued', 'active', 'initialization', 'crash', 'disconnect']) {
  pool = create({ maxThreads: 1, ...(variant === 'initialization' ? { workerData: { failInitialization: true } } : {}) });
  pids = new Set();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  pool.on('workerCreate', child => pids.add(child.pid));
  pool.on('message', message => {
    if (message.type === 'worker-runtime') pids.add(message.threadId);
    if (message.type === 'worker-task' && message.status === 'start') started();
  });
  try {
    const abort = new AbortController();
    if (variant === 'pre') {
      abort.abort(); await assert.rejects(pool.run({ id: 1 }, { name: 'quantizeVectors', signal: abort.signal }), { name: 'AbortError' });
      assert.equal(pool.stats().ownedChildren, 0);
    } else if (variant === 'initialization') {
      await assert.rejects(pool.run({ id: 1 }, { name: 'quantizeVectors' }), { code: 'ERR_PROCESS_TASK_INITIALIZATION' });
    } else if (variant === 'crash' || variant === 'disconnect') {
      const failed = pool.run({ id: 1, [variant]: true }, { name: 'quantizeVectors' });
      const resumed = pool.run({ id: 2 }, { name: 'quantizeVectors' });
      // Observe immediately while the first task's failure is asserted; a
      // failed assertion must not turn cleanup of the sibling into an unhandled rejection.
      resumed.catch(() => {});
      await assert.rejects(failed, { code: 'ERR_PROCESS_TASK_EXIT' });
      assert.equal((await resumed).id, 2);
      assert.equal(pool.stats().restarts, 1);
    } else {
      const held = pool.run({ id: 1, waitMs: 300 }, { name: 'quantizeVectors', ...(variant === 'active' ? { signal: abort.signal } : {}) });
      await Promise.race([ready, held.then(() => { throw new Error(`${variant}: task completed before its start observation`); })]);
      if (variant === 'queued') {
        const queued = pool.run({ id: 2 }, { name: 'quantizeVectors', signal: abort.signal });
        abort.abort(); await assert.rejects(queued, { name: 'AbortError' }); await held;
      } else { abort.abort(); await assert.rejects(held, { name: 'AbortError' }); }
    }
  } finally { await clean(pool, pids); }
}
// Caller settlement is not storage release: cancellation, timeout and destroy
// must retain the active task's reservation through confirmed child termination.
for (const variant of ['abort', 'timeout', 'destroy']) {
  const account = createProcessMemoryAccount(1024 * 1024 * 1024);
  pool = create({ maxThreads: 1, taskTimeout: 300, budgetAccount: account });
  pids = new Set();
  let started, allowStop;
  const ready = new Promise(resolve => { started = resolve; });
  const stopGate = new Promise(resolve => { allowStop = resolve; });
  const originalStop = pool.stop.bind(pool);
  pool.stop = async slot => { await stopGate; return originalStop(slot); };
  pool.on('workerCreate', child => pids.add(child.pid));
  pool.on('message', message => { if (message.type === 'worker-task' && message.status === 'start') started(); });
  const abort = new AbortController();
  const work = pool.run({ bytes: Buffer.alloc(1024 * 1024), retainUntilExit: true },
    { name: 'quantizeVectors', signal: abort.signal });
  const rejected = assert.rejects(work, variant === 'timeout' ? { code: 'ERR_PROCESS_TASK_TIMEOUT' } : { name: 'AbortError' });
  let destroying;
  try {
    await ready;
    const before = pool.stats();
    if (variant === 'abort') abort.abort();
    if (variant === 'destroy') destroying = pool.destroy();
    await rejected;
    const during = pool.stats();
    assert.equal(during.ipcReservedBytes, before.ipcReservedBytes);
    assert.equal(during.aggregate.reservedBytes, before.aggregate.reservedBytes);
    assert.equal(during.runningTasks, 1);
    assert.equal(during.terminatingTasks, 1);
    for (const pid of pids) assert.equal(alive(pid), true);
    // The same account must not lend cancelled-but-still-owned storage to a
    // sibling pool. This reservation would fit only if the task were released.
    const candidateBytes = account.stats().limitBytes - account.stats().parentRssBytes
      - before.aggregate.reservedBytes + Math.floor(before.ipcReservedBytes / 2);
    assert.throws(() => account.reserve(candidateBytes), { code: 'ERR_PROCESS_TASK_BUDGET' });
    const slot = [...pool.children][0];
    allowStop();
    await slot.exited;
    if (destroying) await destroying;
    assert.equal(pool.stats().ipcReservedBytes, 0);
    assert.equal(pool.stats().terminatingTasks, 0);
    const release = account.reserve(candidateBytes);
    release();
  } finally {
    allowStop();
    await clean(pool, pids);
  }
}
console.log('Bounded process overlap, task fencing, IPC caps, cancellation, initialization failure and one restart drain cleanly.');
