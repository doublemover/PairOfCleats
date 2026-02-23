#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsrConformanceLevelCoverage } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const conformanceLevelsPayload = readMatrix('usr-conformance-levels.json');

const valid = validateUsrConformanceLevelCoverage({
  targetLevel: 'C1',
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes: []
});
assert.equal(valid.errors.length, 0, 'expected canonical conformance coverage to have no errors');
assert.equal(valid.ok, true);

const unsupported = validateUsrConformanceLevelCoverage({
  targetLevel: 'C9',
  languageProfilesPayload,
  conformanceLevelsPayload
});
assert.equal(unsupported.ok, false);
assert(
  unsupported.errors.some((message) => message.includes('unsupported target conformance level')),
  'expected unsupported-level validation error'
);

const invalidConformancePayload = structuredClone(conformanceLevelsPayload);
const c1Row = invalidConformancePayload.rows.find((row) => (
  row.profileType === 'language'
  && Array.isArray(row.requiredLevels)
  && row.requiredLevels.includes('C1')
));
assert.ok(c1Row, 'expected at least one language conformance row requiring C1');
c1Row.requiredLevels = c1Row.requiredLevels.filter((level) => level !== 'C1');

const invalid = validateUsrConformanceLevelCoverage({
  targetLevel: 'C1',
  languageProfilesPayload,
  conformanceLevelsPayload: invalidConformancePayload,
  knownLanes: []
});
assert.equal(invalid.ok, false, 'expected missing C1 required level to fail validation');
assert(
  invalid.errors.some((message) => message.includes('requiredLevels missing target level C1')),
  'expected requiredLevels target-level validation error'
);

console.log('usr conformance level coverage test passed');
