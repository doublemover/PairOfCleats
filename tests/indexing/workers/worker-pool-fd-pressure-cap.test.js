#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeWorkerPoolConfig,
  resolveWorkerPoolConfig
} from '../../../src/index/build/worker-pool.js';

const constrained = normalizeWorkerPoolConfig({
  maxWorkers: 32,
  fdPressure: {
    enabled: true,
    softLimit: 64,
    reserveDescriptors: 16,
    descriptorsPerWorker: 8
  }
}, { cpuLimit: 32 });

assert.equal(constrained.maxWorkers, 6, 'expected fd budget to cap worker concurrency');
assert.equal(constrained.fdPressure?.cap, 6, 'expected fd metadata cap to reflect computed worker cap');
assert.equal(constrained.fdPressure?.softLimit, 64, 'expected fd soft limit metadata to be preserved');
assert.equal(
  constrained.fdPressure?.descriptorsPerWorker,
  8,
  'expected fd descriptors-per-worker metadata to be preserved'
);

const fdDisabled = normalizeWorkerPoolConfig({
  maxWorkers: 32,
  fdPressure: {
    enabled: false,
    softLimit: 64,
    reserveDescriptors: 16,
    descriptorsPerWorker: 8
  }
}, { cpuLimit: 32 });
assert.equal(fdDisabled.maxWorkers, 32, 'expected disabled fd pressure to avoid max worker cap');
assert.equal(fdDisabled.fdPressure?.cap, 32, 'expected disabled fd pressure metadata cap to track requested workers');

const envOverrideConstrained = resolveWorkerPoolConfig(
  {
    maxWorkers: 4,
    fdPressure: {
      enabled: true,
      softLimit: 64,
      reserveDescriptors: 16,
      descriptorsPerWorker: 8
    }
  },
  { workerPoolMaxWorkers: '99' },
  { cpuLimit: 32 }
);
assert.equal(
  envOverrideConstrained.maxWorkers,
  6,
  'expected env maxWorkers override to remain constrained by fd budget'
);
assert.equal(
  envOverrideConstrained.fdPressure?.cap,
  6,
  'expected fd cap metadata to remain synchronized after env overrides'
);

console.log('worker pool fd pressure cap test passed');
