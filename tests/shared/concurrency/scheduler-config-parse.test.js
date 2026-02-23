#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSchedulerConfig } from '../../../src/index/build/runtime/scheduler.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

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
        custom: { priority: 7, maxPending: 9, floorCpu: 2 }
      },
      adaptiveSurfaces: {
        parse: {
          fdPressureThreshold: 0.7
        },
        fdPressure: {
          softLimit: 512,
          reserveDescriptors: 96,
          descriptorsPerToken: 6,
          minTokenCap: 1,
          maxTokenCap: 8,
          highPressureThreshold: 0.91,
          lowPressureThreshold: 0.63
        }
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
assert.equal(resolved.queues.custom.floorCpu, 2);
assert.equal(resolved.adaptiveSurfaces?.surfaces?.parse?.fdPressureThreshold, 0.7);
assert.equal(resolved.adaptiveSurfaces?.fdPressure?.softLimit, 512);
assert.equal(resolved.adaptiveSurfaces?.fdPressure?.reserveDescriptors, 96);
assert.equal(resolved.adaptiveSurfaces?.fdPressure?.descriptorsPerToken, 6);
assert.equal(resolved.adaptiveSurfaces?.fdPressure?.maxTokenCap, 8);
assert.equal(resolved.writeBackpressure.writeQueue, 'stage2.write');
assert.ok(
  Array.isArray(resolved.writeBackpressure.producerQueues)
  && resolved.writeBackpressure.producerQueues.includes('stage1.cpu')
);

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
assert.equal(defaults.adaptive, true, 'expected adaptive scheduler mode to default on');
assert.equal(defaults.cpuTokens, 2, 'expected throughput-first default cpu tokens');
assert.equal(defaults.ioTokens, 2, 'expected throughput-first default io tokens');
assert.equal(defaults.memoryTokens, 2, 'expected throughput-first default memory tokens');
assert.equal(defaults.starvationMs, 30000, 'expected default starvation window');
assert.equal(defaults.queues['stage2.write'].floorIo, 2, 'expected critical write queue floor');
assert.equal(defaults.queues['stage1.postings'].floorCpu, 1, 'expected postings queue floor');
assert.equal(defaults.writeBackpressure.enabled, true, 'expected write backpressure enabled by default');
assert.equal(defaults.writeBackpressure.pendingThreshold, 256, 'expected default write pending threshold');

const autotuned = resolveSchedulerConfig({
  argv: {},
  rawArgv: ['node', 'script'],
  envConfig: {},
  indexingConfig: {},
  envelope: {
    concurrency: {
      cpuConcurrency: { value: 4 },
      ioConcurrency: { value: 4 }
    }
  },
  autoTuneProfile: {
    version: 1,
    sourceBuildId: 'prev-build',
    recommended: {
      maxCpuTokens: 7,
      maxIoTokens: 9,
      maxMemoryTokens: 8
    }
  }
});
assert.equal(autotuned.maxCpuTokens, 7, 'expected max CPU tokens to use autotune recommendation');
assert.equal(autotuned.maxIoTokens, 9, 'expected max IO tokens to use autotune recommendation');
assert.equal(autotuned.maxMemoryTokens, 8, 'expected max memory tokens to use autotune recommendation');
assert.equal(autotuned.autoTune.sourceBuildId, 'prev-build', 'expected autotune source build metadata');

const fdPressureParsed = resolveSchedulerConfig({
  argv: {},
  rawArgv: ['node', 'script'],
  envConfig: {},
  indexingConfig: {
    scheduler: {
      adaptiveSurfaces: {
        fdPressure: {
          highPressureThreshold: 0.42
        },
        surfaces: {
          parse: {
            fdPressureThreshold: 0.39
          }
        }
      }
    }
  },
  envelope: {
    concurrency: {
      cpuConcurrency: { value: 4 },
      ioConcurrency: { value: 4 }
    }
  }
});
assert.equal(
  fdPressureParsed.adaptiveSurfaces.fdPressure.highPressureThreshold,
  0.42,
  'expected fd pressure root config to be preserved'
);
assert.equal(
  fdPressureParsed.adaptiveSurfaces.surfaces.parse.fdPressureThreshold,
  0.39,
  'expected per-surface fd pressure threshold override to be parsed'
);

console.log('scheduler config parse test passed');
