#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createAdaptiveWriteConcurrencyController,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass
} from '../../../src/index/build/artifacts-write.js';

let nowMs = 0;
const controller = createAdaptiveWriteConcurrencyController({
  maxConcurrency: 6,
  minConcurrency: 2,
  initialConcurrency: 2,
  scaleUpBacklogPerSlot: 1.5,
  scaleDownBacklogPerSlot: 0.5,
  stallScaleDownSeconds: 12,
  stallScaleUpGuardSeconds: 6,
  scaleUpCooldownMs: 0,
  scaleDownCooldownMs: 0,
  now: () => nowMs
});

assert.equal(controller.getCurrentConcurrency(), 2, 'expected explicit initial concurrency');

nowMs += 1;
assert.equal(
  controller.observe({ pendingWrites: 8, activeWrites: 2, longestStallSec: 1 }),
  3,
  'expected backlog pressure to scale concurrency up'
);

nowMs += 1;
assert.equal(
  controller.observe({ pendingWrites: 9, activeWrites: 3, longestStallSec: 1 }),
  4,
  'expected repeated backlog pressure to continue scaling up'
);

nowMs += 1;
assert.equal(
  controller.observe({
    pendingWrites: 3,
    activeWrites: 4,
    longestStallSec: 14,
    schedulerWritePending: 0,
    schedulerWriteOldestWaitMs: 0,
    schedulerWriteWaitP95Ms: 0
  }),
  4,
  'expected non-write stalls to avoid write-concurrency scale down'
);

nowMs += 1;
assert.equal(
  controller.observe({
    pendingWrites: 3,
    activeWrites: 4,
    longestStallSec: 14,
    schedulerWritePending: 4,
    schedulerWriteOldestWaitMs: 2200,
    schedulerWriteWaitP95Ms: 1200
  }),
  3,
  'expected queue-attributed stalls to scale concurrency down'
);

nowMs += 1;
assert.equal(
  controller.observe({
    pendingWrites: 2,
    activeWrites: 3,
    longestStallSec: 20,
    schedulerWritePending: 4,
    schedulerWriteOldestWaitMs: 2600,
    schedulerWriteWaitP95Ms: 1400
  }),
  2,
  'expected repeated sustained stalls to continue scaling down'
);

nowMs += 1;
assert.equal(
  controller.observe({
    pendingWrites: 2,
    activeWrites: 2,
    longestStallSec: 20,
    schedulerWritePending: 5,
    schedulerWriteOldestWaitMs: 4000,
    schedulerWriteWaitP95Ms: 1800
  }),
  2,
  'expected minConcurrency floor to hold under continued stall pressure'
);

let cooledNowMs = 0;
const cooledController = createAdaptiveWriteConcurrencyController({
  maxConcurrency: 5,
  minConcurrency: 1,
  initialConcurrency: 2,
  scaleUpBacklogPerSlot: 1.2,
  stallScaleDownSeconds: 10,
  scaleUpCooldownMs: 100,
  scaleDownCooldownMs: 100,
  now: () => cooledNowMs
});

assert.equal(
  cooledController.observe({ pendingWrites: 6, activeWrites: 2, longestStallSec: 0 }),
  3,
  'expected first backlog observation to scale up'
);
assert.equal(
  cooledController.observe({ pendingWrites: 6, activeWrites: 3, longestStallSec: 0 }),
  3,
  'expected scale-up cooldown to suppress immediate second increase'
);
cooledNowMs += 150;
assert.equal(
  cooledController.observe({ pendingWrites: 6, activeWrites: 3, longestStallSec: 0 }),
  4,
  'expected scale-up cooldown to expire after configured window'
);

let memoryNowMs = 0;
const memoryEvents = [];
const memoryController = createAdaptiveWriteConcurrencyController({
  maxConcurrency: 6,
  minConcurrency: 2,
  initialConcurrency: 4,
  scaleUpBacklogPerSlot: 1.2,
  stallScaleDownSeconds: 10,
  scaleUpCooldownMs: 0,
  scaleDownCooldownMs: 0,
  now: () => memoryNowMs,
  onChange: (event) => {
    memoryEvents.push(event);
  }
});

memoryNowMs += 1;
assert.equal(
  memoryController.observe({
    pendingWrites: 4,
    activeWrites: 4,
    longestStallSec: 0,
    memoryPressure: 0.95,
    gcPressure: 0.1,
    rssUtilization: 0.82
  }),
  3,
  'expected high memory pressure to scale concurrency down'
);
assert.equal(memoryEvents.at(-1)?.reason, 'memory-pressure', 'expected memory-pressure event reason');

memoryNowMs += 1;
assert.equal(
  memoryController.observe({
    pendingWrites: 3,
    activeWrites: 2,
    longestStallSec: 0,
    memoryPressure: 0.42,
    gcPressure: 0.08,
    rssUtilization: 0.41
  }),
  4,
  'expected low pressure + backlog to restore concurrency'
);
assert.equal(memoryEvents.at(-1)?.reason, 'memory-headroom', 'expected memory-headroom event reason');

const ntfsStrategy = resolveArtifactWriteFsStrategy({
  platform: 'win32',
  artifactConfig: {
    writeFsStrategy: 'auto'
  }
});
assert.equal(ntfsStrategy.mode, 'ntfs', 'expected windows auto strategy to default ntfs mode');
assert.equal(ntfsStrategy.microCoalescing, true, 'expected micro-coalescing enabled by default');

const genericStrategy = resolveArtifactWriteFsStrategy({
  platform: 'linux',
  artifactConfig: {
    writeFsStrategy: 'generic',
    writeTailWorker: false,
    writeJsonlPresize: false
  }
});
assert.equal(genericStrategy.mode, 'generic', 'expected explicit generic strategy');
assert.equal(genericStrategy.tailWorker, false, 'expected tail worker toggle to apply');
assert.equal(genericStrategy.presizeJsonl, false, 'expected jsonl presize toggle to apply');

assert.equal(
  resolveArtifactWriteLatencyClass({ queueDelayMs: 2, durationMs: 20, bytes: 2048 }),
  'micro:instant',
  'expected short micro write to classify as instant'
);
assert.equal(
  resolveArtifactWriteLatencyClass({ queueDelayMs: 2500, durationMs: 100, bytes: 40 * 1024 * 1024 }),
  'large:tail',
  'expected long queued large write to classify as tail'
);

console.log('artifact write adaptive concurrency controller test passed');
