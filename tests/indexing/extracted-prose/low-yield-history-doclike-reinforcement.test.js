#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 0 },
  { rel: 'src/a.js', ext: '.js', orderIndex: 1 },
  { rel: 'src/b.js', ext: '.js', orderIndex: 2 },
  { rel: 'src/c.js', ext: '.js', orderIndex: 3 }
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
          seed: 'low-yield-history-doclike-reinforcement'
        }
      }
    }
  },
  entries,
  history: {
    builds: 6,
    observedFiles: 24,
    yieldedFiles: 6,
    chunkCount: 8,
    families: {
      '.md|docs': {
        observedFiles: 10,
        yieldedFiles: 4,
        chunkCount: 6
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
assert.equal(decision.familyProtected, false, 'expected current warmup to remain low-yield');
assert.equal(decision.historyProtected, true, 'expected doc-like family priors to block bailout');
assert.equal(decision.triggered, false, 'expected strong doc-like history to prevent bailout');

const docsEvidence = (decision.familyEvidence || []).find((family) => family.key === '.md|docs');
assert.ok(docsEvidence, 'expected merged family evidence for docs');
assert.equal(docsEvidence.protectedByHistory, true, 'expected docs family to remain protected by history');
assert.equal(docsEvidence.sampledYieldedFiles, 0, 'expected sampled docs family to remain zero-yield');

console.log('extracted prose low-yield history doclike reinforcement test passed');
