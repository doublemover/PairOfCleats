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

const REQUIRED_OPERATIONAL_PHASES = Object.freeze(['pre-cutover', 'cutover', 'incident', 'post-cutover']);
const REQUIRED_BLOCKING_OPERATIONAL_PHASES = Object.freeze(['pre-cutover', 'cutover', 'incident']);
const REQUIRED_BLOCKING_QUALITY_DOMAINS = Object.freeze(['framework-binding', 'minimum-slice', 'provenance', 'resolution']);

export function evaluateUsrOperationalReadiness({
  operationalReadinessPolicyPayload,
  qualityGatesPayload,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifactSchemas = [],
  failingBlockingGateIds = []
} = {}) {
  const operationalValidation = validateUsrMatrixRegistry('usr-operational-readiness-policy', operationalReadinessPolicyPayload);
  if (!operationalValidation.ok) {
    return {
      ok: false,
      blocked: true,
      blockers: Object.freeze([]),
      errors: Object.freeze([...operationalValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      conformanceByLevel: Object.freeze({}),
      readiness: Object.freeze({
        testRolloutBlocked: true,
        deepConformanceBlocked: true,
        frameworkConformanceBlocked: true
      })
    };
  }

  const qualityValidation = validateUsrMatrixRegistry('usr-quality-gates', qualityGatesPayload);
  if (!qualityValidation.ok) {
    return {
      ok: false,
      blocked: true,
      blockers: Object.freeze([]),
      errors: Object.freeze([...qualityValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      conformanceByLevel: Object.freeze({}),
      readiness: Object.freeze({
        testRolloutBlocked: true,
        deepConformanceBlocked: true,
        frameworkConformanceBlocked: true
      })
    };
  }

  const errors = [];
  const warnings = [];
  const policyBlockers = [];
  const rows = [];

  const operationalRows = Array.isArray(operationalReadinessPolicyPayload?.rows) ? operationalReadinessPolicyPayload.rows : [];
  const qualityRows = Array.isArray(qualityGatesPayload?.rows) ? qualityGatesPayload.rows : [];

  const phasesPresent = new Set(operationalRows.map((row) => row.phase));
  for (const phase of REQUIRED_OPERATIONAL_PHASES) {
    if (!phasesPresent.has(phase)) {
      const message = `operational readiness policy missing required phase: ${phase}`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-phase`);
    }
  }

  for (const phase of REQUIRED_BLOCKING_OPERATIONAL_PHASES) {
    const phaseRows = operationalRows.filter((row) => row.phase === phase);
    if (phaseRows.length === 0) {
      const message = `operational readiness policy missing phase rows for ${phase}`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-phase-rows`);
      continue;
    }
    if (!phaseRows.some((row) => row.blocking === true)) {
      const message = `operational readiness policy phase ${phase} requires at least one blocking row`;
      errors.push(message);
      policyBlockers.push(`operational-readiness-policy:${phase}:missing-blocking-row`);
    }
  }

  const blockingQualityRows = qualityRows.filter((row) => row.blocking === true);
  if (blockingQualityRows.length === 0) {
    errors.push('quality gates policy must include blocking rows');
    policyBlockers.push('quality-gates-policy:missing-blocking-rows');
  }

  const blockingDomains = new Set(blockingQualityRows.map((row) => row.domain));
  for (const domain of REQUIRED_BLOCKING_QUALITY_DOMAINS) {
    if (!blockingDomains.has(domain)) {
      const message = `quality gates policy missing blocking domain: ${domain}`;
      errors.push(message);
      policyBlockers.push(`quality-gates-policy:${domain}:missing-blocking-domain`);
    }
  }

  const blockingQualityGateIds = new Set(blockingQualityRows.map((row) => row.id));
  const normalizedFailingGateIds = [];
  for (const gateId of asStringArray(failingBlockingGateIds)) {
    if (blockingQualityGateIds.has(gateId)) {
      normalizedFailingGateIds.push(gateId);
    } else {
      warnings.push(`failing gate id does not map to blocking quality gate: ${gateId}`);
    }
  }

  const promotionReadiness = evaluateUsrConformancePromotionReadiness({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifacts: missingArtifactSchemas,
    failingBlockingGateIds: normalizedFailingGateIds
  });

  for (const row of operationalRows) {
    rows.push({
      rowType: 'operational-phase',
      id: row.id,
      phase: row.phase,
      blocking: Boolean(row.blocking),
      pass: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([])
    });
  }

  for (const row of qualityRows) {
    rows.push({
      rowType: 'quality-gate',
      id: row.id,
      domain: row.domain,
      blocking: Boolean(row.blocking),
      pass: true,
      errors: Object.freeze([]),
      warnings: Object.freeze([])
    });
  }

  const blockers = [...new Set([...policyBlockers, ...promotionReadiness.blockers])];
  const allErrors = [...errors, ...promotionReadiness.errors];
  const allWarnings = [...warnings, ...promotionReadiness.warnings];

  return {
    ok: blockers.length === 0 && allErrors.length === 0,
    blocked: blockers.length > 0 || allErrors.length > 0,
    blockers: Object.freeze(blockers),
    errors: Object.freeze(allErrors),
    warnings: Object.freeze(allWarnings),
    rows: Object.freeze(rows),
    conformanceByLevel: promotionReadiness.conformanceByLevel,
    readiness: promotionReadiness.readiness
  };
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
  const evaluation = evaluateUsrOperationalReadiness({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds
  });

  const status = evaluation.errors.length > 0 || evaluation.blocked
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-operational-readiness-validation',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      blocked: evaluation.blocked,
      blockerCount: evaluation.blockers.length,
      errorCount: evaluation.errors.length,
      warningCount: evaluation.warnings.length,
      rowCount: rows.length,
      operationalPhaseRowCount: rows.filter((row) => row.rowType === 'operational-phase').length,
      qualityGateRowCount: rows.filter((row) => row.rowType === 'quality-gate').length,
      readiness: evaluation.readiness,
      conformanceByLevel: evaluation.conformanceByLevel
    },
    blockingFindings: [
      ...evaluation.blockers.map((message) => ({ class: 'operational-readiness', message })),
      ...evaluation.errors.map((message) => ({ class: 'operational-readiness', message }))
    ],
    advisoryFindings: evaluation.warnings.map((message) => ({ class: 'operational-readiness', message })),
    rows
  };

  return {
    ok: evaluation.ok,
    blocked: evaluation.blocked,
    blockers: evaluation.blockers,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
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
  const evaluation = evaluateUsrOperationalReadiness({
    operationalReadinessPolicyPayload,
    qualityGatesPayload,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    missingArtifactSchemas,
    failingBlockingGateIds
  });

  const conformanceRows = Object.values(evaluation.conformanceByLevel || {}).map((summary) => ({
    rowType: 'conformance-level',
    id: summary.level,
    pass: summary.pass,
    requiredProfileCount: summary.requiredProfileCount,
    failingRequiredProfileCount: summary.failingRequiredProfileCount,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount
  }));

  const readinessRows = [
    {
      rowType: 'readiness-dimension',
      id: 'test-rollout',
      pass: !evaluation.readiness.testRolloutBlocked,
      blocked: evaluation.readiness.testRolloutBlocked
    },
    {
      rowType: 'readiness-dimension',
      id: 'deep-conformance',
      pass: !evaluation.readiness.deepConformanceBlocked,
      blocked: evaluation.readiness.deepConformanceBlocked
    },
    {
      rowType: 'readiness-dimension',
      id: 'framework-conformance',
      pass: !evaluation.readiness.frameworkConformanceBlocked,
      blocked: evaluation.readiness.frameworkConformanceBlocked
    }
  ];

  const rows = [...readinessRows, ...conformanceRows];
  const status = evaluation.errors.length > 0 || evaluation.blocked
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-release-readiness-scorecard',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      blocked: evaluation.blocked,
      blockerCount: evaluation.blockers.length,
      errorCount: evaluation.errors.length,
      warningCount: evaluation.warnings.length,
      readiness: evaluation.readiness,
      conformanceByLevel: evaluation.conformanceByLevel
    },
    blockingFindings: [
      ...evaluation.blockers.map((message) => ({ class: 'release-readiness', message })),
      ...evaluation.errors.map((message) => ({ class: 'release-readiness', message }))
    ],
    advisoryFindings: evaluation.warnings.map((message) => ({ class: 'release-readiness', message })),
    rows
  };

  return {
    ok: evaluation.ok,
    blocked: evaluation.blocked,
    blockers: evaluation.blockers,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
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












