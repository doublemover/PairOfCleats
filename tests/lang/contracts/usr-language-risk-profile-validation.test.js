#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateUsrLanguageRiskProfileCoverage } from '../../../src/contracts/validators/usr-matrix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const languageProfiles = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-language-profiles.json'), 'utf8'));
const riskProfiles = JSON.parse(fs.readFileSync(path.join(matrixDir, 'usr-language-risk-profiles.json'), 'utf8'));

const validation = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload: languageProfiles,
  languageRiskProfilesPayload: riskProfiles
});
assert.equal(validation.ok, true, `language risk profile coverage should pass: ${validation.errors.join('; ')}`);

const unsupportedInterproceduralRow = (riskProfiles.rows || []).find((row) => row?.capabilities?.riskInterprocedural === 'unsupported');
assert.equal(Boolean(unsupportedInterproceduralRow), true, 'risk profiles must include at least one riskInterprocedural=unsupported row for negative coverage');

const unsupportedInterproceduralNegative = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload: languageProfiles,
  languageRiskProfilesPayload: {
    ...riskProfiles,
    rows: (riskProfiles.rows || []).map((row) => (
      row.languageId === unsupportedInterproceduralRow.languageId
        ? {
            ...row,
            interproceduralGating: {
              ...row.interproceduralGating,
              enabledByDefault: true
            }
          }
        : row
    ))
  }
});
assert.equal(unsupportedInterproceduralNegative.ok, false, 'risk profile validation must fail when interprocedural gating is enabled for unsupported interprocedural risk');
assert.equal(
  unsupportedInterproceduralNegative.errors.some((message) => message.includes(unsupportedInterproceduralRow.languageId)),
  true,
  'risk profile gating failure must include the mutated language ID'
);

const overlapNegative = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload: languageProfiles,
  languageRiskProfilesPayload: {
    ...riskProfiles,
    rows: (riskProfiles.rows || []).map((row, index) => (
      index === 0
        ? {
            ...row,
            optional: {
              ...row.optional,
              sources: [...(row.optional?.sources || []), (row.required?.sources || [])[0]].filter(Boolean)
            }
          }
        : row
    ))
  }
});
assert.equal(overlapNegative.ok, false, 'risk profile validation must fail when required and optional taxonomies overlap');
assert.equal(overlapNegative.errors.some((message) => message.includes('overlap')), true, 'overlap failure must include overlap reason');

console.log('usr language risk profile validation checks passed');
