#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildExtractedProseLowYieldBailoutState } from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [];
for (let i = 0; i < 31; i += 1) {
  entries.push({
    rel: `src/low-yield-${i}.js`,
    ext: '.js',
    orderIndex: i
  });
}
entries.push({
  rel: 'docs/readme.md',
  ext: '.md',
  orderIndex: 31
});

const state = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 8,
          warmupWindowMultiplier: 4,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          minYieldedChunks: 4,
          seed: 'low-yield-doc-sample-bias'
        }
      }
    }
  },
  entries
});

const sampledEntries = entries.filter((entry) => state.sampledOrderIndices.has(entry.orderIndex));
assert.ok(sampledEntries.some((entry) => entry.rel === 'docs/readme.md'), 'expected deterministic warmup sample to retain doc-like entry');

console.log('extracted prose low-yield doc sample bias test passed');
