#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stampIndexStateExtractionQuality, stripIndexStateNondeterministicFields } from '../../../src/index/build/artifacts/reporting.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { resolveExtractionQuality } from '../../../src/shared/extraction-quality.js';
import { buildScanProfile } from '../../../tools/index/report-artifacts/scan-profile.js';
import { evaluateBenchVerdict } from '../../../tools/bench/language/verdict.js';
import { buildBenchQualityBudgetSummary } from '../../../tools/bench/language/quality-summary.js';
import { validateArtifact } from '../../../src/contracts/artifact-schemas.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `extraction-quality-observation-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const lowYield = { enabled: true, triggered: true, sampledFiles: 48, skippedFiles: 6,
  estimatedSuppressedFiles: 3, estimatedRecallLossRatio: 0.375 };
const buildProfile = (indexDir, timings = null) => buildScanProfile({
  artifactReport: { repo: {} }, indexMetrics: { extractedProse: { indexDir, timings } } });
try {
  for (const [name, documentExtractionEnabled, tinyRepoMinimalArtifacts] of [
    ['documents-off', false, false], ['tiny-repo', true, true], ['documents-on', true, false]
  ]) {
    const indexDir = path.join(root, name);
    await fs.mkdir(indexDir);
    const indexState = { generatedAt: '2026-10-04T00:00:00Z', mode: 'extracted-prose', artifactSurfaceVersion: '1.0.0' };
    stampIndexStateExtractionQuality({ indexState, state: { extractedProseLowYieldBailout: lowYield },
      mode: 'extracted-prose', documentExtractionEnabled, tinyRepoMinimalArtifacts });
    await writeJsonObjectFile(path.join(indexDir, 'index_state.json'), { fields: indexState, atomic: true });
    const profile = buildProfile(indexDir);
    const quality = profile.modes['extracted-prose'].quality;
    assert.equal(quality.observation, 'observed');
    assert.equal(quality.lowYieldBailout.triggered, true);
    assert.equal(quality.lowYieldBailout.skippedFiles, 6);
    assert.equal(quality.lowYieldBailout.estimatedSuppressedFiles, 3, 'actual skips remain distinct from estimated recall loss');
    assert.equal((await fs.readdir(indexDir)).includes('extraction_report.json'), false);
    assert.equal(validateArtifact('scan_profile', profile).ok, true);
  }
  const missingDir = path.join(root, 'missing');
  await fs.mkdir(missingDir);
  const fallback = buildProfile(missingDir, { extractedProseLowYieldBailout: lowYield });
  assert.equal(fallback.modes['extracted-prose'].quality.lowYieldBailout.triggered, true);
  assert.equal(fallback.modes['extracted-prose'].quality.source, 'legacy-stage1-timings');
  const unknownState = { extensions: { bundleEmbeddingSynchronization: { observation: 'observed',
    coverage: { complete: false, unexaminedFiles: 5 } } } };
  stampIndexStateExtractionQuality({ indexState: unknownState, state: {}, mode: 'extracted-prose' });
  assert.equal(unknownState.extensions.extractionQuality.observation, 'unknown');
  assert.equal(unknownState.extensions.extractionQuality.lowYieldBailout, null);
  await writeJsonObjectFile(path.join(missingDir, 'index_state.json'), { fields: unknownState, atomic: true });
  assert.equal(buildProfile(missingDir).modes['extracted-prose'].quality.observation, 'unknown');
  assert.equal(resolveExtractionQuality({ state: unknownState, timings: { extractedProseLowYieldBailout: lowYield } }).observation, 'unknown',
    'an explicit unknown producer record is not overwritten by stale legacy evidence');
  assert.equal(resolveExtractionQuality({ refreshedBundles: { lowYieldBailout: lowYield } }).observation, 'unknown',
    'bundle-refresh-only observations are not source-extraction recall evidence');
  assert.equal(resolveExtractionQuality({ extractionQuality: { stage: 'stage3-bundle-synchronization',
    observation: 'observed', lowYieldBailout: lowYield } }).observation, 'unknown');
  const firstDecision = {};
  const laterDecision = {};
  stampIndexStateExtractionQuality({ indexState: firstDecision, mode: 'extracted-prose',
    state: { extractedProseLowYieldBailout: { ...lowYield, decisionAt: '2026-10-04T00:00:01Z' } } });
  stampIndexStateExtractionQuality({ indexState: laterDecision, mode: 'extracted-prose',
    state: { extractedProseLowYieldBailout: { ...lowYield, decisionAt: '2026-10-04T00:00:02Z' } } });
  assert.deepEqual(stripIndexStateNondeterministicFields(firstDecision, { forStableHash: true }),
    stripIndexStateNondeterministicFields(laterDecision, { forStableHash: true }), 'decision time does not perturb stable artifact identity');

  const verdict = (payload) => evaluateBenchVerdict({ tasks: [{ repo: 'fixture/quality', language: 'javascript',
    summary: { queries: 1 }, payload }], policy: { waivers: [] } });
  const unobserved = verdict({ scanProfile: buildProfile(missingDir) });
  assert.equal(unobserved.run.productionClean.status, 'fail');
  assert.equal(unobserved.run.productionClean.metrics.unobservedQualityRepos, 1);
  assert.equal(unobserved.run.exitCode, 0, 'quality admission does not turn ordinary partial runs into hard failures');
  const observedNoLoss = verdict({ extractionQuality: { observation: 'observed', lowYieldBailout: { triggered: false } } });
  assert.equal(observedNoLoss.run.productionClean.status, 'pass');
  assert.equal(observedNoLoss.run.productionClean.metrics.unobservedQualityRepos, 0);
  const observedLoss = verdict({ scanProfile: fallback });
  assert.equal(observedLoss.run.productionClean.metrics.qualityBudgetLossRepos, 1);
  assert.equal(observedLoss.run.productionClean.status, 'fail');
  const budget = buildBenchQualityBudgetSummary([{ payload: { timings: { extractedProseLowYieldBailout: {
    ...lowYield, repoFingerprint: { totalEntries: 8 } } } } }, { payload: { extractionQuality: {
    observation: 'observed', lowYieldBailout: { triggered: false, estimatedRecallLossRatio: 0,
      repoFingerprint: { totalEntries: 8 } } } } }, { payload: { refreshedBundles: { lowYieldBailout: lowYield } } }]);
  assert.equal(budget.observedTaskCount, 2);
  assert.equal(budget.unknownTaskCount, 1);
  assert.equal(budget.observation, 'partial');
  assert.equal(budget.reducedRecallCount, 1);
  assert.equal(budget.skippedFiles, 6);
  assert.equal(budget.estimatedSuppressedFiles, 3);
  assert.equal(budget.weightedRecallLossRatio, 0.1875, 'observed zero-loss tasks remain in the weighted denominator');
  console.log('Independent quality stamping, persisted scan consumption, legacy timing fallback and truthful clean-gate observation pass.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
