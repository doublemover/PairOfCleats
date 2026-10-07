#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildExtractedProseLowYieldBailoutState,
  buildExtractedProseLowYieldBailoutSummary,
  buildExtractedProseLowYieldCohort,
  buildExtractedProseLowYieldHistory,
  observeExtractedProseLowYieldSample
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose.js';
import {
  buildExtractedProseRepoFingerprint,
  compareRepoFingerprintShape
} from '../../../src/index/build/indexer/steps/process-files/extracted-prose/fingerprint.js';

assert.equal(buildExtractedProseLowYieldCohort({ relPath: 'docs/readme.md', ext: '.md', pathFamily: 'docs' }).key, 'docs-markdown');
assert.equal(buildExtractedProseLowYieldCohort({ relPath: 'tests/example.py', ext: '.py', pathFamily: 'tests' }).key, 'tests-examples');
assert.equal(buildExtractedProseLowYieldCohort({ relPath: 'generated/schema.min.js', ext: '.js', pathFamily: 'src' }).key, 'generated-machine');
assert.equal(buildExtractedProseLowYieldCohort({ relPath: '.github/workflows/ci.yml', ext: '.yml', pathFamily: '.github' }).key, 'templates-config');

{
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
  assert.ok(decision);
  assert.equal(decision.suppressedCohorts.some((cohort) => cohort.key === 'generated-machine'), true);
  const docsProtection = decision.protectedCohorts.find((cohort) => cohort.key === 'docs-markdown');
  assert.ok(docsProtection);
  assert.equal(docsProtection.strategyMismatchRisk, true);
  const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
  assert.equal(summary.strategyMismatchRiskCount >= 1, true);
  assert.equal(summary.estimatedRecallLossConfidence, 'low');
}

{
  const entries = [];
  for (let i = 0; i < 31; i += 1) {
    entries.push({ rel: `src/low-yield-${i}.js`, ext: '.js', orderIndex: i });
  }
  entries.push({ rel: 'docs/readme.md', ext: '.md', orderIndex: 31 });
  const state = buildExtractedProseLowYieldBailoutState({
    mode: 'extracted-prose',
    runtime: {
      indexingConfig: {
        extractedProse: {
          lowYieldBailout: {
            enabled: true,
            warmupSampleSize: 8,
            warmupWindowMultiplier: 4,
            minYieldRatio: 0.75,
            minYieldedFiles: 2,
            minYieldedChunks: 4,
            seed: 'low-yield-doc-sample-bias'
          }
        }
      }
    },
    entries
  });
  const sampledEntries = entries.filter((entry) => state.sampledOrderIndices.has(entry.orderIndex));
  assert.ok(sampledEntries.some((entry) => entry.rel === 'docs/readme.md'));
}

{
  const entries = [
    ...Array.from({ length: 24 }, (_, index) => ({ rel: `src/low-yield-${index}.js`, ext: '.js', orderIndex: index })),
    ...Array.from({ length: 8 }, (_, index) => ({ rel: `vendor/third-party-${index}.js`, ext: '.js', orderIndex: 24 + index })),
    { rel: 'docs/guide.md', ext: '.md', orderIndex: 32 },
    { rel: 'docs/reference.txt', ext: '.txt', orderIndex: 33 }
  ];
  const bailout = buildExtractedProseLowYieldBailoutState({
    mode: 'extracted-prose',
    runtime: {
      indexingConfig: {
        extractedProse: {
          lowYieldBailout: {
            enabled: true,
            warmupSampleSize: 4,
            warmupWindowMultiplier: 16,
            minYieldRatio: 0.75,
            minYieldedFiles: 2,
            minYieldedChunks: 4,
            seed: 'low-yield-family-stratification'
          }
        }
      }
    },
    entries
  });
  assert.ok(bailout);
  assert.equal(bailout.sampledOrderIndices.size, 4);
  const sampledFamilyKeys = Object.values(bailout.sampledFamilies || {})
    .filter((family) => Number(family?.sampledFiles) > 0)
    .map((family) => family.key)
    .sort();
  assert.deepEqual(sampledFamilyKeys, ['.js|src', '.js|vendor', '.md|docs', '.txt|docs']);
}

