#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsrMatrixDrivenHarnessCoverage } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const frameworkProfilesPayload = readMatrix('usr-framework-profiles.json');
const fixtureGovernancePayload = readMatrix('usr-fixture-governance.json');
const batchShardsPayload = readMatrix('usr-language-batch-shards.json');

const valid = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload,
  frameworkProfilesPayload,
  fixtureGovernancePayload,
  batchShardsPayload,
  knownLanes: []
});
assert.equal(valid.errors.length, 0, 'expected canonical matrix-driven harness payload to have no errors');
assert.equal(valid.ok, true);
assert.equal(valid.rows.length > 0, true);

const invalidFrameworkPayload = structuredClone(frameworkProfilesPayload);
const firstFrameworkRow = invalidFrameworkPayload.rows[0];
assert.ok(firstFrameworkRow, 'expected at least one framework profile row');
firstFrameworkRow.appliesToLanguages = [...(firstFrameworkRow.appliesToLanguages || []), 'missing-language-id'];

const invalid = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload,
  frameworkProfilesPayload: invalidFrameworkPayload,
  fixtureGovernancePayload,
  batchShardsPayload,
  knownLanes: []
});
assert.equal(invalid.ok, false, 'expected unknown framework language mapping to fail');
assert(
  invalid.errors.some((message) => message.includes('framework appliesToLanguages references unknown language: missing-language-id')),
  'expected unknown language mapping validation error'
);

console.log('usr matrix-driven harness coverage test passed');
