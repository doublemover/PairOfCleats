#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  countPendingLaneWrites,
  hasPendingLaneWrites,
  pickDispatchLane,
  resolveDispatchLaneBudgets,
  takeLaneDispatchEntries
} from '../../../src/index/build/artifacts/write-dispatch-lanes.js';

const baselineQueues = {
  ultraLight: [{ label: 'u1' }, { label: 'u2' }],
  massive: [{ label: 'm1' }, { label: 'm2' }],
  light: [{ label: 'l1' }, { label: 'l2' }, { label: 'l3' }, { label: 'l4' }],
  heavy: [{ label: 'h1' }]
};
const baselineActive = {
  ultraLight: 1,
  massive: 1,
  light: 2,
  heavy: 1
};

assert.equal(countPendingLaneWrites(baselineQueues), 9, 'expected pending lane counter to sum all queue lengths');
assert.equal(hasPendingLaneWrites(baselineQueues), true, 'expected pending lane detector to report queued work');
assert.equal(
  hasPendingLaneWrites({ ultraLight: [], massive: [], light: [], heavy: [] }),
  false,
  'expected pending lane detector to report empty queues'
);

const budgets = resolveDispatchLaneBudgets({
  laneQueues: baselineQueues,
  laneActive: baselineActive,
  writeConcurrency: 8,
  smallConcurrencyOverride: 4,
  mediumConcurrencyOverride: 2,
  largeConcurrencyOverride: 2,
  hostConcurrency: 16
});
assert.deepEqual(
  budgets,
  {
    ultraLightConcurrency: 2,
    massiveConcurrency: 2,
    lightConcurrency: 2,
    heavyConcurrency: 2
  },
  'expected work-class split to reserve ultra-light slots and keep class caps'
);

assert.equal(
  pickDispatchLane({ laneQueues: baselineQueues, laneActive: baselineActive, budgets }),
  'ultraLight',
  'expected ultra-light lane to dispatch first when budget allows'
);

const noUltraBudget = { ...baselineActive, ultraLight: budgets.ultraLightConcurrency };
assert.equal(
  pickDispatchLane({ laneQueues: baselineQueues, laneActive: noUltraBudget, budgets }),
  'massive',
  'expected massive lane to dispatch after ultra-light saturation'
);

const noHeavyOrMassiveBudget = {
  ...noUltraBudget,
  massive: budgets.massiveConcurrency,
  heavy: budgets.heavyConcurrency,
  light: budgets.lightConcurrency - 1
};
assert.equal(
  pickDispatchLane({ laneQueues: baselineQueues, laneActive: noHeavyOrMassiveBudget, budgets }),
  'light',
  'expected light lane to dispatch when heavier lanes are saturated'
);

const microQueues = {
  ultraLight: [
    { estimatedBytes: 8 * 1024, prefetched: null, job: async () => {}, label: 'meta-a' },
    { estimatedBytes: 10 * 1024, prefetched: null, job: async () => {}, label: 'meta-b' },
    { estimatedBytes: 96 * 1024, prefetched: null, job: async () => {}, label: 'meta-c' }
  ],
  massive: [],
  light: [],
  heavy: [
    { estimatedBytes: 2 * 1024 * 1024, job: async () => {}, label: 'heavy-a' },
    { estimatedBytes: 3 * 1024 * 1024, job: async () => {}, label: 'heavy-b' }
  ]
};

const microBatch = takeLaneDispatchEntries({
  laneQueues: microQueues,
  laneName: 'ultraLight',
  writeFsStrategy: {
    microCoalescing: true,
    microBatchMaxCount: 4,
    microBatchMaxBytes: 40 * 1024
  },
  ultraLightWriteThresholdBytes: 32 * 1024
});
assert.equal(microBatch.length, 2, 'expected ultra-light dequeue to coalesce micro batch entries');
assert.equal(microQueues.ultraLight.length, 1, 'expected ultra-light queue to retain non-coalesced tail entry');

const heavySingle = takeLaneDispatchEntries({
  laneQueues: microQueues,
  laneName: 'heavy',
  writeFsStrategy: {
    microCoalescing: true,
    microBatchMaxCount: 4,
    microBatchMaxBytes: 40 * 1024
  },
  ultraLightWriteThresholdBytes: 32 * 1024
});
assert.equal(heavySingle.length, 1, 'expected non-ultra-light lanes to dequeue exactly one entry');
assert.equal(microQueues.heavy.length, 1, 'expected heavy lane dequeue to shift one entry');

console.log('artifact write dispatch lane helpers test passed');
