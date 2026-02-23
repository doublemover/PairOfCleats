import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../schemas/usr-matrix.js';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from './usr.js';
import {
  CONFORMANCE_LEVELS,
  buildConformanceLaneByLevel
} from './conformance-lanes.js';
import { resolveUsrRuntimeConfig as resolveUsrRuntimeConfigWithValidator } from './usr-matrix/runtime-config.js';
import {
  buildUsrFeatureFlagStateReport as buildUsrFeatureFlagStateReportWithResolver,
  validateUsrFeatureFlagConflicts as validateUsrFeatureFlagConflictsCore
} from './usr-matrix/runtime-config-policy.js';
import {
  buildUsrWaiverActiveReport as buildUsrWaiverActiveReportCore,
  buildUsrWaiverExpiryReport as buildUsrWaiverExpiryReportCore,
  validateUsrWaiverPolicyControls as validateUsrWaiverPolicyControlsCore
} from './usr-matrix/waiver-policy.js';
import {
  buildUsrObservabilityRollupReport as buildUsrObservabilityRollupReportCore,
  evaluateUsrObservabilityRollup as evaluateUsrObservabilityRollupCore
} from './usr-matrix/observability-rollup.js';
import {
  buildUsrThreatModelCoverageReport as buildUsrThreatModelCoverageReportCore,
  validateUsrThreatModelCoverage as validateUsrThreatModelCoverageCore
} from './usr-matrix/threat-model.js';
import {
  buildUsrBackcompatMatrixReport as buildUsrBackcompatMatrixReportCore,
  validateUsrBackcompatMatrixCoverage as validateUsrBackcompatMatrixCoverageCore
} from './usr-matrix/backcompat.js';
import {
  buildUsrBenchmarkRegressionReport as buildUsrBenchmarkRegressionReportCore,
  evaluateUsrBenchmarkRegression as evaluateUsrBenchmarkRegressionCore,
  validateUsrBenchmarkMethodology as validateUsrBenchmarkMethodologyCore
} from './usr-matrix/benchmark-regression.js';
import {
  buildUsrFailureInjectionReport as buildUsrFailureInjectionReportCore,
  evaluateUsrFailureInjectionScenarios as evaluateUsrFailureInjectionScenariosCore
} from './usr-matrix/failure-injection.js';
import {
  buildUsrGeneratedProvenanceCoverageReport as buildUsrGeneratedProvenanceCoverageReportCore,
  validateUsrGeneratedProvenanceCoverage as validateUsrGeneratedProvenanceCoverageCore
} from './usr-matrix/generated-provenance.js';
import {
  buildUsrFixtureGovernanceValidationReport as buildUsrFixtureGovernanceValidationReportCore,
  validateUsrFixtureGovernanceControls as validateUsrFixtureGovernanceControlsCore
} from './usr-matrix/fixture-governance.js';
import {
  buildUsrSecurityGateValidationReport as buildUsrSecurityGateValidationReportCore,
  validateUsrSecurityGateControls as validateUsrSecurityGateControlsCore
} from './usr-matrix/security-gates.js';
import {
  buildUsrEmbeddingBridgeCoverageReport as buildUsrEmbeddingBridgeCoverageReportCore,
  validateUsrEmbeddingBridgeCoverage as validateUsrEmbeddingBridgeCoverageCore
} from './usr-matrix/embedding-bridge.js';
import {
  validateUsrLanguageBatchShards as validateUsrLanguageBatchShardsCore
} from './usr-matrix/language-batch-shards.js';
import {
  validateUsrMatrixDrivenHarnessCoverage as validateUsrMatrixDrivenHarnessCoverageCore
} from './usr-matrix/matrix-harness-coverage.js';
import {
  validateUsrConformanceLevelCoverage as validateUsrConformanceLevelCoverageCore
} from './usr-matrix/conformance-level-coverage.js';
import {
  validateUsrLanguageRiskProfileCoverage as validateUsrLanguageRiskProfileCoverageCore
} from './usr-matrix/language-risk-coverage.js';
import {
  buildUsrConformanceLevelSummaryReport as buildUsrConformanceLevelSummaryReportCore
} from './usr-matrix/conformance-level-summary.js';
import {
  buildConformanceCoverageMapByLevel,
  CONFORMANCE_DASHBOARD_LEVELS
} from './usr-matrix/conformance-dashboard-coverage-map.js';
import {
  buildUsrLanguageConformanceDashboardReport as buildUsrLanguageConformanceDashboardReportCore
} from './usr-matrix/language-conformance-dashboard.js';
import {
  buildUsrFrameworkConformanceDashboardReport as buildUsrFrameworkConformanceDashboardReportCore
} from './usr-matrix/framework-conformance-dashboard.js';
import {
  evaluateUsrConformancePromotionReadiness as evaluateUsrConformancePromotionReadinessCore
} from './usr-matrix/conformance-promotion-readiness.js';
import {
  buildUsrOperationalReadinessValidationReport as buildUsrOperationalReadinessValidationReportCore,
  evaluateUsrOperationalReadiness as evaluateUsrOperationalReadinessCore
} from './usr-matrix/operational-readiness.js';
import {
  buildUsrReleaseReadinessScorecard as buildUsrReleaseReadinessScorecardCore
} from './usr-matrix/release-readiness-scorecard.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

