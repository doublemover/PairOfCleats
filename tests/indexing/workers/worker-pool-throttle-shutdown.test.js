#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexerWorkerPool } from '../../../src/index/build/workers/pool.js';
import { createWorkerPoolQueue } from '../../../src/index/build/workers/pool/queue.js';

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
console.log('worker shutdown cancels pre-worker pressure admission and closes physical threads');
