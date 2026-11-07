import assert from 'node:assert/strict';
import path from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { IndexerProcessPool, createProcessMemoryAccount } from '../../../src/index/build/workers/process-pool.js';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';

// AUTHORED actual child transport/scheduler integration; native execution deferred.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1) || 'abort';
let releaseStop, workerStarted, failureObserved;
const stopGate = new Promise(resolve => { releaseStop = resolve; });
const started = new Promise(resolve => { workerStarted = resolve; });
const failed = new Promise(resolve => { failureObserved = resolve; });
const account = createProcessMemoryAccount(process.memoryUsage().rss + 512 * 1024 * 1024);
const pool = new IndexerProcessPool({ maxThreads: 1, oldSpaceMb: 128, taskTimeout: selected === 'timeout' ? 300 : 5000,
  budgetAccount: account, filename: path.resolve('tests/indexing/workers/process-pool-controlled-child.js') });
const scheduler = createBuildScheduler({ cpuTokens: 1, maxInFlightBytes: 1000 });
const stop = pool.stop.bind(pool);
pool.stop = async slot => { await stopGate; return stop(slot); };
pool.on('message', message => { if (message.type === 'worker-task' && message.status === 'start') workerStarted(); });
const controller = new AbortController();
let original, publicSettled = false, readyRan = false, destroying;
const work = scheduler.schedule('file', { cpu: 1, bytes: 300 }, async () => {
  try { return await pool.run({ bytes: Buffer.alloc(1024), retainUntilExit: true }, { name: 'tokenizeChunk', signal: controller.signal }); }
  catch (error) { original = error; failureObserved(); throw error; }
});
const rejected = assert.rejects(work, selected === 'timeout' ? { code: 'ERR_PROCESS_TASK_TIMEOUT' } : { name: 'AbortError' });
work.finally(() => { publicSettled = true; }).catch(() => {});
try {
  await started;
  if (selected === 'abort') controller.abort();
  if (selected === 'destroy') destroying = pool.destroy();
  await failed;
  assert.equal(original.workerOwnershipPending, true);
  assert.equal(original.workerOwnershipReleased(), false);
  assert.ok(original.workerSettlement instanceof Promise);
  assert.equal(publicSettled, false, 'scheduled file cannot retire before original child joins');
  assert.equal(scheduler.stats().tokens.cpu.used, 1, 'terminating worker still owns compute reservation');
  assert.equal(scheduler.stats().activity.inFlightBytes, 300);
  const ready = scheduler.schedule('ready', { cpu: 1 }, () => { readyRan = true; });
  await tick(); assert.equal(readyRan, false, 'another task cannot borrow terminating child CPU');
  releaseStop();
  await original.workerSettlement;
  await rejected; await ready;
  if (destroying) await destroying;
  assert.equal(original.workerOwnershipPending, false);
  assert.equal(original.workerOwnershipReleased(), true);
  assert.equal(scheduler.stats().tokens.cpu.used, 0);
  assert.equal(scheduler.stats().activity.inFlightBytes, 0);
  assert.equal(pool.stats().ipcReservedBytes, 0);
} finally {
  releaseStop(); controller.abort(); await Promise.allSettled([work, destroying].filter(Boolean));
  await pool.destroy(); await scheduler.shutdown({ awaitRunning: true, timeoutMs: 1000 });
}
assert.equal(account.stats().reservedBytes, 0);
console.log(`process ${selected} keeps actual scheduler CPU and bytes until child close`);