export const USR_MATRIX_VALIDATORS = Object.freeze(
  Object.fromEntries(
    Object.entries(USR_MATRIX_SCHEMA_DEFS).map(([registryId, schema]) => [registryId, compileSchema(ajv, schema)])
  )
);

export function validateUsrMatrixRegistry(registryId, payload) {
  const validator = USR_MATRIX_VALIDATORS[registryId];
  if (!validator) {
    return { ok: false, errors: [`unknown USR matrix registry: ${registryId}`] };
  }
  const ok = Boolean(validator(payload));
  return { ok, errors: ok ? [] : formatErrors(validator) };
}

export function validateUsrMatrixFile(fileName, payload) {
  const registryId = fileName.endsWith('.json')
    ? fileName.slice(0, -'.json'.length)
    : fileName;
  return validateUsrMatrixRegistry(registryId, payload);
}

export function listUsrMatrixRegistryIds() {
  return Object.freeze([...Object.keys(USR_MATRIX_ROW_SCHEMAS)].sort());
}

export function resolveUsrRuntimeConfig({
  policyPayload,
  layers = {},
  strictMode = true
} = {}) {
  return resolveUsrRuntimeConfigWithValidator({
    policyPayload,
    layers,
    strictMode,
    validateRegistry: validateUsrMatrixRegistry
  });
}


export function validateUsrFeatureFlagConflicts({
  values = {},
  strictMode = true
} = {}) {
  return validateUsrFeatureFlagConflictsCore({
    values,
    strictMode
  });
}

export function buildUsrFeatureFlagStateReport({
  policyPayload,
  layers = {},
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-runtime-config-validator',
  producerVersion = null,
  runId = 'run-usr-feature-flag-state',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  return buildUsrFeatureFlagStateReportWithResolver({
    policyPayload,
    layers,
    strictMode,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    resolveRuntimeConfig: resolveUsrRuntimeConfig
  });
}

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

export function evaluateUsrFailureInjectionScenarios({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictEnum = true
} = {}) {
  return evaluateUsrFailureInjectionScenariosCore({
    matrixPayload,
    strictScenarioResults,
    nonStrictScenarioResults,
    strictEnum,
    validateRegistry: validateUsrMatrixRegistry,
    validateDiagnosticCode: validateUsrDiagnosticCode,
    validateReasonCode: validateUsrReasonCode
  });
}

export function buildUsrFailureInjectionReport({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictMode = true,
  strictEnum = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-failure-injection-evaluator',
  producerVersion = null,
  runId = 'run-usr-failure-injection-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  return buildUsrFailureInjectionReportCore({
    matrixPayload,
    strictScenarioResults,
    nonStrictScenarioResults,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    strictMode,
    strictEnum,
    validateRegistry: validateUsrMatrixRegistry,
    validateDiagnosticCode: validateUsrDiagnosticCode,
    validateReasonCode: validateUsrReasonCode
  });
}

