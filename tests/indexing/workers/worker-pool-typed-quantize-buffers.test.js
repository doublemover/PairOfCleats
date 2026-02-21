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
  dictWords: new Set(['alpha']),
  dictConfig: { segmentation: 'auto' },
  postingsConfig: {}
});

if (!workerPool) {
  console.log('worker pool typed quantize buffers test skipped (worker pool unavailable).');
  process.exit(0);
}

const payload = {
  vectors: [
    [0, 0.25, 1],
    [-1, 0.5, 0.75]
  ],
  levels: 64
};
const payloadBefore = JSON.stringify(payload);

const result = await workerPool.runQuantize(payload);
assert.ok(Array.isArray(result), 'expected quantize result array from worker');
assert.equal(
  JSON.stringify(payload),
  payloadBefore,
  'expected typed temporary buffers to avoid mutating caller payload'
);

const stats = workerPool.stats();
assert.ok(
  Number.isFinite(stats.quantizeTypedTempBuffers) && stats.quantizeTypedTempBuffers >= payload.vectors.length,
  'expected quantize stats to report typed temporary buffer usage'
);

await workerPool.destroy();
console.log('worker pool typed quantize buffers test passed');
