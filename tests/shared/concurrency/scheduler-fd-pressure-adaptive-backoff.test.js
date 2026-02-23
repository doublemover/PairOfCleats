#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

let nowMs = 0;
let sampledFdPressure = 1;
let sampledFdTokenCap = 1;

const scheduler = createBuildScheduler({
  adaptive: true,
  adaptiveIntervalMs: 1,
  now: () => nowMs,
  cpuTokens: 6,
  ioTokens: 6,
  memoryTokens: 4,
  queues: {
    'stage1.cpu': { priority: 10, surface: 'parse' }
  },
  adaptiveSurfaces: {
    enabled: true,
    parse: {
      minConcurrency: 1,
      maxConcurrency: 4,
      initialConcurrency: 4,
      upBacklogPerSlot: 0.25,
      downBacklogPerSlot: 0,
      upWaitMs: 0,
      downWaitMs: 0,
      upCooldownMs: 0,
      downCooldownMs: 0,
      oscillationGuardMs: 0,
      fdPressureThreshold: 0.7
    },
    fdPressure: {
      softLimit: 128,
      reserveDescriptors: 32,
      descriptorsPerToken: 8,
      minTokenCap: 1,
      maxTokenCap: 6,
      highPressureThreshold: 0.85,
      lowPressureThreshold: 0.6
    }
  },
  adaptiveSignalSampler: () => ({
    cpu: {
      tokenUtilization: 0.2,
      loadRatio: 0.2
    },
    memory: {
      pressureScore: 0.2,
      gcPressureScore: 0
    },
    fd: {
      softLimit: 128,
      reserveDescriptors: 32,
      tokenCap: sampledFdTokenCap,
      pressureScore: sampledFdPressure
    }
  })
});

for (let i = 0; i < 8; i += 1) {
  nowMs += 80;
  await scheduler.schedule('stage1.cpu', { cpu: 1 }, async () => null);
}

const stats = scheduler.stats();
assert.equal(
  stats?.adaptive?.fd?.tokenCap,
  1,
  'expected FD token cap telemetry to clamp to sampled budget'
);
assert.ok(
  Number(stats?.tokens?.io?.total) <= 1,
  `expected IO token pool to back off under FD pressure; got ${Number(stats?.tokens?.io?.total)}`
);
assert.equal(
  stats?.adaptive?.surfaces?.parse?.currentConcurrency,
  1,
  'expected parse surface to scale down to floor under sustained FD pressure'
);
assert.ok(
  Array.isArray(stats?.adaptive?.decisionTrace)
    && stats.adaptive.decisionTrace.some((entry) => entry?.surface === 'parse' && entry?.reason === 'fd-pressure'),
  'expected adaptive decision trace to capture FD-pressure scale-down decisions'
);
assert.ok(
  Number(stats?.adaptive?.signals?.fd?.pressureScore) >= 1,
  'expected FD pressure signal telemetry to reflect saturated descriptor pressure'
);

scheduler.shutdown();

console.log('scheduler fd pressure adaptive backoff test passed');
