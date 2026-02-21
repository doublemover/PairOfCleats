#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveArtifactWriteConcurrency } from '../../../src/index/build/artifacts.js';

const lowVolume = resolveArtifactWriteConcurrency({
  artifactConfig: {},
  totalWrites: 20,
  availableParallelism: 32
});
assert.deepEqual(lowVolume, { cap: 16, override: false }, 'expected low-volume default write cap to stay at 16');

const highVolume = resolveArtifactWriteConcurrency({
  artifactConfig: {},
  totalWrites: 200,
  availableParallelism: 32
});
assert.deepEqual(highVolume, { cap: 32, override: false }, 'expected available CPU to cap high-volume write concurrency');

const highVolumeWideHost = resolveArtifactWriteConcurrency({
  artifactConfig: {},
  totalWrites: 200,
  availableParallelism: 96
});
assert.deepEqual(
  highVolumeWideHost,
  { cap: 48, override: false },
  'expected high-volume default write cap to scale up to 48 on wide hosts'
);

const cpuBound = resolveArtifactWriteConcurrency({
  artifactConfig: {},
  totalWrites: 200,
  availableParallelism: 6
});
assert.deepEqual(cpuBound, { cap: 6, override: false }, 'expected available CPU to cap write concurrency');

const explicitOverride = resolveArtifactWriteConcurrency({
  artifactConfig: { writeConcurrency: 8 },
  totalWrites: 200,
  availableParallelism: 32
});
assert.deepEqual(explicitOverride, { cap: 8, override: true }, 'expected explicit config override to win');

const none = resolveArtifactWriteConcurrency({
  artifactConfig: {},
  totalWrites: 0,
  availableParallelism: 32
});
assert.deepEqual(none, { cap: 0, override: false }, 'expected zero writes to disable writer concurrency');

assert.throws(
  () => resolveArtifactWriteConcurrency({
    artifactConfig: { writeConcurrency: 100 },
    totalWrites: 12,
    availableParallelism: 32
  }),
  /writeConcurrency/,
  'expected invalid writeConcurrency override to throw'
);

console.log('artifact write concurrency defaults test passed');
