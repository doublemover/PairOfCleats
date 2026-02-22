#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fixedScheduler = createBuildScheduler({
  adaptive: true,
  adaptiveIntervalMs: 1,
  cpuTokens: 8,
  ioTokens: 8,
  memoryTokens: 8,
  queues: {
    'stage1.cpu': { priority: 10, surface: 'parse' }
  },
  adaptiveSurfaces: {
    enabled: true,
    parse: {
      minConcurrency: 1,
      maxConcurrency: 1,
      initialConcurrency: 1,
      upCooldownMs: 0,
      downCooldownMs: 0,
      oscillationGuardMs: 0
    }
  }
});

let parseActive = 0;
let parsePeak = 0;
await Promise.all(
  Array.from({ length: 4 }, () => fixedScheduler.schedule('stage1.cpu', { cpu: 1 }, async () => {
    parseActive += 1;
    parsePeak = Math.max(parsePeak, parseActive);
    await sleep(15);
    parseActive -= 1;
  }))
);

assert.equal(parsePeak, 1, 'expected parse surface cap to enforce max concurrency of 1');
assert.equal(
  fixedScheduler.stats()?.adaptive?.surfaces?.parse?.currentConcurrency,
  1,
  'expected parse currentConcurrency to honor fixed surface cap'
);
fixedScheduler.shutdown();

let nowMs = 0;
let sampledMemoryPressure = 0.2;
const adaptiveScheduler = createBuildScheduler({
  adaptive: true,
  adaptiveIntervalMs: 1,
  now: () => nowMs,
  cpuTokens: 6,
  ioTokens: 6,
  memoryTokens: 6,
  queues: {
    'stage1.cpu': { priority: 10, surface: 'parse' }
  },
  adaptiveSurfaces: {
    enabled: true,
    decisionTraceMaxSamples: 64,
    parse: {
      minConcurrency: 1,
      maxConcurrency: 4,
      initialConcurrency: 1,
      upBacklogPerSlot: 0.25,
      downBacklogPerSlot: 0,
      upWaitMs: 0,
      downWaitMs: 0,
      upCooldownMs: 0,
      downCooldownMs: 0,
      oscillationGuardMs: 0,
      targetUtilization: 0.95,
      memoryPressureThreshold: 0.9,
      gcPressureThreshold: 0.9,
      ioPressureThreshold: 0.95
    }
  },
  adaptiveSignalSampler: () => ({
    cpu: {
      tokenUtilization: 0.2,
      loadRatio: 0.2
    },
    memory: {
      pressureScore: sampledMemoryPressure,
      gcPressureScore: 0
    }
  })
});

const scaleUpTasks = [];
for (let i = 0; i < 6; i += 1) {
  nowMs += 20;
  scaleUpTasks.push(
    adaptiveScheduler.schedule('stage1.cpu', { cpu: 1 }, async () => sleep(30))
  );
}

await sleep(10);
const scaledUpStats = adaptiveScheduler.stats();
const scaledUpConcurrency = scaledUpStats?.adaptive?.surfaces?.parse?.currentConcurrency || 0;
assert.ok(
  scaledUpConcurrency >= 2,
  `expected parse surface to scale up under backlog pressure, got ${scaledUpConcurrency}`
);
assert.ok(
  Array.isArray(scaledUpStats?.adaptive?.decisionTrace)
    && scaledUpStats.adaptive.decisionTrace.some((entry) => entry?.surface === 'parse' && entry?.action === 'up'),
  'expected replayable adaptive decision trace to include parse scale-up decisions'
);

await Promise.all(scaleUpTasks);

sampledMemoryPressure = 1;
for (let i = 0; i < 4; i += 1) {
  nowMs += 30;
  await adaptiveScheduler.schedule('stage1.cpu', { cpu: 1 }, async () => null);
}

const scaledDownStats = adaptiveScheduler.stats();
assert.equal(
  scaledDownStats?.adaptive?.surfaces?.parse?.currentConcurrency,
  1,
  'expected parse surface to scale back down to floor under sustained memory pressure'
);
assert.ok(
  scaledDownStats?.adaptive?.decisionTrace?.some((entry) => entry?.surface === 'parse' && entry?.action === 'down'),
  'expected adaptive decision trace to include parse scale-down decisions'
);
adaptiveScheduler.shutdown();

console.log('scheduler adaptive surfaces test passed');
