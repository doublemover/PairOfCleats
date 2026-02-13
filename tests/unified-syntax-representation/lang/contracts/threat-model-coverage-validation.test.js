#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrThreatModelCoverage,
  buildUsrThreatModelCoverageReport
} from '../../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });

const threatModelPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-threat-model-matrix.json');
const threatModel = JSON.parse(fs.readFileSync(threatModelPath, 'utf8'));
const threatRows = Array.isArray(threatModel.rows) ? threatModel.rows : [];

const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));

const securityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-security-gates.json');
const securityGates = JSON.parse(fs.readFileSync(securityGatesPath, 'utf8'));

const alertPoliciesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-alert-policies.json');
const alertPolicies = JSON.parse(fs.readFileSync(alertPoliciesPath, 'utf8'));
const redactionRulesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-redaction-rules.json');
const redactionRules = JSON.parse(fs.readFileSync(redactionRulesPath, 'utf8'));

assert.equal(threatRows.length > 0, true, 'threat-model matrix must contain rows');

const criticalThreatRows = threatRows.filter((row) => row.severity === 'critical');
assert.equal(criticalThreatRows.length > 0, true, 'threat-model matrix must include critical threat rows');
for (const row of criticalThreatRows) {
  assert.equal(row.blocking, true, `critical threat rows must be blocking: ${row.id}`);
}

const attackSurfaces = new Set(threatRows.map((row) => row.attackSurface));
for (const surface of ['parser', 'input', 'reporting', 'runtime', 'serialization']) {
  assert.equal(attackSurfaces.has(surface), true, `threat-model matrix must cover required attack surface: ${surface}`);
}

const coverage = validateUsrThreatModelCoverage({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: fixtureGovernance,
  securityGatesPayload: securityGates,
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules
});
assert.equal(coverage.ok, true, `threat-model coverage validation should pass: ${coverage.errors.join('; ')}`);

const coverageReport = buildUsrThreatModelCoverageReport({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: fixtureGovernance,
  securityGatesPayload: securityGates,
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules,
  runId: 'run-usr-threat-model-coverage-001',
  lane: reportLane,
  producerId: 'usr-threat-model-harness'
});
assert.equal(coverageReport.ok, true, `threat-model coverage report should pass: ${coverageReport.errors.join('; ')}`);
const reportValidation = validateUsrReport('usr-threat-model-coverage-report', coverageReport.payload);
assert.equal(reportValidation.ok, true, `threat-model coverage report payload must validate: ${reportValidation.errors.join('; ')}`);

const negativeCoverage = validateUsrThreatModelCoverage({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: {
    ...fixtureGovernance,
    rows: (fixtureGovernance.rows || []).filter((row) => row.fixtureId !== 'usr::failure-injection::parser-lock-001')
  },
  securityGatesPayload: securityGates,
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules
});
assert.equal(negativeCoverage.ok, false, 'threat-model coverage validation must fail when required fixtures are missing');
assert.equal(negativeCoverage.errors.some((msg) => msg.includes('threat-parser-supply-chain')), true, 'threat-model coverage errors must include affected threat row id');

console.log('usr threat-model coverage validation checks passed');
