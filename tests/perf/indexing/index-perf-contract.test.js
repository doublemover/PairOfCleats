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

const corpus = readJson('benchmarks/index/perf-corpus-manifest.json');
const baseline = readJson('benchmarks/index/perf-baseline-telemetry.json');
const after = readJson('benchmarks/index/perf-after-telemetry.json');
const delta = readJson('benchmarks/index/perf-delta-report.json');

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

console.log('index perf contract test passed');
