#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateUsrMatrixRegistry,
  listUsrMatrixRegistryIds,
  resolveUsrRuntimeConfig,
  validateUsrRuntimeConfigResolution,
  validateUsrFeatureFlagConflicts,
  buildUsrFeatureFlagStateReport,
  evaluateUsrFailureInjectionScenarios,
  buildUsrFailureInjectionReport,
  validateUsrFixtureGovernanceControls,
  buildUsrFixtureGovernanceValidationReport,
  validateUsrBenchmarkMethodology,
  evaluateUsrBenchmarkRegression,
  buildUsrBenchmarkRegressionReport,
  validateUsrThreatModelCoverage,
  buildUsrThreatModelCoverageReport
} from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const requiredRegistries = [
  'usr-runtime-config-policy',
  'usr-failure-injection-matrix',
  'usr-fixture-governance',
  'usr-language-profiles',
  'usr-framework-profiles',
  'usr-capability-matrix',
  'usr-ownership-matrix',
  'usr-escalation-policy',
  'usr-benchmark-policy',
  'usr-slo-budgets',
  'usr-security-gates',
  'usr-alert-policies',
  'usr-redaction-rules',
  'usr-threat-model-matrix',
  'usr-waiver-policy'
];

for (const registryId of requiredRegistries) {
  const filePath = path.join(matrixDir, `${registryId}.json`);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const result = validateUsrMatrixRegistry(registryId, payload);
  assert.equal(result.ok, true, `${registryId} should validate: ${result.errors.join('; ')}`);
}

const registryIds = listUsrMatrixRegistryIds();
for (const registryId of requiredRegistries) {
  assert.equal(registryIds.includes(registryId), true, `expected validator registry list to include ${registryId}`);
}

const runtimePolicyPath = path.join(matrixDir, 'usr-runtime-config-policy.json');
const runtimePolicy = JSON.parse(fs.readFileSync(runtimePolicyPath, 'utf8'));
const negative = {
  ...runtimePolicy,
  rows: runtimePolicy.rows.map((row, idx) => (idx === 0 ? { ...row, unexpectedFlag: true } : row))
};
const negativeResult = validateUsrMatrixRegistry('usr-runtime-config-policy', negative);
assert.equal(negativeResult.ok, false, 'unknown row key must fail strict matrix validation');

const runtimeResolution = resolveUsrRuntimeConfig({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': 1800,
      'usr.framework.enableOverlays': false
    },
    env: {
      'usr.parser.maxSegmentMs': '2000',
      'usr.framework.enableOverlays': 'true'
    },
    argv: {
      'usr.parser.maxSegmentMs': 2500
    }
  }
});
assert.equal(runtimeResolution.ok, true, `runtime resolution should pass: ${runtimeResolution.errors.join('; ')}`);
assert.equal(runtimeResolution.values['usr.parser.maxSegmentMs'], 2500, 'argv layer must win precedence');
assert.equal(runtimeResolution.values['usr.framework.enableOverlays'], true, 'env must override policy-file for boolean values');
assert.equal(runtimeResolution.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'expected argv source tracking');
assert.equal(runtimeResolution.appliedByKey['usr.framework.enableOverlays'], 'env', 'expected env source tracking');

const runtimeStrictFailure = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    env: {
      'usr.parser.maxSegmentMs': '50000'
    }
  }
});
assert.equal(runtimeStrictFailure.ok, false, 'strict disallow violation should fail');
assert.equal(runtimeStrictFailure.errors.some((msg) => msg.includes('usr.parser.maxSegmentMs')), true, 'strict error should reference failing key');

const runtimeWarningOnly = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    env: {
      'usr.reporting.emitRawParserKinds': 'maybe'
    }
  }
});
assert.equal(runtimeWarningOnly.ok, true, 'warn-unknown strict behavior should not fail resolution');
assert.equal(runtimeWarningOnly.warnings.some((msg) => msg.includes('usr.reporting.emitRawParserKinds')), true, 'warn-only row should emit warning');

