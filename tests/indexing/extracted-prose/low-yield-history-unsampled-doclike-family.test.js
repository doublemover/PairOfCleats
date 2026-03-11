#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 0 },
  { rel: 'manual/guide.rst', ext: '.rst', orderIndex: 1 },
  { rel: 'src/a.js', ext: '.js', orderIndex: 2 },
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
          seed: 'low-yield-history-unsampled-doclike-family'
        }
      }
    }
  },
  entries,
  history: {
    builds: 4,
    observedFiles: 12,
    yieldedFiles: 3,
    chunkCount: 5,
    families: {
      '.rst|manual': {
        observedFiles: 6,
        yieldedFiles: 2,
        chunkCount: 3
      }
    }
  }
});

const sampledOrderIndex = [...bailout.sampledOrderIndices][0];
const decision = observeExtractedProseLowYieldSample({
  bailout,
  orderIndex: sampledOrderIndex,
  result: { chunks: [] }
});

assert.ok(decision, 'expected low-yield decision after one-file warmup');
assert.equal(decision.triggered, false, 'expected unsampled productive doc-like history to defer bailout');
assert.equal(decision.historyDeferred, true, 'expected history deferral flag');
assert.equal(decision.warmupDeferred, false, 'expected no warmup deferral when history already deferred');

const manualEvidence = (decision.familyEvidence || []).find((family) => family.key === '.rst|manual');
assert.ok(manualEvidence, 'expected manual doc-like family evidence');
assert.equal(manualEvidence.warmupFiles, 1, 'expected warmup family accounting');
assert.equal(manualEvidence.sampledFiles, 0, 'expected unsampled doc-like family');
assert.equal(manualEvidence.deferDecisionByHistory, true, 'expected unsampled doc-like family to defer bailout');

console.log('extracted prose low-yield unsampled doclike family test passed');
