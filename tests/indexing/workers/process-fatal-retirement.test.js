import assert from 'node:assert/strict';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';

const pool = new IndexerProcessPool({ maxThreads: 1, oldSpaceMb: 128, taskTimeout: 3000,
  filename: path.resolve('tests/indexing/workers/worker-fatal-fixture.js'), maxRestartAttempts: 1,
  budgetAccount: createProcessMemoryAccount(1024 * 1024 * 1024) });
const originalStop = pool.stop.bind(pool);
let allowed = false, firstStop;
const attempted = new Promise(resolve => { firstStop = resolve; });
pool.stop = async slot => {
  if (!allowed) { firstStop(slot); throw new Error('Controlled stop failure retains original child.'); }
  return originalStop(slot);
};
const errors = []; pool.on('error', error => errors.push(error));
pool.on('fatal', () => { throw new Error('Broken fatal logger cannot resume this owner.'); });
let future;
try {
  const work = pool.run({ mode: 'report-only', bytes: Buffer.alloc(4096) }, { name: 'run' });
  let failure;
  await assert.rejects(work, error => { failure = error; return error.code === 'ERR_WORKER_FATAL'; });
  const slot = await attempted;
  const retained = pool.stats();
  assert.equal(retained.runningTasks, 1); assert.equal(retained.terminatingTasks, 1);
  assert.equal(retained.ipcReservedBytes > 0, true); assert.equal(failure.workerOwnershipPending, true);
  const deadline = Date.now() + 1000;
  while (pool.stats().staleResults === 0 && Date.now() < deadline) await tick();
  assert.ok(pool.stats().staleResults > 0, 'controlled late result reached the receiver');
  assert.equal(pool.stats().completed, 0, 'late result from poisoned owner is never clean work');
  future = pool.run({ value: 'replacement only' }, { name: 'run' });
  await tick(); assert.equal(pool.stats().started, 1, 'future work cannot reuse retained poisoned process');
  assert.equal(errors.length > 0, true);
  allowed = true; await pool.stop(slot); await failure.workerSettlement;
  assert.equal(failure.workerOwnershipReleased(), true);
  assert.equal((await future).value, 'replacement only');
  assert.equal(pool.stats().restarts, 1);
  // A second sequential fatality exhausts the allowance even with no queued
  // request at close. A later caller cannot reset the allowance by waiting.
  let second;
  await assert.rejects(pool.run({ mode: 'exception' }, { name: 'run' }), error => {
    second = error; return ['ERR_WORKER_FATAL', 'ERR_PROCESS_TASK_EXIT'].includes(error.code);
  });
  await second.workerSettlement;
  await assert.rejects(pool.run({ value: 'must not start third child' }, { name: 'run' }), { code: 'ERR_WORKER_FATAL' });
} finally {
  allowed = true; await pool.destroy();
  if (future) await future.catch(() => {});
  assert.equal(pool.stats().ipcReservedBytes, 0); assert.equal(pool.stats().aggregate.reservedBytes, 0);
}
console.log('Process fatal retirement preserves IPC reservations until actual close, fences late results and bounds sequential restarts.');
