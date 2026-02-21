#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createAdaptiveWriteConcurrencyController } from '../../../src/index/build/artifacts-write.js';

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
  controller.observe({ pendingWrites: 3, activeWrites: 4, longestStallSec: 14 }),
  3,
  'expected sustained stalls to scale concurrency down'
);

nowMs += 1;
assert.equal(
  controller.observe({ pendingWrites: 2, activeWrites: 3, longestStallSec: 20 }),
  2,
  'expected repeated sustained stalls to continue scaling down'
);

nowMs += 1;
assert.equal(
  controller.observe({ pendingWrites: 2, activeWrites: 2, longestStallSec: 20 }),
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

console.log('artifact write adaptive concurrency controller test passed');
