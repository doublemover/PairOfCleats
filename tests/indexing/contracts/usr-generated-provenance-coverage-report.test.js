#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrGeneratedProvenanceCoverageReport,
  validateUsrGeneratedProvenanceCoverage
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readJson = (...segments) => JSON.parse(
  fs.readFileSync(path.join(root, ...segments), 'utf8')
);

const provenanceCasesPayload = readJson('tests', 'lang', 'matrix', 'usr-generated-provenance-cases.json');
const provenanceBundlePayload = readJson(
  'tests',
  'fixtures',
  'usr',
  'generated-provenance',
  'usr-generated-provenance-bundle.json'
);

const valid = validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload,
  provenanceBundlePayload
});
assert.equal(valid.ok, true, 'expected canonical generated-provenance fixtures to validate');
assert.equal(valid.errors.length, 0);

const exactCaseId = provenanceCasesPayload.rows.find((row) => row.mappingExpectation === 'exact')?.id;
assert.equal(typeof exactCaseId, 'string');

const invalidBundlePayload = structuredClone(provenanceBundlePayload);
const invalidRow = invalidBundlePayload.rows.find((row) => row.provenanceCaseId === exactCaseId);
assert.ok(invalidRow, 'expected exact-case row in generated provenance bundle');
invalidRow.diagnostics = [{
  code: 'USR-W-PROVENANCE-APPROXIMATE',
  severity: 'warning',
  reasonCode: 'USR-R-HEURISTIC-ONLY'
}];

const invalid = validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload,
  provenanceBundlePayload: invalidBundlePayload
});
assert.equal(invalid.ok, false, 'expected exact-case diagnostics violation to fail');
assert(
  invalid.errors.some((message) => message.includes('exact mapping expectation must not emit diagnostics')),
  'expected exact mapping diagnostics validation error'
);

const report = buildUsrGeneratedProvenanceCoverageReport({
  provenanceCasesPayload,
  provenanceBundlePayload: invalidBundlePayload,
  lane: 'nightly',
  scope: { scopeType: 'lane', scopeId: 'nightly' }
});
assert.equal(report.payload.artifactId, 'usr-validation-report');
assert.equal(report.payload.status, 'fail');
assert.equal(report.payload.summary.dashboard, 'generated-provenance-coverage');
assert.equal(report.payload.summary.errorCount > 0, true);
assert.equal(report.payload.scope.scopeType, 'lane');
assert.equal(report.payload.scope.scopeId, 'nightly');

console.log('usr generated provenance coverage report test passed');