{
  const fingerprint = buildExtractedProseRepoFingerprint([
    { rel: 'docs/a.md', ext: '.md' },
    { rel: 'docs/b.md', ext: '.md' },
    { rel: 'generated/schema.js', ext: '.js' }
  ]);
  assert.equal(fingerprint.cohortCounts['docs-markdown'], 2);
  assert.equal(fingerprint.cohortCounts['generated-machine'], 1);
  const history = buildExtractedProseLowYieldHistory({
    builds: 3,
    observedFiles: 6,
    yieldedFiles: 2,
    chunkCount: 3,
    families: {
      '.md|docs': { observedFiles: 4, yieldedFiles: 2, chunkCount: 3 },
      '.js|generated': { observedFiles: 2, yieldedFiles: 0, chunkCount: 0 }
    },
    fingerprint
  });
  assert.equal(history.cohorts['docs-markdown'].yieldedFiles, 2);
  assert.equal(history.cohorts['generated-machine'].observedFiles, 2);
  assert.equal(compareRepoFingerprintShape({
    current: fingerprint,
    previous: {
      totalEntries: 3,
      docLikeEntries: 0,
      dominantCohort: 'generated-machine',
      cohortCounts: {
        'docs-markdown': 0,
        'tests-examples': 0,
        'templates-config': 0,
        'generated-machine': 3,
        'code-comment-heavy': 0
      }
    },
    cohortKey: 'docs-markdown'
  }), true);
}

for (const scenario of [
  {
    name: 'history-doclike-reinforcement',
    entries: [
      { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 0 },
      { rel: 'src/a.js', ext: '.js', orderIndex: 1 },
      { rel: 'src/b.js', ext: '.js', orderIndex: 2 },
      { rel: 'src/c.js', ext: '.js', orderIndex: 3 }
    ],
    history: {
      builds: 6,
      observedFiles: 24,
      yieldedFiles: 6,
      chunkCount: 8,
      families: {
        '.md|docs': { observedFiles: 10, yieldedFiles: 4, chunkCount: 6 }
      }
    },
    config: {
      enabled: true,
      disableWhenHistoryHasYield: false,
      warmupSampleSize: 4,
      warmupWindowMultiplier: 1,
      minYieldRatio: 0.75,
      minYieldedFiles: 2,
      minYieldedChunks: 2,
      seed: 'low-yield-history-doclike-reinforcement'
    },
    assertDecision(decision) {
      assert.equal(decision.familyProtected, false);
      assert.equal(decision.historyProtected, true);
      assert.equal(decision.triggered, false);
      const docsEvidence = (decision.familyEvidence || []).find((family) => family.key === '.md|docs');
      assert.ok(docsEvidence);
      assert.equal(docsEvidence.protectedByHistory, true);
      assert.equal(docsEvidence.sampledYieldedFiles, 0);
    }
  },
  {
    name: 'history-unsampled-doclike-family',
    entries: [
      { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 0 },
      { rel: 'manual/guide.rst', ext: '.rst', orderIndex: 1 },
      { rel: 'src/a.js', ext: '.js', orderIndex: 2 },
      { rel: 'src/b.js', ext: '.js', orderIndex: 3 }
    ],
    history: {
      builds: 4,
      observedFiles: 12,
      yieldedFiles: 3,
      chunkCount: 5,
      families: {
        '.rst|manual': { observedFiles: 6, yieldedFiles: 2, chunkCount: 3 }
      }
    },
    config: {
      enabled: true,
      disableWhenHistoryHasYield: false,
      warmupSampleSize: 1,
      warmupWindowMultiplier: 4,
      minYieldRatio: 0.75,
      minYieldedFiles: 1,
      minYieldedChunks: 1,
      seed: 'low-yield-history-unsampled-doclike-family'
    },
    assertDecision(decision) {
      assert.equal(decision.triggered, false);
      assert.equal(decision.historyDeferred, true);
      assert.equal(decision.warmupDeferred, false);
      const manualEvidence = (decision.familyEvidence || []).find((family) => family.key === '.rst|manual');
      assert.ok(manualEvidence);
      assert.equal(manualEvidence.sampledFiles, 0);
      assert.equal(manualEvidence.deferDecisionByHistory, true);
    }
  },
  {
    name: 'unsampled-doclike-family-expansion',
    entries: [
      { rel: 'src/a.js', ext: '.js', orderIndex: 0 },
      { rel: 'docs/guide-a.md', ext: '.md', orderIndex: 1 },
      { rel: 'manual/guide.rst', ext: '.rst', orderIndex: 2 },
      { rel: 'src/b.js', ext: '.js', orderIndex: 3 }
    ],
    history: null,
    config: {
      enabled: true,
      disableWhenHistoryHasYield: false,
      warmupSampleSize: 1,
      warmupWindowMultiplier: 4,
      minYieldRatio: 0.75,
      minYieldedFiles: 1,
      minYieldedChunks: 1,
      seed: 'low-yield-unsampled-doclike-family-expansion'
    },
    assertDecision(decision, bailout, sampledOrderIndex, firstDecision) {
      assert.equal(firstDecision?.triggered, false);
      assert.equal(firstDecision?.warmupDeferred, true);
      assert.ok(Array.isArray(firstDecision?.warmupDeferredFamilies));
      assert.ok(firstDecision.warmupDeferredFamilies.length >= 1);
      const expandedOrderIndices = [...bailout.sampledOrderIndices].filter((value) => value !== sampledOrderIndex);
      assert.ok(expandedOrderIndices.length >= 1);
    }
  }
]) {
  const bailout = buildExtractedProseLowYieldBailoutState({
    mode: 'extracted-prose',
    runtime: {
      indexingConfig: {
        extractedProse: {
          lowYieldBailout: scenario.config
        }
      }
    },
    entries: scenario.entries,
    history: scenario.history
  });
  let decision = null;
  let firstDecision = null;
  const sampledOrderIndex = [...bailout.sampledOrderIndices][0];
  for (const entry of scenario.entries) {
    if (!bailout.sampledOrderIndices.has(entry.orderIndex)) continue;
    const candidate = observeExtractedProseLowYieldSample({
      bailout,
      orderIndex: entry.orderIndex,
      result: { chunks: [] }
    });
    if (candidate && firstDecision === null) firstDecision = candidate;
    decision = candidate || decision;
  }
  assert.ok(decision, `expected decision for ${scenario.name}`);
  scenario.assertDecision(decision, bailout, sampledOrderIndex, firstDecision);
}

