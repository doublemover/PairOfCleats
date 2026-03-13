#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildExtractedProseLowYieldBailoutState } from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  ...Array.from({ length: 24 }, (_, index) => ({
    rel: `src/low-yield-${index}.js`,
    ext: '.js',
    orderIndex: index
  })),
  ...Array.from({ length: 8 }, (_, index) => ({
    rel: `vendor/third-party-${index}.js`,
    ext: '.js',
    orderIndex: 24 + index
  })),
  {
    rel: 'docs/guide.md',
    ext: '.md',
    orderIndex: 32
  },
  {
    rel: 'docs/reference.txt',
    ext: '.txt',
    orderIndex: 33
  }
];

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 4,
          warmupWindowMultiplier: 16,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          minYieldedChunks: 4,
          seed: 'low-yield-family-stratification'
        }
      }
    }
  },
  entries
});

assert.ok(bailout, 'expected low-yield bailout state');
assert.equal(bailout.sampledOrderIndices.size, 4, 'expected full warmup sample size');

const sampledFamilies = Object.values(bailout.sampledFamilies || {});
const sampledFamilyKeys = sampledFamilies
  .filter((family) => Number(family?.sampledFiles) > 0)
  .map((family) => family.key)
  .sort();

assert.deepEqual(
  sampledFamilyKeys,
  ['.js|src', '.js|vendor', '.md|docs', '.txt|docs'],
  'expected family-stratified warmup sample coverage'
);

console.log('extracted prose low-yield family stratification test passed');
