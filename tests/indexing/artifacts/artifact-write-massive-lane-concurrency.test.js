#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveArtifactLaneConcurrencyWithMassive } from '../../../src/index/build/artifacts-write.js';

applyTestEnv();

const massiveOnly = resolveArtifactLaneConcurrencyWithMassive({
  writeConcurrency: 4,
  ultraLightWrites: 0,
  massiveWrites: 10,
  lightWrites: 0,
  heavyWrites: 0,
  hostConcurrency: 16
});
assert.deepEqual(
  massiveOnly,
  { ultraLightConcurrency: 0, massiveConcurrency: 4, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected massive-only queues to use full writer concurrency'
);

const massiveAndHeavy = resolveArtifactLaneConcurrencyWithMassive({
  writeConcurrency: 8,
  ultraLightWrites: 0,
  massiveWrites: 10,
  lightWrites: 0,
  heavyWrites: 20,
  hostConcurrency: 16
});
assert.deepEqual(
  massiveAndHeavy,
  { ultraLightConcurrency: 0, massiveConcurrency: 2, lightConcurrency: 0, heavyConcurrency: 6 },
  'expected massive lane to reserve independent slots beside heavy writes'
);

const mixedAll = resolveArtifactLaneConcurrencyWithMassive({
  writeConcurrency: 10,
  ultraLightWrites: 2,
  massiveWrites: 6,
  lightWrites: 8,
  heavyWrites: 8,
  hostConcurrency: 16
});
assert.deepEqual(
  mixedAll,
  { ultraLightConcurrency: 2, massiveConcurrency: 2, lightConcurrency: 2, heavyConcurrency: 4 },
  'expected mixed queues to preserve ultra-light and massive reservations'
);

const singleSlot = resolveArtifactLaneConcurrencyWithMassive({
  writeConcurrency: 1,
  ultraLightWrites: 0,
  massiveWrites: 5,
  lightWrites: 2,
  heavyWrites: 2,
  hostConcurrency: 16
});
assert.deepEqual(
  singleSlot,
  { ultraLightConcurrency: 0, massiveConcurrency: 1, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected writeConcurrency=1 to prioritize massive queue when present'
);

console.log('artifact write massive lane concurrency test passed');
