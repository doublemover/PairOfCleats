#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = Array.from({ length: 4 }, (_, index) => ({
  rel: `src/mixed-${index}.js`,
  ext: '.js',
  orderIndex: index
}));

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 4,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          minYieldedChunks: 4,
          seed: 'low-yield-min-chunks'
        }
      }
    }
  },
  entries
});

let decision = null;
for (const entry of entries) {
  const result = entry.orderIndex === 0
    ? { chunks: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }
    : { chunks: [] };
  decision = observeExtractedProseLowYieldSample({
    bailout,
    orderIndex: entry.orderIndex,
    result
  }) || decision;
}

assert.ok(decision, 'expected low-yield bailout decision after warmup');
assert.equal(decision.triggered, false, 'expected chunk-rich warmup sample to avoid low-yield bailout');
assert.equal(decision.sampledChunkCount, 4, 'expected sampled chunk count accounting');

console.log('extracted prose low-yield min chunks test passed');
