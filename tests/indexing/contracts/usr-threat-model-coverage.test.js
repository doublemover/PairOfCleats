#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUsrThreatModelCoverageReport,
  validateUsrThreatModelCoverage
} from '../../../src/contracts/validators/usr-matrix.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const readMatrix = (fileName) => JSON.parse(
  fs.readFileSync(path.join(root, 'tests', 'lang', 'matrix', fileName), 'utf8')
);

const fixtureGovernancePayload = readMatrix('usr-fixture-governance.json');
const securityGatesPayload = readMatrix('usr-security-gates.json');
const alertPoliciesPayload = readMatrix('usr-alert-policies.json');
const redactionRulesPayload = readMatrix('usr-redaction-rules.json');

const requiredFixture = fixtureGovernancePayload.rows[0].fixtureId;
const requiredControl = securityGatesPayload.rows[0].id;
const validThreatPayload = {
  schemaVersion: 'usr-registry-1.0.0',
  registryId: 'usr-threat-model-matrix',
  rows: [
    {
      id: 'threat-contract-pass',
      threatClass: 'contract-pass',
      attackSurface: 'runtime',
      requiredControls: [requiredControl],
      requiredFixtures: [requiredFixture],
      severity: 'high',
      blocking: true
    }
  ]
};

const valid = validateUsrThreatModelCoverage({
  threatModelPayload: validThreatPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload
});

assert.equal(valid.ok, true, 'expected valid threat payload to pass');
assert.equal(valid.errors.length, 0);
assert.equal(valid.rows.length, 1);
assert.equal(valid.rows[0].pass, true);

const passReport = buildUsrThreatModelCoverageReport({
  threatModelPayload: validThreatPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload,
  scope: null
});

assert.equal(passReport.payload.artifactId, 'usr-threat-model-coverage-report');
assert.equal(passReport.payload.status, 'pass');
assert.equal(passReport.payload.scope.scopeType, 'global');
assert.equal(passReport.payload.scope.scopeId, 'global');

const invalidThreatPayload = {
  ...validThreatPayload,
  rows: [
    {
      id: 'threat-contract-fail',
      threatClass: 'contract-fail',
      attackSurface: 'runtime',
      requiredControls: ['missing-control'],
      requiredFixtures: ['missing-fixture'],
      severity: 'critical',
      blocking: false
    }
  ]
};

const invalid = validateUsrThreatModelCoverage({
  threatModelPayload: invalidThreatPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload
});

assert.equal(invalid.ok, false, 'expected invalid threat payload to fail');
assert(
  invalid.errors.some((message) => message.includes('critical threat rows must be blocking')),
  'expected severity/blocking contract error'
);
assert(
  invalid.errors.some((message) => message.includes('missing control mappings')),
  'expected missing control mapping error'
);
assert(
  invalid.errors.some((message) => message.includes('missing fixture mappings')),
  'expected missing fixture mapping error'
);

console.log('usr threat model coverage test passed');
