#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRunRules } from '../../../runner/run-config.js';
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
  evaluateUsrObservabilityRollup,
  buildUsrObservabilityRollupReport,
  validateUsrSecurityGateControls,
  buildUsrSecurityGateValidationReport,
  validateUsrLanguageBatchShards,
  validateUsrMatrixDrivenHarnessCoverage,
  validateUsrConformanceLevelCoverage,
  buildUsrConformanceLevelSummaryReport,
  validateUsrLanguageRiskProfileCoverage,
  evaluateUsrConformancePromotionReadiness,
  validateUsrBackcompatMatrixCoverage,
  buildUsrBackcompatMatrixReport,
  validateUsrThreatModelCoverage,
  buildUsrThreatModelCoverageReport,
  validateUsrWaiverPolicyControls,
  buildUsrWaiverActiveReport,
  buildUsrWaiverExpiryReport
} from '../../../../src/contracts/validators/usr-matrix.js';
import { resolveConformanceLaneId } from '../../../../src/contracts/validators/conformance-lanes.js';
import { validateUsrReport } from '../../../../src/contracts/validators/usr.js';
import { resolveCurrentTestLane } from '../../../helpers/lane-resolution.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const reportLane = resolveCurrentTestLane({ repoRoot, testFilePath: __filename });
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const runRules = loadRunRules({ root: repoRoot });
const knownLanes = Array.from(runRules.knownLanes || []);
const conformanceLaneId = resolveConformanceLaneId(knownLanes);
assert.equal(Boolean(conformanceLaneId), true, 'conformance lane must be discoverable from run rules');
const knownConformanceLanes = [conformanceLaneId];

const requiredRegistries = [
  'usr-runtime-config-policy',
  'usr-failure-injection-matrix',
  'usr-fixture-governance',
  'usr-language-profiles',
  'usr-language-version-policy',
  'usr-language-embedding-policy',
  'usr-language-risk-profiles',
  'usr-node-kind-mapping',
  'usr-edge-kind-constraints',
  'usr-parser-runtime-lock',
  'usr-language-batch-shards',
  'usr-framework-profiles',
  'usr-framework-edge-cases',
  'usr-embedding-bridge-cases',
  'usr-generated-provenance-cases',
  'usr-conformance-levels',
  'usr-capability-matrix',
  'usr-backcompat-matrix',
  'usr-ownership-matrix',
  'usr-escalation-policy',
  'usr-benchmark-policy',
  'usr-slo-budgets',
  'usr-security-gates',
  'usr-alert-policies',
  'usr-redaction-rules',
  'usr-quality-gates',
  'usr-operational-readiness-policy',
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

const matrixRegistryIdsOnDisk = fs.readdirSync(matrixDir)
  .filter((fileName) => fileName.endsWith('.json'))
  .map((fileName) => fileName.slice(0, -'.json'.length))
  .sort();
assert.deepEqual([...registryIds].sort(), matrixRegistryIdsOnDisk, 'USR matrix validator registry IDs must exactly match tests/lang/matrix JSON registry files');

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
  lane: reportLane
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
    recoveryEvidence: Array.from(new Set([...(row.requiredRecoveryArtifacts || []), `recovery-${row.id}`]))
  }
]));

const nonStrictScenarioResults = Object.fromEntries((failureInjectionMatrix.rows || []).map((row) => [
  row.id,
  {
    outcome: row.nonStrictExpectedOutcome,
    diagnostics: row.requiredDiagnostics,
    reasonCodes: row.requiredReasonCodes,
    recoveryEvidence: Array.from(new Set([...(row.requiredRecoveryArtifacts || []), `recovery-${row.id}`]))
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
  lane: reportLane
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

const artifactMissingScenarioId = (failureInjectionMatrix.rows || [])[0]?.id;
const artifactMissingResult = evaluateUsrFailureInjectionScenarios({
  matrixPayload: failureInjectionMatrix,
  strictScenarioResults: {
    ...strictScenarioResults,
    [artifactMissingScenarioId]: {
      ...strictScenarioResults[artifactMissingScenarioId],
      recoveryEvidence: ['not-required.json']
    }
  },
  nonStrictScenarioResults: {
    ...nonStrictScenarioResults,
    [artifactMissingScenarioId]: {
      ...nonStrictScenarioResults[artifactMissingScenarioId],
      recoveryEvidence: ['not-required.json']
    }
  },
  strictEnum: true
});
assert.equal(artifactMissingResult.ok, false, 'failure-injection evaluator must fail when required recovery artifacts are not present in observed evidence');
assert.equal(artifactMissingResult.errors.some((msg) => msg.includes('missing required artifact')), true, 'failure-injection evaluator must report missing required recovery artifacts');
const fixtureGovernancePath = path.join(matrixDir, 'usr-fixture-governance.json');
const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));

const fixtureGovernanceValidation = validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload: fixtureGovernance
});
assert.equal(fixtureGovernanceValidation.ok, true, `fixture-governance controls should pass: ${fixtureGovernanceValidation.errors.join('; ')}`);

