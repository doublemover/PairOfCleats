#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'src/a.js', ext: '.js', orderIndex: 0 },
  { rel: 'src/b.js', ext: '.js', orderIndex: 1 },
  { rel: 'src/c.js', ext: '.js', orderIndex: 2 },
  { rel: 'src/d.js', ext: '.js', orderIndex: 3 }
];

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          disableWhenHistoryHasYield: false,
          warmupSampleSize: 4,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.75,
          minYieldedFiles: 2,
          minYieldedChunks: 2,
          seed: 'low-yield-history-family-priors'
        }
      }
    }
  },
  entries,
  history: {
    builds: 5,
    observedFiles: 12,
    yieldedFiles: 3,
    chunkCount: 4,
    families: {
      '.md|docs': {
        observedFiles: 5,
        yieldedFiles: 3,
        chunkCount: 4
      }
    }
  }
});

let decision = null;
for (const entry of entries) {
  decision = observeExtractedProseLowYieldSample({
    bailout,
    orderIndex: entry.orderIndex,
    result: { chunks: [] }
  }) || decision;
}

assert.ok(decision, 'expected low-yield decision after warmup');
assert.equal(decision.familyProtected, false, 'expected sampled families to remain low-yield');
assert.equal(decision.historyProtected, true, 'expected productive history families to block bailout');
assert.equal(decision.triggered, false, 'expected persisted family priors to prevent bailout');

console.log('extracted prose low-yield history family priors test passed');
