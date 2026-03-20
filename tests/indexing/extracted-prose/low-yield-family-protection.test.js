#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'src/low-yield-a.js', ext: '.js', orderIndex: 0 },
  { rel: 'src/low-yield-b.js', ext: '.js', orderIndex: 1 },
  { rel: 'vendor/low-yield-c.js', ext: '.js', orderIndex: 2 },
  { rel: 'docs/guide.md', ext: '.md', orderIndex: 3 }
];

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
          seed: 'low-yield-family-protection'
        }
      }
    }
  },
  entries
});

let decision = null;
for (const entry of entries) {
  decision = observeExtractedProseLowYieldSample({
    bailout,
    orderIndex: entry.orderIndex,
    result: {
      chunks: entry.ext === '.md' ? [{ id: 1 }] : []
    }
  }) || decision;
}

assert.ok(decision, 'expected low-yield bailout decision after warmup');
assert.equal(decision.familyProtected, true, 'expected a yielding document family to protect warmup');
assert.equal(
  decision.triggered,
  true,
  'expected cohort-aware suppression to still quarantine low-yield machine-heavy files'
);
assert.equal(
  decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'),
  true,
  'expected generated-machine cohort suppression'
);
assert.equal(
  decision.protectedCohorts.some((cohort) => cohort.key === 'docs-markdown'),
  true,
  'expected docs cohort protection'
);

const protectedFamily = (decision.sampledFamilies || []).find((family) => family.key === '.md|docs');
assert.ok(protectedFamily, 'expected sampled family summary for docs');
assert.equal(protectedFamily.yieldedFiles, 1, 'expected doc-like family yield accounting');

console.log('extracted prose low-yield family protection test passed');