const fixtureGovernanceReport = buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload: fixtureGovernance,
  runId: 'run-usr-fixture-governance-validation-001',
  lane: reportLane
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
  lane: reportLane
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

const observabilityAlertPoliciesPath = path.join(matrixDir, 'usr-alert-policies.json');
const observabilityAlertPolicies = JSON.parse(fs.readFileSync(observabilityAlertPoliciesPath, 'utf8'));
const observedLaneMetrics = Object.fromEntries((sloBudgets.rows || []).map((row) => [
  row.laneId,
  {
    durationMs: Math.max(1, Math.min(row.maxDurationMs - 1, 1190000)),
    peakMemoryMb: Math.max(1, Math.min(row.maxMemoryMb - 1, 4000)),
    parserTimePerSegmentMs: Math.max(1, row.maxParserTimePerSegmentMs - 1),
    unknownKindRate: Math.max(0, Math.min(0.01, row.maxUnknownKindRate / 2)),
    unresolvedRate: Math.max(0, Math.min(0.01, row.maxUnresolvedRate / 2)),
    capabilityDowngradeRate: 0,
    criticalDiagnosticCount: 0,
    redactionFailureCount: 0
  }
]));

const observabilityRollup = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: observabilityAlertPolicies,
  observedLaneMetrics
});
assert.equal(observabilityRollup.ok, true, `observability rollup should pass: ${observabilityRollup.errors.join('; ')}`);

const observabilityReport = buildUsrObservabilityRollupReport({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: observabilityAlertPolicies,
  observedLaneMetrics,
  runId: 'run-usr-observability-rollup-001',
  lane: reportLane
});
assert.equal(observabilityReport.ok, true, `observability rollup report should pass: ${observabilityReport.errors.join('; ')}`);
const observabilityReportValidation = validateUsrReport('usr-observability-rollup', observabilityReport.payload);
assert.equal(observabilityReportValidation.ok, true, `observability rollup report payload must validate: ${observabilityReportValidation.errors.join('; ')}`);

const observabilityNegative = evaluateUsrObservabilityRollup({
  sloBudgetsPayload: sloBudgets,
  alertPoliciesPayload: observabilityAlertPolicies,
  observedLaneMetrics: {
    ...observedLaneMetrics,
    [sloBudgets.rows[0].laneId]: {
      ...observedLaneMetrics[sloBudgets.rows[0].laneId],
      unknownKindRate: sloBudgets.rows[0].maxUnknownKindRate + 0.01,
      redactionFailureCount: 1
    }
  }
});
assert.equal(observabilityNegative.ok, false, 'observability rollup must fail on blocking SLO/alert threshold breaches');

const languageProfilesPath = path.join(matrixDir, 'usr-language-profiles.json');
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));
const batchShardsPath = path.join(matrixDir, 'usr-language-batch-shards.json');
const batchShards = JSON.parse(fs.readFileSync(batchShardsPath, 'utf8'));

const batchShardsValidation = validateUsrLanguageBatchShards({
  batchShardsPayload: batchShards,
  languageProfilesPayload: languageProfiles
});
assert.equal(batchShardsValidation.ok, true, `language batch shard validation should pass: ${batchShardsValidation.errors.join('; ')}`);

const batchShardsNegative = validateUsrLanguageBatchShards({
  batchShardsPayload: {
    ...batchShards,
    rows: (batchShards.rows || []).map((row) => (
      row.id === 'B1'
        ? { ...row, languageIds: [...row.languageIds].reverse() }
        : row
    ))
  },
  languageProfilesPayload: languageProfiles
});
assert.equal(batchShardsNegative.ok, false, 'language batch shard validation must fail when languageIds are not deterministic');