const runtimeUnknownKey = validateUsrRuntimeConfigResolution({
  policyPayload: runtimePolicy,
  strictMode: false,
  layers: {
    argv: {
      'usr.unknown.key': true
    }
  }
});
assert.equal(runtimeUnknownKey.ok, true, 'unknown keys should be warnings in non-strict mode');
assert.equal(runtimeUnknownKey.warnings.some((msg) => msg.includes('usr.unknown.key')), true, 'unknown key should be surfaced as warning');

const strictFeatureFlagConflict = validateUsrFeatureFlagConflicts({
  values: {
    'usr.rollout.cutoverEnabled': true,
    'usr.rollout.shadowReadEnabled': true,
    'usr.strictMode.enabled': true
  },
  strictMode: true
});
assert.equal(strictFeatureFlagConflict.ok, false, 'strict feature-flag conflict must fail');
assert.equal(strictFeatureFlagConflict.errors.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'strict conflict must report cutover/shadow conflict');

const nonStrictFeatureFlagConflict = validateUsrFeatureFlagConflicts({
  values: {
    'usr.rollout.cutoverEnabled': true,
    'usr.rollout.shadowReadEnabled': true,
    'usr.strictMode.enabled': true
  },
  strictMode: false
});
assert.equal(nonStrictFeatureFlagConflict.ok, true, 'non-strict feature-flag conflict should downgrade to warning');
assert.equal(nonStrictFeatureFlagConflict.warnings.some((msg) => msg.includes('usr.rollout.cutoverEnabled')), true, 'non-strict conflict warning must mention conflicting flags');

const featureFlagState = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    policyFile: {
      'usr.parser.maxSegmentMs': 1800,
      'usr.framework.enableOverlays': false
    },
    env: {
      'usr.parser.maxSegmentMs': '2200'
    },
    argv: {
      'usr.parser.maxSegmentMs': 2500,
      'usr.rollout.cutoverEnabled': false,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-feature-flag-state-001',
  lane: 'ci-lite',
  producerId: 'usr-matrix-validator-tests'
});
assert.equal(featureFlagState.ok, true, `feature-flag state report should succeed: ${featureFlagState.errors.join('; ')}`);
assert.equal(featureFlagState.values['usr.parser.maxSegmentMs'], 2500, 'feature-flag state report must preserve runtime precedence resolution');
assert.equal(featureFlagState.appliedByKey['usr.parser.maxSegmentMs'], 'argv', 'feature-flag state report must preserve runtime source attribution');
assert.equal(featureFlagState.payload.rows.length, runtimePolicy.rows.length, 'feature-flag state rows must cover every runtime policy key');
const featureFlagReportValidation = validateUsrReport('usr-feature-flag-state', featureFlagState.payload);
assert.equal(featureFlagReportValidation.ok, true, `feature-flag state payload must validate: ${featureFlagReportValidation.errors.join('; ')}`);

const featureFlagStateConflict = buildUsrFeatureFlagStateReport({
  policyPayload: runtimePolicy,
  strictMode: true,
  layers: {
    argv: {
      'usr.rollout.cutoverEnabled': true,
      'usr.rollout.shadowReadEnabled': true
    }
  },
  runId: 'run-usr-feature-flag-state-002',
  lane: 'ci'
});
assert.equal(featureFlagStateConflict.ok, false, 'feature-flag state report must fail strict-mode conflicting flags');
assert.equal(featureFlagStateConflict.payload.status, 'fail', 'feature-flag conflict report must carry fail status');
const failureInjectionMatrixPath = path.join(matrixDir, 'usr-failure-injection-matrix.json');
const failureInjectionMatrix = JSON.parse(fs.readFileSync(failureInjectionMatrixPath, 'utf8'));

const strictScenarioResults = Object.fromEntries((failureInjectionMatrix.rows || []).map((row) => [
  row.id,
  {
    outcome: row.strictExpectedOutcome,
    diagnostics: row.requiredDiagnostics,
    reasonCodes: row.requiredReasonCodes,
    recoveryEvidence: [`recovery-${row.id}`]
  }
]));

const nonStrictScenarioResults = Object.fromEntries((failureInjectionMatrix.rows || []).map((row) => [
  row.id,
  {
    outcome: row.nonStrictExpectedOutcome,
    diagnostics: row.requiredDiagnostics,
    reasonCodes: row.requiredReasonCodes,
    recoveryEvidence: [`recovery-${row.id}`]
  }
]));

const failureEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: failureInjectionMatrix,
  strictScenarioResults,
  nonStrictScenarioResults,
  strictEnum: true
});
assert.equal(failureEvaluation.ok, true, `failure-injection scenario evaluation should pass: ${failureEvaluation.errors.join('; ')}`);
assert.equal(failureEvaluation.rows.length, failureInjectionMatrix.rows.length, 'failure-injection scenario evaluator rows must match matrix row count');

const failureReport = buildUsrFailureInjectionReport({
  matrixPayload: failureInjectionMatrix,
  strictScenarioResults,
  nonStrictScenarioResults,
  strictMode: true,
  runId: 'run-usr-failure-injection-report-001',
  lane: 'ci'
});
assert.equal(failureReport.ok, true, `failure-injection report should pass: ${failureReport.errors.join('; ')}`);
const failureReportValidation = validateUsrReport('usr-failure-injection-report', failureReport.payload);
assert.equal(failureReportValidation.ok, true, `failure-injection report payload must validate: ${failureReportValidation.errors.join('; ')}`);

const strictMismatchResults = {
  ...strictScenarioResults,
  'fi-parser-timeout': {
    ...strictScenarioResults['fi-parser-timeout'],
    outcome: 'fail-closed'
  }
};
const mismatchEvaluation = evaluateUsrFailureInjectionScenarios({
  matrixPayload: failureInjectionMatrix,
  strictScenarioResults: strictMismatchResults,
  nonStrictScenarioResults,
  strictEnum: true
});
assert.equal(mismatchEvaluation.ok, false, 'failure-injection evaluator must fail on strict outcome mismatches');
assert.equal(mismatchEvaluation.errors.some((msg) => msg.includes('fi-parser-timeout')), true, 'failure-injection evaluator must include mismatching scenario ID in errors');
const fixtureGovernancePath = path.join(matrixDir, 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));

const fixtureGovernanceValidation = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: fixtureGovernance
});
assert.equal(fixtureGovernanceValidation.ok, true, `fixture-governance controls should pass: ${fixtureGovernanceValidation.errors.join('; ')}`);

const fixtureGovernanceReport = buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload: fixtureGovernance,
  runId: 'run-usr-fixture-governance-validation-001',
  lane: 'ci'
});
assert.equal(fixtureGovernanceReport.ok, true, `fixture-governance report should pass: ${fixtureGovernanceReport.errors.join('; ')}`);
const fixtureGovernanceReportValidation = validateUsrReport('usr-validation-report', fixtureGovernanceReport.payload);
assert.equal(fixtureGovernanceReportValidation.ok, true, `fixture-governance report payload must validate: ${fixtureGovernanceReportValidation.errors.join('; ')}`);

const fixtureGovernanceNegative = {
  ...fixtureGovernance,
  rows: (fixtureGovernance.rows || []).map((row, idx) => (
    idx === 0
      ? {
          ...row,
          owner: row.reviewers[0] || row.owner,
          mutationPolicy: row.blocking ? 'allow-generated-refresh' : row.mutationPolicy
        }
      : row
  ))
};
const fixtureGovernanceNegativeValidation = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: fixtureGovernanceNegative
});
assert.equal(fixtureGovernanceNegativeValidation.ok, false, 'fixture-governance controls must fail when owner/reviewer separation or mutation policy rules are violated');
const benchmarkPolicyPath = path.join(matrixDir, 'usr-benchmark-policy.json');
const benchmarkPolicy = JSON.parse(fs.readFileSync(benchmarkPolicyPath, 'utf8'));
const sloBudgetsPath = path.join(matrixDir, 'usr-slo-budgets.json');
const sloBudgets = JSON.parse(fs.readFileSync(sloBudgetsPath, 'utf8'));

const benchmarkMethodology = validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets
});
assert.equal(benchmarkMethodology.ok, true, `benchmark methodology validation should pass: ${benchmarkMethodology.errors.join('; ')}`);

