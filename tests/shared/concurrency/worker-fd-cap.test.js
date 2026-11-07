#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  normalizeWorkerPoolConfig,
  resolveWorkerPoolConfig,
  resolveFdConcurrencyCap
} from '../../../src/index/build/workers/config.js';

const requestedWorkers = 32;
const fdPressureConfig = {
  softLimit: 128,
  reserveDescriptors: 64,
  descriptorsPerWorker: 8
};

const fdCap = resolveFdConcurrencyCap(requestedWorkers, {
  fdPressure: fdPressureConfig
});
assert.equal(fdCap, 8, `expected FD cap to clamp worker concurrency to 8; got ${fdCap}`);

const normalized = normalizeWorkerPoolConfig(
  {
    maxWorkers: requestedWorkers,
    fdPressure: fdPressureConfig
  },
  { cpuLimit: 64 }
);
assert.equal(
  normalized.maxWorkers,
  8,
  `expected worker pool maxWorkers to honor FD cap; got ${normalized.maxWorkers}`
);
assert.equal(
  normalized.fdPressure?.cap,
  8,
  `expected worker pool telemetry to expose FD cap=8; got ${normalized.fdPressure?.cap}`
);

console.log('worker fd concurrency cap test passed');

const overridden = resolveWorkerPoolConfig({ maxWorkers: 8,
  fdPressure: { softLimit: 65, reserveDescriptors: 64, descriptorsPerWorker: 4 } },
{ workerPoolMaxWorkers: 8 }, { cpuLimit: 64 });
assert.equal(overridden.fdPressure.cap, 1);
assert.equal(overridden.maxWorkers, 1, 'environment override remains within the original FD cap');