const frameworkProfilesPath = path.join(matrixDir, 'usr-framework-profiles.json');
const frameworkProfiles = JSON.parse(fs.readFileSync(frameworkProfilesPath, 'utf8'));
const matrixDrivenCoverage = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload: languageProfiles,
  frameworkProfilesPayload: frameworkProfiles,
  fixtureGovernancePayload: fixtureGovernance,
  batchShardsPayload: batchShards,
  knownLanes: knownConformanceLanes
});
assert.equal(matrixDrivenCoverage.ok, true, `matrix-driven harness coverage should pass: ${matrixDrivenCoverage.errors.join('; ')}`);

const matrixDrivenNegative = validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload: {
    ...languageProfiles,
    rows: (languageProfiles.rows || []).map((row) => (
      row.id === 'javascript'
        ? { ...row, requiredConformance: (row.requiredConformance || []).filter((level) => level !== 'C4') }
        : row
    ))
  },
  frameworkProfilesPayload: frameworkProfiles,
  fixtureGovernancePayload: fixtureGovernance,
  batchShardsPayload: batchShards,
  knownLanes: knownConformanceLanes
});
assert.equal(matrixDrivenNegative.ok, true, 'matrix-driven coverage with dropped C4 should remain non-blocking and emit warning');
assert.equal(matrixDrivenNegative.warnings.some((message) => message.includes('javascript')), true, 'matrix-driven warning should surface profile coverage downgrade');

const languageRiskProfilesPath = path.join(matrixDir, 'usr-language-risk-profiles.json');
const languageRiskProfiles = JSON.parse(fs.readFileSync(languageRiskProfilesPath, 'utf8'));

const languageRiskCoverage = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload: languageProfiles,
  languageRiskProfilesPayload: languageRiskProfiles
});
assert.equal(languageRiskCoverage.ok, true, `language risk profile coverage should pass: ${languageRiskCoverage.errors.join('; ')}`);

const languageRiskCoverageNegative = validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload: languageProfiles,
  languageRiskProfilesPayload: {
    ...languageRiskProfiles,
    rows: (languageRiskProfiles.rows || []).map((row, index) => (
      index === 0
        ? {
          ...row,
          optional: {
            ...row.optional,
            sinks: [...(row.optional?.sinks || []), (row.required?.sinks || [])[0]].filter(Boolean)
          }
        }
        : row
    ))
  }
});
assert.equal(languageRiskCoverageNegative.ok, false, 'language risk profile coverage must fail on overlapping risk taxonomies');

const conformanceLevelsPath = path.join(matrixDir, 'usr-conformance-levels.json');
const conformanceLevels = JSON.parse(fs.readFileSync(conformanceLevelsPath, 'utf8'));

