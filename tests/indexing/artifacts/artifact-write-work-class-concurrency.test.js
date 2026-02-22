#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveArtifactWorkClassConcurrency } from '../../../src/index/build/artifacts-write.js';

const overridden = resolveArtifactWorkClassConcurrency({
  writeConcurrency: 9,
  smallWrites: 20,
  mediumWrites: 20,
  largeWrites: 20,
  smallConcurrencyOverride: 2,
  mediumConcurrencyOverride: 3,
  largeConcurrencyOverride: 4
});
assert.deepEqual(
  overridden,
  { smallConcurrency: 2, mediumConcurrency: 3, largeConcurrency: 4 },
  'expected explicit work-class overrides to be honored when they fit the global cap'
);

const overflowPrioritizesLarge = resolveArtifactWorkClassConcurrency({
  writeConcurrency: 6,
  smallWrites: 2,
  mediumWrites: 10,
  largeWrites: 10,
  smallConcurrencyOverride: 4,
  mediumConcurrencyOverride: 4,
  largeConcurrencyOverride: 4
});
assert.deepEqual(
  overflowPrioritizesLarge,
  { smallConcurrency: 0, mediumConcurrency: 2, largeConcurrency: 4 },
  'expected overflow trimming to preserve large-class throughput first'
);

const defaultBudgets = resolveArtifactWorkClassConcurrency({
  writeConcurrency: 8,
  smallWrites: 12,
  mediumWrites: 12,
  largeWrites: 20
});
assert.equal(
  defaultBudgets.smallConcurrency + defaultBudgets.mediumConcurrency + defaultBudgets.largeConcurrency,
  8,
  'expected class budgets to match total writer concurrency'
);
assert.ok(
  defaultBudgets.largeConcurrency > 0,
  'expected large class to receive non-zero budget under mixed backlog'
);

const smallOnly = resolveArtifactWorkClassConcurrency({
  writeConcurrency: 5,
  smallWrites: 3,
  mediumWrites: 0,
  largeWrites: 0
});
assert.deepEqual(
  smallOnly,
  { smallConcurrency: 3, mediumConcurrency: 0, largeConcurrency: 0 },
  'expected single-class queues to cap at available work items'
);

console.log('artifact write work-class concurrency test passed');
