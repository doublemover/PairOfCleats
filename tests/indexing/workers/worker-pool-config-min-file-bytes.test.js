#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const defaults = normalizeWorkerPoolConfig({}, { cpuLimit: 4 });
assert.equal(defaults.enabled, 'auto', 'expected worker pool default mode to remain auto');
assert.equal(defaults.minFileBytes, 4 * 1024, 'expected worker auto mode to keep tiny-file bypass default');

const explicit = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 4096,
  maxFileBytes: 8192
}, { cpuLimit: 4 });
assert.equal(explicit.minFileBytes, 4096, 'expected explicit minFileBytes to be respected');

const clamped = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 32768,
  maxFileBytes: 8192
}, { cpuLimit: 4 });
assert.equal(clamped.minFileBytes, 8192, 'expected minFileBytes to clamp to maxFileBytes');

const disabled = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 0
}, { cpuLimit: 4 });
assert.equal(disabled.minFileBytes, null, 'expected minFileBytes=0 to disable tiny-file bypass');

const autoPoolConfig = normalizeWorkerPoolConfig({
  enabled: 'auto',
  minFileBytes: 4096,
  maxWorkers: 1
}, { cpuLimit: 1 });
const workerPool = await createIndexerWorkerPool({
  config: autoPoolConfig,
  dictWords: new Set(['alpha', 'beta']),
  dictConfig: { segmentation: 'auto' },
  postingsConfig: {}
});
if (workerPool) {
  assert.equal(
    workerPool.shouldUseForFile(undefined),
    false,
    'expected unknown file sizes to respect minFileBytes bypass'
  );
  assert.equal(
    workerPool.shouldUseForFile(1024),
    false,
    'expected tiny files below minFileBytes to bypass worker pool'
  );
  assert.equal(
    workerPool.shouldUseForFile(8192),
    true,
    'expected files above minFileBytes to use worker pool in auto mode'
  );
  await workerPool.destroy();
} else {
  console.log('worker pool config min file bytes test skipped runtime checks (worker pool unavailable).');
}

console.log('worker pool config min file bytes test passed');