const c0Coverage = validateUsrConformanceLevelCoverage({
  targetLevel: 'C0',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(c0Coverage.ok, true, `C0 conformance coverage should pass: ${c0Coverage.errors.join('; ')}`);

const c1Coverage = validateUsrConformanceLevelCoverage({
  targetLevel: 'C1',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(c1Coverage.ok, true, `C1 conformance coverage should pass: ${c1Coverage.errors.join('; ')}`);

const c2Coverage = validateUsrConformanceLevelCoverage({
  targetLevel: 'C2',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(c2Coverage.ok, true, `C2 conformance coverage should pass: ${c2Coverage.errors.join('; ')}`);

const c3Coverage = validateUsrConformanceLevelCoverage({
  targetLevel: 'C3',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(c3Coverage.ok, true, `C3 conformance coverage should pass: ${c3Coverage.errors.join('; ')}`);

const c4Coverage = validateUsrConformanceLevelCoverage({
  targetLevel: 'C4',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(c4Coverage.ok, true, `C4 conformance coverage should pass: ${c4Coverage.errors.join('; ')}`);

const promotionReadiness = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes
});
assert.equal(promotionReadiness.ok, true, `promotion readiness should pass: ${promotionReadiness.blockers.join('; ')}`);
assert.equal(promotionReadiness.readiness.testRolloutBlocked, false, 'promotion readiness should not block test rollout for baseline data');
assert.equal(promotionReadiness.readiness.deepConformanceBlocked, false, 'promotion readiness should not block deep conformance for baseline data');
assert.equal(promotionReadiness.readiness.frameworkConformanceBlocked, false, 'promotion readiness should not block framework conformance for baseline data');

const missingC4PromotionReadiness = evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: ['ci']
});
assert.equal(missingC4PromotionReadiness.ok, false, 'promotion readiness should fail when conformance lane coverage is missing');
assert.equal(missingC4PromotionReadiness.readiness.frameworkConformanceBlocked, true, 'missing conformance lane should block framework readiness');

const c0Report = buildUsrConformanceLevelSummaryReport({
  targetLevel: 'C0',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: knownConformanceLanes,
  lane: conformanceLaneId,
  runId: 'run-usr-conformance-baseline-001'
});
assert.equal(c0Report.ok, true, `C0 conformance report should pass: ${c0Report.errors.join('; ')}`);
const c0ReportValidation = validateUsrReport('usr-conformance-summary', c0Report.payload);
assert.equal(c0ReportValidation.ok, true, `C0 conformance summary report must validate: ${c0ReportValidation.errors.join('; ')}`);

const missingC0Lane = validateUsrConformanceLevelCoverage({
  targetLevel: 'C0',
  languageProfilesPayload: languageProfiles,
  conformanceLevelsPayload: conformanceLevels,
  knownLanes: ['ci']
});
assert.equal(missingC0Lane.ok, false, 'C0 conformance coverage should fail when conformance lane is missing');

const backcompatMatrixPath = path.join(matrixDir, 'usr-backcompat-matrix.json');
const backcompatMatrix = JSON.parse(fs.readFileSync(backcompatMatrixPath, 'utf8'));

const backcompatValidation = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: backcompatMatrix,
  strictEnum: true
});
assert.equal(backcompatValidation.ok, true, `backcompat matrix coverage should pass: ${backcompatValidation.errors.join('; ')}`);

const backcompatReport = buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload: backcompatMatrix,
  strictEnum: true,
  runId: 'run-usr-backcompat-matrix-results-001',
  lane: reportLane
});
assert.equal(backcompatReport.ok, true, `backcompat matrix report should pass: ${backcompatReport.errors.join('; ')}`);
const backcompatReportValidation = validateUsrReport('usr-backcompat-matrix-results', backcompatReport.payload);
assert.equal(backcompatReportValidation.ok, true, `backcompat matrix report payload must validate: ${backcompatReportValidation.errors.join('; ')}`);

const backcompatNegative = validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload: {
    ...backcompatMatrix,
    rows: (backcompatMatrix.rows || []).filter((row) => row.id !== 'BC-012')
  },
  strictEnum: true
});
assert.equal(backcompatNegative.ok, false, 'backcompat matrix coverage must fail when required BC scenarios are missing');

const threatModelPath = path.join(matrixDir, 'usr-threat-model-matrix.json');
const threatModel = JSON.parse(fs.readFileSync(threatModelPath, 'utf8'));
const securityGatesPath = path.join(matrixDir, 'usr-security-gates.json');
const securityGates = JSON.parse(fs.readFileSync(securityGatesPath, 'utf8'));
const alertPoliciesPath = path.join(matrixDir, 'usr-alert-policies.json');
const alertPolicies = JSON.parse(fs.readFileSync(alertPoliciesPath, 'utf8'));
const redactionRulesPath = path.join(matrixDir, 'usr-redaction-rules.json');
const redactionRules = JSON.parse(fs.readFileSync(redactionRulesPath, 'utf8'));

const securityGateResults = Object.fromEntries((securityGates.rows || []).map((row) => [
  row.check,
  { pass: true }
]));
const redactionRuleResults = Object.fromEntries((redactionRules.rows || []).map((row) => [
  row.class,
  { pass: true, misses: 0 }
]));

const securityGateValidation = validateUsrSecurityGateControls({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults: securityGateResults,
  redactionResults: redactionRuleResults
});
assert.equal(securityGateValidation.ok, true, `security-gate control validation should pass: ${securityGateValidation.errors.join('; ')}`);

const securityGateReport = buildUsrSecurityGateValidationReport({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults: securityGateResults,
  redactionResults: redactionRuleResults,
  runId: 'run-usr-security-gate-validation-001',
  lane: reportLane
});
assert.equal(securityGateReport.ok, true, `security-gate validation report should pass: ${securityGateReport.errors.join('; ')}`);
const securityGateReportValidation = validateUsrReport('usr-validation-report', securityGateReport.payload);
assert.equal(securityGateReportValidation.ok, true, `security-gate validation report payload must validate: ${securityGateReportValidation.errors.join('; ')}`);