{
  const root = process.cwd();
  const barrelPath = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'extracted-prose.js');
  const moduleDir = path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files', 'extracted-prose');
  for (const target of [
    barrelPath,
    moduleDir,
    path.join(moduleDir, 'index.js'),
    path.join(moduleDir, 'cohorts.js'),
    path.join(moduleDir, 'fingerprint.js'),
    path.join(moduleDir, 'history.js'),
    path.join(moduleDir, 'sampling.js'),
    path.join(moduleDir, 'state.js')
  ]) {
    assert.equal(fs.existsSync(target), true, `missing expected extracted-prose modularization file: ${target}`);
  }
  const barrelSource = fs.readFileSync(barrelPath, 'utf8');
  const stateSource = fs.readFileSync(path.join(moduleDir, 'state.js'), 'utf8');
  assert.equal(barrelSource.includes("export * from './extracted-prose/index.js';"), true);
  for (const marker of [
    "from './cohorts.js'",
    "from './fingerprint.js'",
    "from './history.js'",
    "from './sampling.js'"
  ]) {
    assert.equal(stateSource.includes(marker), true, `expected extracted-prose state module to delegate via ${marker}`);
  }
  for (const legacyInlineMarker of [
    'const buildExtractedProseRepoFingerprint = (entries = []) => {',
    'const selectWarmupEntries = ({',
    'const normalizeLowYieldHistory = (value) => {',
    'export const buildExtractedProseLowYieldBailoutState = ({'
  ]) {
    assert.equal(barrelSource.includes(legacyInlineMarker), false);
  }
}

{
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
  observeExtractedProseLowYieldSample({ bailout, orderIndex: 0, result: { chunks: [{ id: 1 }] } });
  observeExtractedProseLowYieldSample({ bailout, orderIndex: 1, result: { chunks: [] } });
  const summary = buildExtractedProseLowYieldBailoutSummary(bailout);
  assert.ok(Array.isArray(summary.sampledFamilies));
  assert.ok(Array.isArray(summary.historyFamilies));
  assert.ok(Array.isArray(summary.historyDeferredFamilies));
  assert.ok(Array.isArray(summary.familyEvidence));
  assert.equal(summary.sampledFamilies.some((family) => family.key === '.md|docs'), true);
  assert.equal(summary.historyFamilies.some((family) => family.key === '.md|docs'), true);
  assert.equal(summary.familyEvidence.some((family) => family.key === '.md|docs'), true);
  assert.equal(summary.historyDeferred, false);
}

console.log('extracted prose low-yield contract matrix test passed');
