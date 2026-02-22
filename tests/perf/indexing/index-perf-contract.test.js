#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  validateIndexPerfCorpusManifest,
  validateIndexPerfDeltaReport,
  validateIndexPerfTelemetry
} from '../../../src/contracts/validators/index-perf.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readJson = (relPath) => JSON.parse(
  fs.readFileSync(path.join(root, relPath), 'utf8')
);

const corpusPath = 'benchmarks/index/perf-corpus-manifest.json';
const baselinePath = 'benchmarks/index/perf-baseline-telemetry.json';
const afterPath = 'benchmarks/index/perf-after-telemetry.json';
const deltaPath = 'benchmarks/index/perf-delta-report.json';

const corpus = readJson(corpusPath);
const baseline = readJson(baselinePath);
const after = readJson(afterPath);
const delta = readJson(deltaPath);

const corpusValidation = validateIndexPerfCorpusManifest(corpus);
assert.equal(corpusValidation.ok, true, corpusValidation.errors.join('; '));

const baselineValidation = validateIndexPerfTelemetry(baseline);
assert.equal(baselineValidation.ok, true, baselineValidation.errors.join('; '));

const afterValidation = validateIndexPerfTelemetry(after);
assert.equal(afterValidation.ok, true, afterValidation.errors.join('; '));

const deltaValidation = validateIndexPerfDeltaReport(delta);
assert.equal(deltaValidation.ok, true, deltaValidation.errors.join('; '));

assert.equal(baseline.indexOptimizationProfile, 'default');
assert.equal(after.indexOptimizationProfile, baseline.indexOptimizationProfile);
assert.equal(delta.indexOptimizationProfile, baseline.indexOptimizationProfile);
assert.equal(delta.baselineRef, baselinePath);
assert.equal(delta.afterRef, afterPath);
assert.equal(fs.existsSync(path.join(root, delta.baselineRef)), true, 'baselineRef must resolve to an existing file');
assert.equal(fs.existsSync(path.join(root, delta.afterRef)), true, 'afterRef must resolve to an existing file');

const sortedCorpusPaths = [...corpus.files].map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
assert.deepEqual(
  corpus.files.map((entry) => entry.path),
  sortedCorpusPaths,
  'perf corpus manifest files must be sorted by path for deterministic diffs'
);
const corpusFileCount = corpus.files.length;
const corpusByteTotal = corpus.files.reduce((sum, entry) => sum + Number(entry.sizeBytes || 0), 0);
assert.equal(corpus.totals.files, corpusFileCount, 'perf corpus totals.files must match files[] length');
assert.equal(corpus.totals.bytes, corpusByteTotal, 'perf corpus totals.bytes must equal summed file sizes');

const baselineStageKeys = Object.keys(baseline.stageMetrics);
assert.deepEqual(Object.keys(after.stageMetrics), baselineStageKeys, 'baseline and after stage sets must match');
assert.deepEqual(Object.keys(delta.deltaByStage), baselineStageKeys, 'delta stage keys must match telemetry stage keys');
for (const stageKey of baselineStageKeys) {
  const expectedDelta = after.stageMetrics[stageKey].wallMs - baseline.stageMetrics[stageKey].wallMs;
  const actualDelta = Number(delta.deltaByStage[stageKey]);
  assert.equal(Number.isFinite(actualDelta), true, `deltaByStage.${stageKey} must be finite`);
  assert.ok(
    Math.abs(actualDelta - expectedDelta) < 1e-9,
    `deltaByStage.${stageKey} must equal after-baseline wallMs`
  );
}

console.log('index perf contract test passed');
