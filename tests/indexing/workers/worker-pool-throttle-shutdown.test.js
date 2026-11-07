#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexerWorkerPool } from '../../../src/index/build/workers/pool.js';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';

const originalMemoryUsage = process.memoryUsage;
const highPressure = Object.assign(() => ({ rss: 2 * 1024 ** 3, heapUsed: 10, heapTotal: 100 }), originalMemoryUsage);
const throttle = { enabled: true, heavyLanguages: ['typescript', 'javascript'], blockHeavyOnHardPressure: true };
const pool = await createIndexerWorkerPool({ config: { enabled: true, maxWorkers: 1, cleanupTimeoutMs: 50,
  memoryPressure: { languageThrottle: throttle } }, memoryPolicy: { maxGlobalRssMb: 1024 },
dictConfig: {}, postingsConfig: {}, log: () => {} });
assert.ok(pool);
const physicalPool = pool.pool;
let tasks = [];
try {
  process.memoryUsage = highPressure;
  const controller = new AbortController();
  const cancelled = assert.rejects(pool.tokenizeChunk({ mode: 'code', languageId: 'typescript', text: 'const cancelled = 1;' },
    { signal: controller.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await cancelled;
  assert.equal(pool.stats().activeTasks, 0, 'external cancellation rejects and drains its admission accounting');
  let completed = 0;
  tasks = throttle.heavyLanguages.map(languageId => pool.tokenizeChunk({ mode: 'code', languageId, text: 'const x = 1;' })
    .then(value => { completed++; return value; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, 0, 'fixture holds both tasks in pre-worker admission');
  await pool.destroy();
  assert.equal(completed, 2, 'destroy settles blocked admission promises without waiting for memory pressure to fall');
  assert.deepEqual(await Promise.all(tasks), [null, null], 'closed pool retains unavailable-result contract');
  assert.equal(physicalPool.threads.length, 0);
  assert.equal(pool.stats().activeTasks, 0, 'blocked task accounting drains too');
  assert.equal(pool.stats().pendingRestart, false);
  const queue = createWorkerPoolQueue({ languageThrottleConfig: { ...throttle, heavyLanguages: new Set(throttle.heavyLanguages) }, maxGlobalRssBytes: 1024 ** 3 });
  queue.close(); queue.close();
  await assert.rejects(queue.acquireLanguageThrottleSlot({ mode: 'code', languageId: 'typescript' }), { name: 'AbortError' });
} finally {
  process.memoryUsage = originalMemoryUsage;
  await Promise.allSettled(tasks);
  await pool.destroy();
}
// An unrecoverable running-task failure must close the same pressure waiters
// even before an explicit destroy call. Otherwise active counters prevent the
// lifecycle's own idle shutdown from ever completing.
const disabled = await createIndexerWorkerPool({ config: { enabled: true, maxWorkers: 1, cleanupTimeoutMs: 50,
  memoryPressure: { languageThrottle: throttle } }, memoryPolicy: { maxGlobalRssMb: 1024 },
dictConfig: {}, postingsConfig: {}, log: () => {} });
assert.ok(disabled);
const disabledPhysical = disabled.pool;
const originalRun = disabledPhysical.run;
let blocked;
try {
  process.memoryUsage = highPressure;
  let settled = false;
  blocked = disabled.tokenizeChunk({ mode: 'code', languageId: 'typescript', text: 'const x = 1;' })
    .then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  disabledPhysical.run = async () => { throw Object.assign(new Error('injected clone failure'), { name: 'DataCloneError' }); };
  assert.equal(await disabled.tokenizeChunk({ mode: 'code', languageId: 'python', text: 'x = 1' }), null);
  assert.equal(await runWithTimeout(() => blocked, { timeoutMs: 1000 }), null,
    'permanent disable closes existing admission waiters without an external destroy');
  assert.equal(settled, true);
  assert.equal(disabled.stats().activeTasks, 0);
  assert.equal(disabled.stats().pendingRestart, false);
  assert.equal(disabledPhysical.threads.length, 0);
} finally {
  process.memoryUsage = originalMemoryUsage;
  disabledPhysical.run = originalRun;
  await disabled.destroy();
  await blocked;
}
console.log('worker shutdown and permanent disable cancel pressure admission and close physical threads');
