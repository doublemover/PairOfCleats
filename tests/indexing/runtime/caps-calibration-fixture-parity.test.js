#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildCapsCalibrationArtifacts } from '../../../src/index/build/runtime/caps-calibration.js';

applyTestEnv();

const fixtureDir = path.join(process.cwd(), 'tests', 'fixtures', 'perf', 'index');
const inputsPath = path.join(fixtureDir, 'caps-calibration-inputs.json');
const resultsPath = path.join(fixtureDir, 'caps-calibration-results.json');

const [inputsFixture, resultsFixture] = await Promise.all([
  fs.readFile(inputsPath, 'utf8').then((raw) => JSON.parse(raw)),
  fs.readFile(resultsPath, 'utf8').then((raw) => JSON.parse(raw))
]);

const artifacts = buildCapsCalibrationArtifacts();

const expectedInputs = {
  schemaVersion: artifacts.schemaVersion,
  generatedAt: artifacts.generatedAt,
  source: artifacts.inputs.source,
  languages: artifacts.inputs.languages
};
const expectedResults = {
  schemaVersion: artifacts.schemaVersion,
  generatedAt: artifacts.generatedAt,
  fileCapsByLanguage: artifacts.results.fileCapsByLanguage,
  treeSitterByLanguage: artifacts.results.treeSitterByLanguage
};

assert.deepEqual(
  inputsFixture,
  expectedInputs,
  'caps calibration inputs fixture drifted from deterministic runtime calibration artifacts'
);
assert.deepEqual(
  resultsFixture,
  expectedResults,
  'caps calibration results fixture drifted from deterministic runtime calibration artifacts'
);

console.log('caps calibration fixture parity test passed');
