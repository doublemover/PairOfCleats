#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  observeExtractedProseLowYieldSample,
  shouldSkipExtractedProseForLowYield
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const entries = [
  { rel: 'generated/schema-a.js', ext: '.js', orderIndex: 0 },
  { rel: 'generated/schema-b.js', ext: '.js', orderIndex: 1 },
  { rel: 'src/runtime.js', ext: '.js', orderIndex: 2 },
  { rel: 'docs/readme.md', ext: '.md', orderIndex: 3 },
  { rel: 'tests/example.md', ext: '.md', orderIndex: 4 },
  { rel: 'generated/schema-c.js', ext: '.js', orderIndex: 5 },
  { rel: 'docs/guide.md', ext: '.md', orderIndex: 6 },
  { rel: 'src/late.js', ext: '.js', orderIndex: 7 },
  { rel: 'generated/schema-d.js', ext: '.js', orderIndex: 8 },
  { rel: 'docs/appendix.md', ext: '.md', orderIndex: 9 },
  { rel: 'src/final.js', ext: '.js', orderIndex: 10 },
  { rel: 'generated/schema-e.js', ext: '.js', orderIndex: 11 }
];

const bailout = buildExtractedProseLowYieldBailoutState({
  mode: 'extracted-prose',
  runtime: {
    indexingConfig: {
      extractedProse: {
        lowYieldBailout: {
          enabled: true,
          warmupSampleSize: 5,
          warmupWindowMultiplier: 2,
          minYieldRatio: 0.75,
          minYieldedFiles: 4,
          minYieldedChunks: 5,
          seed: 'low-yield-cohort-selective-suppression'
        }
      }
    }
  },
  entries
});

let decision = null;
for (const orderIndex of [...bailout.sampledOrderIndices].sort((left, right) => left - right)) {
  const entry = entries.find((candidate) => candidate.orderIndex === orderIndex);
  decision = observeExtractedProseLowYieldSample({
    bailout,
    orderIndex,
    result: {
      chunks: entry?.rel?.startsWith('docs/') || entry?.rel?.startsWith('tests/')
        ? [{ id: `${orderIndex}:chunk` }]
        : []
    }
  }) || decision;
}

assert.ok(decision, 'expected low-yield decision after warmup');
assert.equal(decision.triggered, true, 'expected selective low-yield suppression to trigger');
assert.equal(
  decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'),
  true,
  'expected generated-machine cohort suppression'
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
const futureBaseOrderIndex = (bailout.decisionAtOrderIndex ?? 0) + 10;
const skippedGeneratedEntry = {
  rel: 'generated/future-schema.js',
  ext: '.js',
  orderIndex: futureBaseOrderIndex
};
const retainedDocsEntry = {
  rel: 'docs/future-guide.md',
  ext: '.md',
  orderIndex: futureBaseOrderIndex + 1
};
const retainedCodeEntry = {
  rel: 'src/future-runtime.js',
  ext: '.js',
  orderIndex: futureBaseOrderIndex + 2
};

assert.equal(
  shouldSkipExtractedProseForLowYield({
    bailout,
    orderIndex: skippedGeneratedEntry.orderIndex,
    entry: skippedGeneratedEntry
  }),
  true,
  'expected later generated entry to be skipped'
);
assert.equal(
  shouldSkipExtractedProseForLowYield({
    bailout,
    orderIndex: retainedDocsEntry.orderIndex,
    entry: retainedDocsEntry
  }),
  false,
  'expected later docs entry to remain eligible'
);
assert.equal(
  shouldSkipExtractedProseForLowYield({
    bailout,
    orderIndex: retainedCodeEntry.orderIndex,
    entry: retainedCodeEntry
  }),
  false,
  'expected code-comment-heavy cohort to remain unsuppressed without stable low-yield history'
);

const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
assert.equal(summary.suppressedCohortCount, 1, 'expected one suppressed cohort');
assert.equal(summary.protectedCohortCount >= 1, true, 'expected protected cohort accounting');
assert.equal(summary.repoFingerprint.cohortCounts['generated-machine'] >= 3, true, 'expected fingerprint cohort counts');
assert.equal(summary.estimatedSuppressedFiles, 1, 'expected one future generated file to be estimated as suppressed');
assert.equal(summary.estimatedRecallLossClass, 'moderate', 'expected moderate recall-loss estimate for selective suppression');
assert.equal(summary.estimatedRecallLossConfidence, 'high', 'expected high confidence for genuine low-yield suppression');
assert.equal(summary.suppressedCohorts[0]?.repoFiles, 5, 'expected repo-level cohort size in summary');
assert.equal(summary.suppressedCohorts[0]?.estimatedSuppressedFiles, 1, 'expected per-cohort suppressed-file estimate');

console.log('extracted prose low-yield selective cohort suppression test passed');