const securityGateNegative = validateUsrSecurityGateControls({
  securityGatesPayload: securityGates,
  redactionRulesPayload: redactionRules,
  gateResults: {
    ...securityGateResults,
    runtime_exec_disallowed: { pass: false }
  },
  redactionResults: {
    ...redactionRuleResults,
    'private-key-material': { pass: false, misses: 1 }
  }
});
assert.equal(securityGateNegative.ok, false, 'security-gate control validation must fail on blocking gate or redaction failures');

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
  lane: reportLane
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

const waiverPolicyPath = path.join(matrixDir, 'usr-waiver-policy.json');
const waiverPolicy = JSON.parse(fs.readFileSync(waiverPolicyPath, 'utf8'));
const ownershipMatrixPath = path.join(matrixDir, 'usr-ownership-matrix.json');
const ownershipMatrix = JSON.parse(fs.readFileSync(ownershipMatrixPath, 'utf8'));
const escalationPolicyPath = path.join(matrixDir, 'usr-escalation-policy.json');
const escalationPolicy = JSON.parse(fs.readFileSync(escalationPolicyPath, 'utf8'));

const waiverValidation = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(waiverValidation.ok, true, `waiver-policy controls should pass: ${waiverValidation.errors.join('; ')}`);

const waiverActiveReport = buildUsrWaiverActiveReport({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true,
  runId: 'run-usr-waiver-active-report-001',
  lane: reportLane
});
assert.equal(waiverActiveReport.ok, true, `waiver active report should pass: ${waiverActiveReport.errors.join('; ')}`);
assert.deepEqual(waiverActiveReport.rows, waiverActiveReport.payload.rows, 'waiver active report API rows must match payload rows');
const waiverActiveReportValidation = validateUsrReport('usr-waiver-active-report', waiverActiveReport.payload);
assert.equal(waiverActiveReportValidation.ok, true, `waiver active report payload must validate: ${waiverActiveReportValidation.errors.join('; ')}`);

const waiverActiveWithExpiredRow = buildUsrWaiverActiveReport({
  waiverPolicyPayload: {
    ...waiverPolicy,
    rows: (waiverPolicy.rows || []).map((row) => (
      row.id === 'waiver-observability-gap-temp'
        ? { ...row, allowedUntil: '2026-01-01T00:00:00Z' }
        : row
    ))
  },
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: false,
  runId: 'run-usr-waiver-active-report-002',
  lane: reportLane
});
assert.equal(waiverActiveWithExpiredRow.rows.some((row) => row.id === 'waiver-observability-gap-temp'), false, 'waiver active report rows must exclude expired waivers');
assert.deepEqual(waiverActiveWithExpiredRow.rows, waiverActiveWithExpiredRow.payload.rows, 'waiver active report return rows must remain aligned with payload rows after expiry filtering');

const waiverExpiryReport = buildUsrWaiverExpiryReport({
  waiverPolicyPayload: waiverPolicy,
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true,
  runId: 'run-usr-waiver-expiry-report-001',
  lane: reportLane
});
assert.equal(waiverExpiryReport.ok, true, `waiver expiry report should pass: ${waiverExpiryReport.errors.join('; ')}`);
const waiverExpiryReportValidation = validateUsrReport('usr-waiver-expiry-report', waiverExpiryReport.payload);
assert.equal(waiverExpiryReportValidation.ok, true, `waiver expiry report payload must validate: ${waiverExpiryReportValidation.errors.join('; ')}`);

const waiverExpiredNegative = validateUsrWaiverPolicyControls({
  waiverPolicyPayload: {
    ...waiverPolicy,
    rows: (waiverPolicy.rows || []).map((row, idx) => (
      idx === 0
        ? { ...row, allowedUntil: '2026-01-01T00:00:00Z' }
        : row
    ))
  },
  ownershipMatrixPayload: ownershipMatrix,
  escalationPolicyPayload: escalationPolicy,
  evaluationTime: '2026-02-12T00:00:00Z',
  strictMode: true
});
assert.equal(waiverExpiredNegative.ok, false, 'waiver-policy controls must fail when blocking waivers are expired');
assert.equal(waiverExpiredNegative.errors.some((msg) => msg.includes('waiver-benchmark-overrun-ci-long')), true, 'waiver-policy expiration errors must include affected waiver row id');

console.log('usr matrix validator tests passed');















