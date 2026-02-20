#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveArtifactLaneConcurrency } from '../../../src/index/build/artifacts.js';

const allLight = resolveArtifactLaneConcurrency({
  writeConcurrency: 2,
  lightWrites: 10,
  heavyWrites: 0,
  hostConcurrency: 16
});
assert.deepEqual(
  allLight,
  { heavyConcurrency: 0, lightConcurrency: 2 },
  'expected all-light writes to keep full write concurrency'
);

const allLightBoundedByWrites = resolveArtifactLaneConcurrency({
  writeConcurrency: 16,
  lightWrites: 3,
  heavyWrites: 0,
  hostConcurrency: 16
});
assert.deepEqual(
  allLightBoundedByWrites,
  { heavyConcurrency: 0, lightConcurrency: 3 },
  'expected light lane to cap at number of light writes'
);

const mixedLanes = resolveArtifactLaneConcurrency({
  writeConcurrency: 8,
  lightWrites: 10,
  heavyWrites: 2,
  hostConcurrency: 16
});
assert.deepEqual(
  mixedLanes,
  { heavyConcurrency: 2, lightConcurrency: 6 },
  'expected mixed writes to split concurrency between heavy and light lanes'
);

const heavyOnly = resolveArtifactLaneConcurrency({
  writeConcurrency: 8,
  lightWrites: 0,
  heavyWrites: 12,
  hostConcurrency: 16
});
assert.deepEqual(
  heavyOnly,
  { heavyConcurrency: 6, lightConcurrency: 0 },
  'expected heavy-only writes to preserve heavy lane policy'
);

const heavyOverride = resolveArtifactLaneConcurrency({
  writeConcurrency: 8,
  lightWrites: 7,
  heavyWrites: 7,
  heavyWriteConcurrencyOverride: 1,
  hostConcurrency: 16
});
assert.deepEqual(
  heavyOverride,
  { heavyConcurrency: 1, lightConcurrency: 7 },
  'expected explicit heavy-lane override to be honored'
);

const strictCapMixedSingleSlot = resolveArtifactLaneConcurrency({
  writeConcurrency: 1,
  lightWrites: 1,
  heavyWrites: 1,
  heavyWriteConcurrencyOverride: 8,
  hostConcurrency: 16
});
assert.deepEqual(
  strictCapMixedSingleSlot,
  { heavyConcurrency: 1, lightConcurrency: 0 },
  'expected mixed lanes with writeConcurrency=1 to keep strict global cap'
);

console.log('artifact write lane concurrency test passed');