const observedBenchmarkResults = Object.fromEntries((benchmarkPolicy.rows || []).map((row) => [
  row.id,
  {
    p50DurationMs: Math.max(1, row.percentileTargets.p50DurationMs - 10),
    p95DurationMs: Math.max(1, row.percentileTargets.p95DurationMs - 10),
    p99DurationMs: Math.max(1, row.percentileTargets.p99DurationMs - 10),
    variancePct: Math.max(0, row.maxVariancePct - 1),
    peakMemoryMb: Math.max(1, row.maxPeakMemoryMb - 8)
  }
]));

const benchmarkRegression = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults: observedBenchmarkResults
});
assert.equal(benchmarkRegression.ok, true, `benchmark regression evaluation should pass: ${benchmarkRegression.errors.join('; ')}`);

const benchmarkReport = buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults: observedBenchmarkResults,
  runId: 'run-usr-benchmark-regression-001',
  lane: 'ci'
});
assert.equal(benchmarkReport.ok, true, `benchmark regression report should pass: ${benchmarkReport.errors.join('; ')}`);
const benchmarkReportValidation = validateUsrReport('usr-benchmark-regression-summary', benchmarkReport.payload);
assert.equal(benchmarkReportValidation.ok, true, `benchmark regression report payload must validate: ${benchmarkReportValidation.errors.join('; ')}`);

const blockingBenchmarkId = (benchmarkPolicy.rows || []).find((row) => row.blocking)?.id;
const benchmarkRegressionNegative = evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload: benchmarkPolicy,
  sloBudgetsPayload: sloBudgets,
  observedResults: {
    ...observedBenchmarkResults,
    [blockingBenchmarkId]: {
      ...observedBenchmarkResults[blockingBenchmarkId],
      p95DurationMs: observedBenchmarkResults[blockingBenchmarkId].p95DurationMs + 50000
    }
  }
});
assert.equal(benchmarkRegressionNegative.ok, false, 'benchmark regression evaluation must fail when blocking benchmark thresholds are exceeded');
const threatModelPath = path.join(matrixDir, 'usr-threat-model-matrix.json');
const threatModel = JSON.parse(fs.readFileSync(threatModelPath, 'utf8'));
const securityGatesPath = path.join(matrixDir, 'usr-security-gates.json');
const securityGates = JSON.parse(fs.readFileSync(securityGatesPath, 'utf8'));
const alertPoliciesPath = path.join(matrixDir, 'usr-alert-policies.json');
const alertPolicies = JSON.parse(fs.readFileSync(alertPoliciesPath, 'utf8'));
const redactionRulesPath = path.join(matrixDir, 'usr-redaction-rules.json');
const redactionRules = JSON.parse(fs.readFileSync(redactionRulesPath, 'utf8'));

const threatCoverage = validateUsrThreatModelCoverage({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: fixtureGovernance,
  securityGatesPayload: securityGates,
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules
});
assert.equal(threatCoverage.ok, true, `threat-model coverage validation should pass: ${threatCoverage.errors.join('; ')}`);

const threatCoverageReport = buildUsrThreatModelCoverageReport({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: fixtureGovernance,
  securityGatesPayload: securityGates,
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules,
  runId: 'run-usr-threat-model-coverage-001',
  lane: 'ci'
});
assert.equal(threatCoverageReport.ok, true, `threat-model coverage report should pass: ${threatCoverageReport.errors.join('; ')}`);
const threatCoverageReportValidation = validateUsrReport('usr-threat-model-coverage-report', threatCoverageReport.payload);
assert.equal(threatCoverageReportValidation.ok, true, `threat-model coverage report payload must validate: ${threatCoverageReportValidation.errors.join('; ')}`);

const threatCoverageNegative = validateUsrThreatModelCoverage({
  threatModelPayload: threatModel,
  fixtureGovernancePayload: fixtureGovernance,
  securityGatesPayload: {
    ...securityGates,
    rows: (securityGates.rows || []).filter((row) => row.id !== 'security-gate-parser-lock')
  },
  alertPoliciesPayload: alertPolicies,
  redactionRulesPayload: redactionRules
});
assert.equal(threatCoverageNegative.ok, false, 'threat-model coverage validation must fail when required controls are missing');
console.log('usr matrix validator tests passed');















