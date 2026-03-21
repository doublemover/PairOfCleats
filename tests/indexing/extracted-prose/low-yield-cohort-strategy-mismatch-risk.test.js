#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'docs/readme.md', ext: '.md', orderIndex: 0 },
  { rel: 'docs/guide.md', ext: '.md', orderIndex: 1 },
  { rel: 'docs/reference.txt', ext: '.txt', orderIndex: 2 },
  { rel: 'generated/schema.js', ext: '.js', orderIndex: 3 }
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
          seed: 'low-yield-cohort-strategy-mismatch-risk'
        }
      }
    }
  },
  entries,
  history: {
    builds: 3,
    observedFiles: 18,
    yieldedFiles: 0,
    chunkCount: 0,
    cohorts: {
      'generated-machine': {
        observedFiles: 18,
        yieldedFiles: 0,
        chunkCount: 0
      }
    },
    fingerprint: {
      totalEntries: 18,
      docLikeEntries: 0,
      dominantCohort: 'generated-machine',
      cohortCounts: {
        'generated-machine': 18,
        'docs-markdown': 0,
        'tests-examples': 0,
        'templates-config': 0,
        'code-comment-heavy': 0
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
assert.equal(
  decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'),
  true,
  'expected generated-machine suppression under stable low-yield history'
);
const docsProtection = decision.protectedCohorts.find((cohort) => cohort.key === 'docs-markdown');
assert.ok(docsProtection, 'expected docs cohort protection');
assert.equal(docsProtection.strategyMismatchRisk, true, 'expected repo fingerprint shift to protect docs cohort');
const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
assert.equal(summary.strategyMismatchRiskCount >= 1, true, 'expected mismatch risk accounting in summary');
assert.equal(summary.estimatedRecallLossConfidence, 'low', 'expected low confidence when strategy mismatch risk remains');

console.log('extracted prose low-yield strategy mismatch risk test passed');
