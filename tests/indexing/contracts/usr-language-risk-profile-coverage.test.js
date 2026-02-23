#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateUsrLanguageRiskProfileCoverage } from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const languageProfilesPayload = readMatrix('usr-language-profiles.json');
const languageRiskProfilesPayload = readMatrix('usr-language-risk-profiles.json');

const valid = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload,
  languageRiskProfilesPayload
});
assert.equal(valid.errors.length, 0, 'expected canonical language risk profiles to have no errors');
assert.equal(valid.ok, true);

const invalidRiskProfilesPayload = structuredClone(languageRiskProfilesPayload);
const duplicateRow = structuredClone(invalidRiskProfilesPayload.rows[0]);
invalidRiskProfilesPayload.rows.push(duplicateRow);

const invalid = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload,
  languageRiskProfilesPayload: invalidRiskProfilesPayload
});
assert.equal(invalid.ok, false, 'expected duplicate language risk profile row to fail');
assert(
  invalid.errors.some((message) => message.includes('duplicate risk profile row for language/framework pair')),
  'expected duplicate risk row validation error'
);

console.log('usr language risk profile coverage test passed');
