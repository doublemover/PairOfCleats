#!/usr/bin/env node
import assert from 'node:assert/strict';
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

if (!workerPool) {
  console.log('worker pool gc pressure telemetry test skipped (worker pool unavailable).');
  process.exit(0);
}

await workerPool.tokenizeChunk({
  text: 'alphaBeta gammaDelta',
  mode: 'code',
  ext: '.js',
  file: 'telemetry.js',
  size: 24
});

const stats = workerPool.stats();
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

await workerPool.destroy();
console.log('worker pool gc pressure telemetry test passed');
