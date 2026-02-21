#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';

const defaults = normalizeWorkerPoolConfig({ maxWorkers: 16 }, { cpuLimit: 16 });
assert.equal(defaults.numaPinning.enabled, false, 'expected NUMA pinning to default off');
assert.equal(defaults.numaPinning.strategy, 'interleave', 'expected default NUMA strategy');
assert.equal(defaults.numaPinning.minCpuCores, 24, 'expected default NUMA CPU floor');
assert.equal(defaults.numaPinning.nodeCount, null, 'expected default nodeCount to be unset');

const compact = normalizeWorkerPoolConfig({
  maxWorkers: 32,
  numaPinning: {
    enabled: true,
    strategy: 'compact',
    minCpuCores: 48,
    nodeCount: 4
  }
}, { cpuLimit: 32 });

assert.equal(compact.numaPinning.enabled, true, 'expected explicit NUMA enable');
assert.equal(compact.numaPinning.strategy, 'compact', 'expected compact strategy');
assert.equal(compact.numaPinning.minCpuCores, 48, 'expected explicit minCpuCores');
assert.equal(compact.numaPinning.nodeCount, 4, 'expected explicit node count');

const fallback = normalizeWorkerPoolConfig({
  maxWorkers: 32,
  numaPinning: {
    enabled: true,
    strategy: 'unknown'
  }
}, { cpuLimit: 32 });

assert.equal(fallback.numaPinning.strategy, 'interleave', 'expected unknown strategy fallback');

console.log('worker pool NUMA pinning config test passed');
