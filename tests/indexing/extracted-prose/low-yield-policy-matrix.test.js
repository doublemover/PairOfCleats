#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  observeExtractedProseLowYieldSample,
  shouldSkipExtractedProseForLowYield
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';

const observeAll = ({ bailout, resultsByOrderIndex }) => {
  let decision = null;
  for (const orderIndex of [...bailout.sampledOrderIndices].sort((left, right) => left - right)) {
    decision = observeExtractedProseLowYieldSample({
      bailout,
      orderIndex,
      result: resultsByOrderIndex.get(orderIndex) || { chunks: [] }
    }) || decision;
  }
  return decision;
};

const cases = [
  {
    name: 'chunk-rich samples avoid a low-yield bailout',
    run() {
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
      const resultsByOrderIndex = new Map([[0, { chunks: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] }]]);
      const decision = observeAll({ bailout, resultsByOrderIndex });
      assert.ok(decision);
      assert.equal(decision.triggered, false);
      assert.equal(decision.sampledChunkCount, 4);
    }
  },
  {
    name: 'yielding doc-like families protect the cohort while low-yield generated cohorts are suppressed',
    run() {
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
      const resultsByOrderIndex = new Map([[3, { chunks: [{ id: 1 }] }]]);
      const decision = observeAll({ bailout, resultsByOrderIndex });
      assert.ok(decision);
      assert.equal(decision.familyProtected, true);
      assert.equal(decision.triggered, true);
      assert.equal(decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'), true);
      assert.equal(decision.protectedCohorts.some((cohort) => cohort.key === 'docs-markdown'), true);
      const protectedFamily = (decision.sampledFamilies || []).find((family) => family.key === '.md|docs');
      assert.ok(protectedFamily);
      assert.equal(protectedFamily.yieldedFiles, 1);
    }
  },
  {
    name: 'persisted productive family history prevents the bailout from firing',
    run() {
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
      const decision = observeAll({ bailout, resultsByOrderIndex: new Map() });
      assert.ok(decision);
      assert.equal(decision.familyProtected, false);
      assert.equal(decision.historyProtected, true);
      assert.equal(decision.triggered, false);
    }
  },
  {
    name: 'selective cohort suppression preserves high-value markdown and runtime code',
    run() {
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
      const resultsByOrderIndex = new Map();
      for (const entry of entries) {
        if (entry.rel.startsWith('docs/') || entry.rel.startsWith('tests/')) {
          resultsByOrderIndex.set(entry.orderIndex, { chunks: [{ id: `${entry.orderIndex}:chunk` }] });
        }
      }
      const decision = observeAll({ bailout, resultsByOrderIndex });
      assert.ok(decision);
      assert.equal(decision.triggered, true);
      assert.equal(decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'), true);
      assert.equal(decision.protectedCohorts.some((cohort) => cohort.key === 'docs-markdown'), true);

      const futureBaseOrderIndex = (bailout.decisionAtOrderIndex ?? 0) + 10;
      assert.equal(shouldSkipExtractedProseForLowYield({
        bailout,
        orderIndex: futureBaseOrderIndex,
        entry: { rel: 'generated/future-schema.js', ext: '.js', orderIndex: futureBaseOrderIndex }
      }), true);
      assert.equal(shouldSkipExtractedProseForLowYield({
        bailout,
        orderIndex: futureBaseOrderIndex + 1,
        entry: { rel: 'docs/future-guide.md', ext: '.md', orderIndex: futureBaseOrderIndex + 1 }
      }), false);
      assert.equal(shouldSkipExtractedProseForLowYield({
        bailout,
        orderIndex: futureBaseOrderIndex + 2,
        entry: { rel: 'src/future-runtime.js', ext: '.js', orderIndex: futureBaseOrderIndex + 2 }
      }), false);

      const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
      assert.equal(summary.suppressedCohortCount, 1);
      assert.equal(summary.protectedCohortCount >= 1, true);
      assert.equal(summary.repoFingerprint.cohortCounts['generated-machine'] >= 3, true);
      assert.equal(summary.estimatedSuppressedFiles, 1);
      assert.equal(summary.estimatedRecallLossClass, 'moderate');
      assert.equal(summary.estimatedRecallLossConfidence, 'high');
      assert.equal(summary.repoYieldClass, 'sparse-high-value');
      assert.equal(summary.opportunityCost?.class, 'limited');
      assert.equal(summary.recallCost?.class, 'moderate');
      assert.equal(summary.recallCost?.downgradedRecall, true);
      assert.equal(summary.suppressedCohorts[0]?.repoFiles, 5);
      assert.equal(summary.suppressedCohorts[0]?.estimatedSuppressedFiles, 1);
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('extracted prose low-yield policy matrix test passed');