export function validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload
} = {}) {
  return validateUsrFixtureGovernanceControlsCore({
    fixtureGovernancePayload,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrFixtureGovernanceValidationReport({
  fixtureGovernancePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-fixture-governance-validator',
  producerVersion = null,
  runId = 'run-usr-fixture-governance-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  return buildUsrFixtureGovernanceValidationReportCore({
    fixtureGovernancePayload,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrBenchmarkMethodology(options = {}) {
  return validateUsrBenchmarkMethodologyCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function evaluateUsrBenchmarkRegression(options = {}) {
  return evaluateUsrBenchmarkRegressionCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrBenchmarkRegressionReport(options = {}) {
  return buildUsrBenchmarkRegressionReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function evaluateUsrObservabilityRollup(options = {}) {
  return evaluateUsrObservabilityRollupCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrObservabilityRollupReport(options = {}) {
  return buildUsrObservabilityRollupReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrSecurityGateControls({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {}
} = {}) {
  return validateUsrSecurityGateControlsCore({
    securityGatesPayload,
    redactionRulesPayload,
    gateResults,
    redactionResults,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrSecurityGateValidationReport({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-security-gate-validator',
  producerVersion = null,
  runId = 'run-usr-security-gate-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrSecurityGateValidationReportCore({
    securityGatesPayload,
    redactionRulesPayload,
    gateResults,
    redactionResults,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrEmbeddingBridgeCoverage({
  bridgeCasesPayload,
  bridgeBundlePayload
} = {}) {
  return validateUsrEmbeddingBridgeCoverageCore({
    bridgeCasesPayload,
    bridgeBundlePayload,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrEmbeddingBridgeCoverageReport({
  bridgeCasesPayload,
  bridgeBundlePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-embedding-bridge-coverage-builder',
  producerVersion = null,
  runId = 'run-usr-embedding-bridge-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrEmbeddingBridgeCoverageReportCore({
    bridgeCasesPayload,
    bridgeBundlePayload,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrGeneratedProvenanceCoverage({
  provenanceCasesPayload,
  provenanceBundlePayload
} = {}) {
  return validateUsrGeneratedProvenanceCoverageCore({
    provenanceCasesPayload,
    provenanceBundlePayload,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrGeneratedProvenanceCoverageReport({
  provenanceCasesPayload,
  provenanceBundlePayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-generated-provenance-coverage-builder',
  producerVersion = null,
  runId = 'run-usr-generated-provenance-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrGeneratedProvenanceCoverageReportCore({
    provenanceCasesPayload,
    provenanceBundlePayload,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrLanguageBatchShards({
  batchShardsPayload,
  languageProfilesPayload
} = {}) {
  return validateUsrLanguageBatchShardsCore({
    batchShardsPayload,
    languageProfilesPayload,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function validateUsrMatrixDrivenHarnessCoverage({
  languageProfilesPayload,
  frameworkProfilesPayload,
  fixtureGovernancePayload,
  batchShardsPayload,
  knownLanes = []
} = {}) {
  return validateUsrMatrixDrivenHarnessCoverageCore({
    languageProfilesPayload,
    frameworkProfilesPayload,
    fixtureGovernancePayload,
    batchShardsPayload,
    knownLanes,
    validateRegistry: validateUsrMatrixRegistry,
    validateLanguageBatchShards: validateUsrLanguageBatchShards,
    buildConformanceLaneByLevel
  });
}

export function validateUsrConformanceLevelCoverage({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = []
} = {}) {
  return validateUsrConformanceLevelCoverageCore({
    targetLevel,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    conformanceLevels: CONFORMANCE_LEVELS,
    validateRegistry: validateUsrMatrixRegistry,
    buildConformanceLaneByLevel
  });
}

export function validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload,
  languageRiskProfilesPayload
} = {}) {
  return validateUsrLanguageRiskProfileCoverageCore({
    languageProfilesPayload,
    languageRiskProfilesPayload,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrConformanceLevelSummaryReport({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-conformance-level-validator',
  producerVersion = null,
  runId = 'run-usr-conformance-level-summary',
  lane,
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'global' }
} = {}) {
  return buildUsrConformanceLevelSummaryReportCore({
    targetLevel,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateConformanceLevelCoverage: validateUsrConformanceLevelCoverage,
    buildConformanceLaneByLevel,
    normalizeScope: normalizeReportScope
  });
}

export function buildUsrLanguageConformanceDashboardReport({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-language-conformance-dashboard',
  producerVersion = null,
  runId = 'run-usr-language-conformance-dashboard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrLanguageConformanceDashboardReportCore({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    conformanceDashboardLevels: CONFORMANCE_DASHBOARD_LEVELS,
    validateRegistry: validateUsrMatrixRegistry,
    buildCoverageMapByLevel: buildConformanceCoverageMapByLevel,
    validateConformanceLevelCoverage: validateUsrConformanceLevelCoverage,
    normalizeScope: normalizeReportScope
  });
}

export function buildUsrFrameworkConformanceDashboardReport({
  frameworkProfilesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-framework-conformance-dashboard',
  producerVersion = null,
  runId = 'run-usr-framework-conformance-dashboard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrFrameworkConformanceDashboardReportCore({
    frameworkProfilesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    validateConformanceLevelCoverage: validateUsrConformanceLevelCoverage,
    normalizeScope: normalizeReportScope
  });
}

export function evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifacts = [],
  failingBlockingGateIds = []
} = {}) {
  return evaluateUsrConformancePromotionReadinessCore({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifacts,
    failingBlockingGateIds,
    validateConformanceLevelCoverage: validateUsrConformanceLevelCoverage
  });
}

export function evaluateUsrOperationalReadiness({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = []
} = {}) {
  return evaluateUsrOperationalReadinessCore({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds,
    validateRegistry: validateUsrMatrixRegistry,
    evaluateConformancePromotionReadiness: evaluateUsrConformancePromotionReadiness
  });
}

/**
 * Normalizes report scope values so builders always emit a valid scope envelope,
 * even when callers omit scope or pass partial scope objects.
 */
const normalizeReportScope = (scope, fallbackScopeType = 'lane', fallbackScopeId = 'ci') => (
  scope && typeof scope === 'object'
    ? {
      scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : fallbackScopeType,
      scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : fallbackScopeId
    }
    : { scopeType: fallbackScopeType, scopeId: fallbackScopeId }
);

export function buildUsrOperationalReadinessValidationReport({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-operational-readiness-validator',
  producerVersion = null,
  runId = 'run-usr-operational-readiness-validation',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrOperationalReadinessValidationReportCore({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    validateRegistry: validateUsrMatrixRegistry,
    evaluateConformancePromotionReadiness: evaluateUsrConformancePromotionReadiness,
    normalizeScope: normalizeReportScope
  });
}

export function buildUsrReleaseReadinessScorecard({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = [],
  generatedAt = new Date().toISOString(),
  producerId = 'usr-release-readiness-scorecard-builder',
  producerVersion = null,
  runId = 'run-usr-release-readiness-scorecard',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'lane', scopeId: 'ci' }
} = {}) {
  return buildUsrReleaseReadinessScorecardCore({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    scope,
    evaluateOperationalReadiness: evaluateUsrOperationalReadiness,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrBackcompatMatrixCoverage(options = {}) {
  return validateUsrBackcompatMatrixCoverageCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    validateDiagnosticCode: validateUsrDiagnosticCode
  });
}

export function buildUsrBackcompatMatrixReport(options = {}) {
  return buildUsrBackcompatMatrixReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    validateDiagnosticCode: validateUsrDiagnosticCode,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrThreatModelCoverage(options = {}) {
  return validateUsrThreatModelCoverageCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrThreatModelCoverageReport(options = {}) {
  return buildUsrThreatModelCoverageReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrWaiverPolicyControls(options = {}) {
  return validateUsrWaiverPolicyControlsCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry
  });
}

export function buildUsrWaiverActiveReport(options = {}) {
  return buildUsrWaiverActiveReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function buildUsrWaiverExpiryReport(options = {}) {
  return buildUsrWaiverExpiryReportCore({
    ...options,
    validateRegistry: validateUsrMatrixRegistry,
    normalizeScope: normalizeReportScope
  });
}

export function validateUsrRuntimeConfigResolution(options = {}) {
  const resolved = resolveUsrRuntimeConfig(options);
  return {
    ok: resolved.ok,
    errors: resolved.errors,
    warnings: resolved.warnings,
    values: resolved.values,
    appliedByKey: resolved.appliedByKey
  };
}












