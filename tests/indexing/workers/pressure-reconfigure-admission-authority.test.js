import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createIndexerWorkerPool } from '../../../src/index/build/workers/pool.js';

const until = async predicate => {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await tick();
  assert.ok(predicate());
};
const pool = await createIndexerWorkerPool({ config: { enabled: true, maxWorkers: 2, cleanupTimeoutMs: 1000,
  heapTargetMb: 256, heapMinMb: 256, heapMaxMb: 256, processFallback: true,
  autoDownscaleOnPressure: true, downscaleMinWorkers: 1,
  memoryPressure: { languageThrottle: { enabled: true, heavyLanguages: ['typescript'], blockHeavyOnHardPressure: true } } },
memoryPolicy: { maxGlobalRssMb: 1024 }, dictConfig: {}, postingsConfig: {}, log: () => {} });
assert.ok(pool, 'pressure reconfiguration requires an actual owned worker pool');
assert.equal(pool.stats().configuredMaxWorkers, 2, 'fixture needs an independently reducible worker count');
const controller = new AbortController();
const originalMemoryUsage = process.memoryUsage;
const requests = [];
let settled = 0;
try {
  process.memoryUsage = Object.assign(() => ({ heapUsed: 999, heapTotal: 1000, rss: 1024 * 1024 * 900 }), originalMemoryUsage);
  const submit = () => pool.tokenizeChunk({ mode: 'code', languageId: 'typescript', text: 'const value = 1;' },
    { signal: controller.signal }).then(value => { settled++; return value; }, error => { settled++; return error; });
  requests.push(submit());
  await until(() => pool.stats().disabled && pool.stats().pendingRestart);
  assert.equal(pool.shouldUseForFile(1000), true,
    'pressure-disabled backend still routes through pressure admission instead of unbounded inline fallback');
  requests.push(submit());
  await until(() => pool.stats().waitingForThrottle === 2);
  assert.equal(settled, 0, 'both callers retain admission ownership while relief waits for idle');
  assert.deepEqual(pool.stats().memoryPressure.languageThrottle.activeByLanguage, {});
  controller.abort();
  const outcomes = await Promise.all(requests);
  assert.ok(outcomes.every(error => error?.name === 'AbortError'));
  assert.equal(pool.stats().activeTasks, 0);
  assert.equal(pool.stats().memoryPressure.languageThrottle.refreshTimerCount, 0);
} finally {
  process.memoryUsage = originalMemoryUsage;
  controller.abort(); await Promise.allSettled(requests); await pool.destroy();
}
console.log('pressure-driven backend reconfiguration preserves tokenizer admission authority');
