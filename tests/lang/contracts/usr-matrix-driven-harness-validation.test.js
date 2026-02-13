#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../runner/run-config.js';
import { validateUsrMatrixDrivenHarnessCoverage } from '../../../src/contracts/validators/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const languageProfilesPath = path.join(matrixDir, 'usr-language-profiles.json');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const frameworkProfilesPath = path.join(matrixDir, 'usr-framework-profiles.json');
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const fixtureGovernancePath = path.join(matrixDir, 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const batchShardsPath = path.join(matrixDir, 'usr-language-batch-shards.json');
const batchShards = JSON.parse(fs.readFileSync(batchShardsPath, 'utf8'));

const runRules = loadRunRules({ root: repoRoot });
const knownLanes = Array.from(runRules.knownLanes || []);

const validation = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload: languageProfiles,
  frameworkProfilesPayload: frameworkProfiles,
  fixtureGovernancePayload: fixtureGovernance,
  batchShardsPayload: batchShards,
  knownLanes
});
assert.equal(validation.ok, true, `matrix-driven harness coverage should pass: ${validation.errors.join('; ')}`);
assert.equal(
  validation.rows.length,
  (languageProfiles.rows || []).length + (frameworkProfiles.rows || []).length,
  'matrix-driven harness coverage should emit one row per language and framework profile'
);

const missingConformanceLane = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload: languageProfiles,
  frameworkProfilesPayload: frameworkProfiles,
  fixtureGovernancePayload: fixtureGovernance,
  batchShardsPayload: batchShards,
  knownLanes: knownLanes.filter((laneId) => laneId !== 'conformance-framework-canonicalization')
});
assert.equal(missingConformanceLane.ok, false, 'matrix-driven harness coverage should fail when required conformance lanes are unavailable');
assert.equal(
  missingConformanceLane.errors.some((message) => message.includes('conformance-framework-canonicalization')),
  true,
  'matrix-driven harness coverage failure should identify the missing required conformance lane'
);

console.log('usr matrix-driven harness validation checks passed');
