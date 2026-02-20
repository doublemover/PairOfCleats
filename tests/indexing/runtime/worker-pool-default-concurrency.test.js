#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveWorkerPoolRuntimeConfig } from '../../../src/index/build/runtime/workers.js';

const highConcurrency = resolveWorkerPoolRuntimeConfig({
  indexingConfig: {},
  envConfig: {},
  cpuConcurrency: 32,
  fileConcurrency: 32
});
assert.strictEqual(highConcurrency.maxWorkers, 32, 'expected default maxWorkers cap to scale to cpu/file concurrency');

const boundedByFiles = resolveWorkerPoolRuntimeConfig({
  indexingConfig: {},
  envConfig: {},
  cpuConcurrency: 32,
  fileConcurrency: 6
});
assert.strictEqual(
  boundedByFiles.maxWorkers,
  32,
  'expected default maxWorkers to track cpu concurrency even when file concurrency is lower'
);

const hardCapped = resolveWorkerPoolRuntimeConfig({
  indexingConfig: { workerPool: { maxWorkers: 64 } },
  envConfig: {},
  cpuConcurrency: 32,
  fileConcurrency: 32
});
assert.strictEqual(hardCapped.maxWorkers, 32, 'expected workerPool maxWorkers hard cap at 32');

console.log('worker pool default concurrency test passed');
