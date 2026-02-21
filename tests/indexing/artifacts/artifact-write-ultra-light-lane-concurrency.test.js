#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveArtifactLaneConcurrencyWithUltraLight } from '../../../src/index/build/artifacts-write.js';

const ultraOnly = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 4,
  ultraLightWrites: 10,
  lightWrites: 0,
  heavyWrites: 0,
  hostConcurrency: 16
});
assert.deepEqual(
  ultraOnly,
  { ultraLightConcurrency: 4, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected ultra-light-only queue to use full writer concurrency'
);

const ultraAndHeavy = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 8,
  ultraLightWrites: 5,
  lightWrites: 0,
  heavyWrites: 30,
  hostConcurrency: 16
});
assert.deepEqual(
  ultraAndHeavy,
  { ultraLightConcurrency: 2, lightConcurrency: 0, heavyConcurrency: 6 },
  'expected ultra-light lane to reserve dedicated slots beside heavy writes'
);

const mixedQueues = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 6,
  ultraLightWrites: 3,
  lightWrites: 12,
  heavyWrites: 12,
  hostConcurrency: 16
});
assert.deepEqual(
  mixedQueues,
  { ultraLightConcurrency: 2, lightConcurrency: 2, heavyConcurrency: 2 },
  'expected mixed writes to keep ultra-light slots while balancing light/heavy lanes'
);

const singleSlot = resolveArtifactLaneConcurrencyWithUltraLight({
  writeConcurrency: 1,
  ultraLightWrites: 3,
  lightWrites: 0,
  heavyWrites: 6,
  hostConcurrency: 16
});
assert.deepEqual(
  singleSlot,
  { ultraLightConcurrency: 1, lightConcurrency: 0, heavyConcurrency: 0 },
  'expected writeConcurrency=1 to prioritize ultra-light queue over heavy backlog'
);

console.log('artifact write ultra-light lane concurrency test passed');
