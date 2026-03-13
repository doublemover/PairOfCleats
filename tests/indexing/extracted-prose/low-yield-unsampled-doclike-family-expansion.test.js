#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'src/a.js', ext: '.js', orderIndex: 0 },
  { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 1 },
  { rel: 'manual/guide.rst', ext: '.rst', orderIndex: 2 },
  { rel: 'src/b.js', ext: '.js', orderIndex: 3 }
];

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          disableWhenHistoryHasYield: false,
          warmupSampleSize: 1,
          warmupWindowMultiplier: 4,
          minYieldRatio: 0.75,
          minYieldedFiles: 1,
          minYieldedChunks: 1,
          seed: 'low-yield-unsampled-doclike-family-expansion'
        }
      }
    }
  },
  entries,
  history: null
});

const sampledOrderIndex = [...bailout.sampledOrderIndices][0];
const firstDecision = observeExtractedProseLowYieldSample({
  bailout,
  orderIndex: sampledOrderIndex,
  result: { chunks: [] }
});

assert.ok(firstDecision, 'expected a first low-yield decision');
assert.equal(firstDecision.triggered, false, 'expected unsampled doc-like family to defer immediate bailout');
assert.equal(firstDecision.warmupDeferred, true, 'expected warmup expansion deferral');
assert.ok(Array.isArray(firstDecision.warmupDeferredFamilies), 'expected warmup deferred family evidence');
assert.ok(firstDecision.warmupDeferredFamilies.length >= 1, 'expected at least one unsampled doc-like family to be added');

const expandedOrderIndices = [...bailout.sampledOrderIndices].filter((value) => value !== sampledOrderIndex);
assert.ok(expandedOrderIndices.length >= 1, 'expected warmup expansion to add additional sample order indices');

console.log('extracted prose low-yield unsampled doclike family expansion test passed');
