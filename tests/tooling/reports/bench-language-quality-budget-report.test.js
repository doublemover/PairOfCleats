#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildBenchRunDiagnosticsSummaryLines,
  buildReportOutput
} from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-quality-budget-report');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outFile = path.join(tempRoot, 'fixture.json');
await fs.writeFile(
  outFile,
  JSON.stringify({
    artifacts: {
      scanProfile: {
        modes: {
          'extracted-prose': {
            quality: {
              lowYieldBailout: {
                enabled: true,
                triggered: true,
                reason: 'low_yield',
                qualityImpact: 'reduced-extracted-prose-recall',
                repoYieldClass: 'sparse-high-value',
                seed: 'bench-quality-budget',
                warmupWindowSize: 8,
                warmupSampleSize: 4,
                sampledFiles: 4,
                sampledYieldedFiles: 0,
                sampledChunkCount: 0,
                observedYieldRatio: 0,
                minYieldRatio: 0.25,
                minYieldedFiles: 1,
                suppressedCohortCount: 1,
                protectedCohortCount: 1,
                strategyMismatchRiskCount: 0,
                estimatedSuppressedFiles: 3,
                estimatedRecallLossRatio: 0.375,
                estimatedRecallLossClass: 'high',
                estimatedRecallLossConfidence: 'medium',
                opportunityCost: {
                  class: 'limited',
                  estimatedSuppressedFiles: 3,
                  estimatedRecallLossRatio: 0.375,
                  estimatedRecallLossClass: 'high',
                  estimatedRecallLossConfidence: 'medium',
                  skippedFiles: 6,
                  estimatedAvoidedChunkSamples: 0,
                  suppressedCohortCount: 1,
                  protectedCohortCount: 1,
                  protectedHighValueCohortCount: 1,
                  strategyMismatchRiskCount: 0
                },
                recallCost: {
                  class: 'high',
                  qualityImpact: 'reduced-extracted-prose-recall',
                  downgradedRecall: true,
                  estimatedSuppressedFiles: 3,
                  estimatedRecallLossRatio: 0.375,
                  estimatedRecallLossClass: 'high',
                  estimatedRecallLossConfidence: 'medium',
                  skippedFiles: 0,
                  estimatedAvoidedChunkSamples: 0,
                  suppressedCohortCount: 1,
                  protectedCohortCount: 1,
                  protectedHighValueCohortCount: 1,
                  strategyMismatchRiskCount: 0
                },
                skippedFiles: 6,
                decisionAtOrderIndex: 4,
                decisionAt: '2026-03-22T00:00:01.000Z',
                repoFingerprint: {
                  totalEntries: 8,
                  docLikeEntries: 2,
                  dominantCohort: 'generated-machine',
                  cohortCounts: {
                    'docs-markdown': 2,
                    'tests-examples': 0,
                    'templates-config': 0,
                    'generated-machine': 6,
                    'code-comment-heavy': 0
                  }
                },
                suppressedCohorts: [{
                  key: 'generated-machine',
                  suppressionClass: 'genuine-low-yield',
                  expectedYieldClass: 'expected-low',
                  warmupFiles: 3,
                  sampledFiles: 3,
                  sampledObservedFiles: 3,
                  sampledYieldedFiles: 0,
                  sampledChunkCount: 0,
                  repoFiles: 6,
                  estimatedSuppressedFiles: 3,
                  estimatedRecallLossRatio: 0.375
                }],
                protectedCohorts: [{
                  key: 'docs-markdown',
                  expectedYieldClass: 'expected-high',
                  strategyMismatchRisk: false,
                  protectedBySample: false,
                  protectedByHistory: true,
                  protectedByPriority: true
                }],
                strategyMismatchRiskCohorts: [],
                deterministic: true,
                downgradedRecall: true
              }
            }
          }
        }
      }
    }
  }, null, 2),
  'utf8'
);

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: tempRoot,
  results: [{
    language: 'javascript',
    tier: 'small',
    repo: 'org/example',
    repoPath: 'C:/repo/example',
    outFile
  }],
  config: {
    javascript: { label: 'JavaScript' }
  }
});

const qualityBudget = output?.diagnostics?.qualityBudget;
assert.ok(qualityBudget && typeof qualityBudget === 'object', 'expected quality budget summary');
assert.equal(qualityBudget.observedTaskCount, 1, 'expected one quality-budget-aware task');
assert.equal(qualityBudget.reducedRecallCount, 1, 'expected reduced recall to be tracked');
assert.equal(qualityBudget.skippedFiles, 6, 'expected skipped-file accounting');
assert.equal(qualityBudget.estimatedSuppressedFiles, 3, 'expected suppressed-file estimate');
assert.equal(qualityBudget.countsByRepoYieldClass['sparse-high-value'], 1, 'expected repo-yield classification');
assert.equal(qualityBudget.countsByOpportunityClass.limited, 1, 'expected opportunity-cost classification');
assert.equal(qualityBudget.countsByRecallClass.high, 1, 'expected recall-cost classification');

const lines = buildBenchRunDiagnosticsSummaryLines(output);
assert.equal(
  lines.some((line) => line === '[diagnostics] extracted-prose quality budget: reduced-recall=1 | skipped-files=6 | suppressed-est=3 | weighted-recall-loss=37.5%'),
  true,
  'expected extracted-prose quality budget closeout line'
);
assert.equal(
  lines.some((line) => line === '[diagnostics] extracted-prose classes: sparse-high-value=1 | opportunity-limited=1 | recall-high=1'),
  true,
  'expected extracted-prose quality budget class line'
);

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('bench language quality budget report test passed');
