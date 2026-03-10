#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          disableWhenHistoryHasYield: false,
          warmupSampleSize: 2,
          warmupWindowMultiplier: 1,
          minYieldRatio: 0.75,
          minYieldedFiles: 1,
          minYieldedChunks: 1,
          seed: 'low-yield-summary-family-evidence'
        }
      }
    }
  },
  entries: [
    { rel: 'docs/a.md', ext: '.md', orderIndex: 0 },
    { rel: 'src/app.js', ext: '.js', orderIndex: 1 }
  ],
  history: {
    builds: 2,
    observedFiles: 4,
    yieldedFiles: 1,
    chunkCount: 2,
    families: {
      '.md|docs': {
        observedFiles: 4,
        yieldedFiles: 1,
        chunkCount: 2
      }
    }
  }
});

observeExtractedProseLowYieldSample({
  bailout,
  orderIndex: 0,
  result: { chunks: [{ id: 1 }] }
});
observeExtractedProseLowYieldSample({
  bailout,
  orderIndex: 1,
  result: { chunks: [] }
});

const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
assert.ok(Array.isArray(summary.sampledFamilies), 'expected sampled family evidence in summary');
assert.ok(Array.isArray(summary.historyFamilies), 'expected history family evidence in summary');
assert.equal(summary.sampledFamilies.some((family) => family.key === '.md|docs'), true);
assert.equal(summary.historyFamilies.some((family) => family.key === '.md|docs'), true);

console.log('extracted prose low-yield summary family evidence test passed');
