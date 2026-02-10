#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';

const resolved = resolveSchedulerConfig({
  argv: {
    scheduler: false,
    'scheduler-cpu': 12,
    'scheduler-low-resource': true
  },
  rawArgv: ['node', 'script', '--scheduler=false', '--scheduler-cpu=12', '--scheduler-low-resource'],
  envConfig: {
    schedulerEnabled: true,
    schedulerCpuTokens: 3,
    schedulerIoTokens: 4,
    schedulerMemoryTokens: 5,
    schedulerStarvationMs: 9999,
    schedulerLowResource: false
  },
  indexingConfig: {
    scheduler: {
      enabled: true,
      cpuTokens: 2,
      ioTokens: 2,
      memoryTokens: 2,
      starvationMs: 15000,
      queues: {
        custom: { priority: 7, maxPending: 9 }
      }
    }
  },
  envelope: {
    concurrency: {
      cpuConcurrency: { value: 6 },
      ioConcurrency: { value: 8 }
    }
  }
});

assert.equal(resolved.enabled, false, 'expected CLI scheduler flag to win');
assert.equal(resolved.lowResourceMode, true, 'expected CLI low-resource flag to win');
assert.equal(resolved.cpuTokens, 12, 'expected CLI cpu tokens to win');
assert.equal(resolved.ioTokens, 4, 'expected env io tokens to be used');
assert.equal(resolved.memoryTokens, 5, 'expected env memory tokens to be used');
assert.equal(resolved.starvationMs, 9999, 'expected env starvation to be used');
assert.equal(resolved.queues.custom.priority, 7);
assert.equal(resolved.queues.custom.maxPending, 9);

const defaults = resolveSchedulerConfig({
  argv: {},
  rawArgv: ['node', 'script'],
  envConfig: {},
  indexingConfig: {},
  envelope: {
    concurrency: {
      cpuConcurrency: { value: 0 },
      ioConcurrency: { value: 0 }
    }
  }
});

assert.equal(defaults.enabled, true, 'expected scheduler to default on');
assert.equal(defaults.lowResourceMode, false, 'expected low-resource to default off');
assert.equal(defaults.cpuTokens, 1, 'expected cpu token clamp to 1');
assert.equal(defaults.ioTokens, 1, 'expected io token clamp to 1');
assert.equal(defaults.memoryTokens, 1, 'expected memory token clamp to 1');
assert.equal(defaults.starvationMs, 30000, 'expected default starvation window');

console.log('scheduler config parse test passed');
