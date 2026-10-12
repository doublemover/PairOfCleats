#!/usr/bin/env node
import assert from 'node:assert/strict';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { runWithTimeout } from '../../../src/shared/promise-timeout.js';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const workerConfig = normalizeWorkerPoolConfig({
  enabled: true,
  maxWorkers: 1,
  taskTimeoutMs: 5000
}, { cpuLimit: 1 });

const workerPool = await createIndexerWorkerPool({
  config: workerConfig,
  dictWords: new Set(['alpha', 'beta']),
  dictConfig: { segmentation: 'auto' },
  postingsConfig: {},
  stage: 'stage1'
});

assert.ok(workerPool, 'expected the verified native worker pool to be available');
try {
  const result = await workerPool.tokenizeChunk({
    text: 'alphaBeta gammaDelta',
    mode: 'code',
    ext: '.js',
    file: 'telemetry.js',
    size: 24
  });

  assert.ok(result, 'expected an actual worker result, not an unavailable-pool fallback');
  // Timing uses parentPort messages while Piscina returns task results through its
  // own channel. Task completion does not guarantee telemetry delivery order.
  const stats = await runWithTimeout(async (signal) => {
    while (true) {
      throwIfAborted(signal);
      const observed = workerPool.stats();
      if (observed.gcPressure?.samples >= 1) return observed;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }, { timeoutMs: 1000 });
  assert.ok(stats.gcPressure && typeof stats.gcPressure === 'object', 'expected gcPressure stats payload');
  assert.equal(stats.gcPressure.stage, 'stage1', 'expected gcPressure stage label');
  assert.ok(
    Number.isFinite(stats.gcPressure.samples) && stats.gcPressure.samples >= 1,
    'expected gcPressure sample count after worker task execution'
  );
  assert.ok(
    Number.isFinite(stats.gcPressure.global?.pressureRatio),
    'expected gcPressure global pressure ratio'
  );
  assert.ok(Array.isArray(stats.gcPressure.workers), 'expected per-worker gcPressure entries');

} finally {
  await workerPool.destroy();
}
console.log('worker pool gc pressure telemetry test passed');
