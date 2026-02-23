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

const sortedStrings = (value) => [...asStringArray(value)].sort((left, right) => left.localeCompare(right));

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
  const languageValidation = validateUsrMatrixRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...languageValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const frameworkValidation = validateUsrMatrixRegistry('usr-framework-profiles', frameworkProfilesPayload);
  if (!frameworkValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...frameworkValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const fixtureValidation = validateUsrMatrixRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!fixtureValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...fixtureValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const batchValidation = validateUsrLanguageBatchShards({
    batchShardsPayload,
    languageProfilesPayload
  });
  if (!batchValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...batchValidation.errors]),
      warnings: Object.freeze([...batchValidation.warnings]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const frameworkRows = Array.isArray(frameworkProfilesPayload?.rows) ? frameworkProfilesPayload.rows : [];
  const fixtureRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const batchRows = Array.isArray(batchShardsPayload?.rows) ? batchShardsPayload.rows : [];

  const knownLaneSet = new Set(asStringArray(knownLanes));
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const languageById = new Map(languageRows.map((row) => [row.id, row]));
  const languageFixtureIds = new Set(
    fixtureRows
      .filter((row) => row.profileType === 'language')
      .map((row) => row.profileId)
  );
  const frameworkFixtureIds = new Set(
    fixtureRows
      .filter((row) => row.profileType === 'framework')
      .map((row) => row.profileId)
  );

  const batchByLanguageId = new Map();
  for (const batchRow of batchRows) {
    if (batchRow.scopeType !== 'language-batch') {
      continue;
    }
    for (const languageId of asStringArray(batchRow.languageIds)) {
      batchByLanguageId.set(languageId, batchRow.id);
    }
  }

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if (!batchByLanguageId.has(languageRow.id)) {
      rowErrors.push('language profile is missing language-batch shard assignment');
    }

    if (!languageFixtureIds.has(languageRow.id)) {
      rowWarnings.push('language profile is missing fixture-governance coverage');
    }

    const requiredConformance = asStringArray(languageRow.requiredConformance);
    if (requiredConformance.length === 0) {
      rowErrors.push('language profile requiredConformance must not be empty');
    }

    for (const conformanceLevel of requiredConformance) {
      const expectedLane = conformanceLaneByLevel[conformanceLevel];
      if (!expectedLane) {
        rowErrors.push(`unsupported requiredConformance level: ${conformanceLevel}`);
        continue;
      }
      if (knownLaneSet.size > 0 && !knownLaneSet.has(expectedLane)) {
        rowErrors.push(`missing lane for requiredConformance ${conformanceLevel}: ${expectedLane}`);
      }
    }

    if (asStringArray(languageRow.frameworkProfiles).length > 0 && !requiredConformance.includes('C4')) {
      rowWarnings.push('language profile with framework overlays should include C4 conformance requirement');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    rows.push({
      profileType: 'language',
      profileId: languageRow.id,
      batchId: batchByLanguageId.get(languageRow.id) || null,
      hasFixtureCoverage: languageFixtureIds.has(languageRow.id),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const frameworkRow of frameworkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const appliesToLanguages = asStringArray(frameworkRow.appliesToLanguages);
    if (appliesToLanguages.length === 0) {
      rowErrors.push('framework profile appliesToLanguages must not be empty');
    }

    if (!frameworkFixtureIds.has(frameworkRow.id)) {
      rowWarnings.push('framework profile is missing fixture-governance coverage');
    }

    for (const languageId of appliesToLanguages) {
      const languageRow = languageById.get(languageId);
      if (!languageRow) {
        rowErrors.push(`framework appliesToLanguages references unknown language: ${languageId}`);
        continue;
      }
      const languageFrameworks = asStringArray(languageRow.frameworkProfiles);
      if (!languageFrameworks.includes(frameworkRow.id)) {
        rowErrors.push(`framework mapping missing inverse language profile linkage: ${languageId}`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${frameworkRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${frameworkRow.id} ${message}`));
    }

    rows.push({
      profileType: 'framework',
      profileId: frameworkRow.id,
      batchId: null,
      hasFixtureCoverage: frameworkFixtureIds.has(frameworkRow.id),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function validateUsrConformanceLevelCoverage({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = []
} = {}) {
  const level = typeof targetLevel === 'string' ? targetLevel : '';
  if (!CONFORMANCE_LEVELS.includes(level)) {
    return {
      ok: false,
      errors: Object.freeze([`unsupported target conformance level: ${targetLevel}`]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const languageValidation = validateUsrMatrixRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...languageValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const conformanceValidation = validateUsrMatrixRegistry('usr-conformance-levels', conformanceLevelsPayload);
  if (!conformanceValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...conformanceValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const knownLaneSet = new Set(asStringArray(knownLanes));
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const expectedLane = conformanceLaneByLevel[level];
  if (knownLaneSet.size > 0 && !knownLaneSet.has(expectedLane)) {
    errors.push(`missing lane for conformance level ${level}: ${expectedLane}`);
  }

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const conformanceRows = Array.isArray(conformanceLevelsPayload?.rows) ? conformanceLevelsPayload.rows : [];

  const languageConformanceRows = conformanceRows.filter((row) => row.profileType === 'language');
  const conformanceByLanguageId = new Map(languageConformanceRows.map((row) => [row.profileId, row]));

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const requiresLevel = asStringArray(languageRow.requiredConformance).includes(level);
    const conformanceRow = conformanceByLanguageId.get(languageRow.id);
    if (!conformanceRow) {
      rowErrors.push('missing conformance-levels row for language profile');
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
      rows.push({
        profileId: languageRow.id,
        targetLevel: level,
        requiresLevel,
        hasConformanceRow: false,
        pass: false,
        errors: Object.freeze([...rowErrors]),
        warnings: Object.freeze([...rowWarnings])
      });
      continue;
    }

    const requiredLevels = asStringArray(conformanceRow.requiredLevels);
    const blockingLevels = asStringArray(conformanceRow.blockingLevels);
    const requiredFixtureFamilies = asStringArray(conformanceRow.requiredFixtureFamilies);

    if (requiresLevel && !requiredLevels.includes(level)) {
      rowErrors.push(`requiredLevels missing target level ${level}`);
    }

    if (requiresLevel && !blockingLevels.includes(level)) {
      rowErrors.push(`blockingLevels missing target level ${level}`);
    }

    if (requiresLevel && requiredFixtureFamilies.length === 0) {
      rowErrors.push('requiredFixtureFamilies must not be empty for required level');
    }

    if (requiresLevel && !requiredFixtureFamilies.includes('golden')) {
      rowWarnings.push('requiredFixtureFamilies should include golden for deterministic conformance evidence');
    }

    if (requiresLevel && level === 'C1' && !requiredFixtureFamilies.includes('resolution')) {
      rowWarnings.push('requiredFixtureFamilies should include resolution for C1 baseline evidence');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }

    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    rows.push({
      profileId: languageRow.id,
      targetLevel: level,
      requiresLevel,
      hasConformanceRow: true,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

const findRiskOverlap = (left, right) => {
  const rightSet = new Set(asStringArray(right));
  return asStringArray(left).filter((item) => rightSet.has(item));
};

export function validateUsrLanguageRiskProfileCoverage({
  languageProfilesPayload,
  languageRiskProfilesPayload
} = {}) {
  const languageValidation = validateUsrMatrixRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...languageValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const riskValidation = validateUsrMatrixRegistry('usr-language-risk-profiles', languageRiskProfilesPayload);
  if (!riskValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...riskValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const riskRows = Array.isArray(languageRiskProfilesPayload?.rows) ? languageRiskProfilesPayload.rows : [];

  const languageIdSet = new Set(languageRows.map((row) => row.id));
  const riskRowCounts = new Map();
  const baseRowByLanguageId = new Map();

  for (const row of riskRows) {
    const frameworkProfile = typeof row.frameworkProfile === 'string' ? row.frameworkProfile : null;
    const key = `${row.languageId}::${frameworkProfile ?? 'base'}`;
    riskRowCounts.set(key, (riskRowCounts.get(key) || 0) + 1);

    if (frameworkProfile == null && !baseRowByLanguageId.has(row.languageId)) {
      baseRowByLanguageId.set(row.languageId, row);
    }
  }

  for (const languageId of languageIdSet) {
    if (!baseRowByLanguageId.has(languageId)) {
      errors.push(`${languageId} missing base risk profile row (frameworkProfile=null)`);
    }
  }

  for (const row of riskRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const frameworkProfile = typeof row.frameworkProfile === 'string' ? row.frameworkProfile : null;
    const rowKey = `${row.languageId}::${frameworkProfile ?? 'base'}`;
    if ((riskRowCounts.get(rowKey) || 0) > 1) {
      rowErrors.push('duplicate risk profile row for language/framework pair');
    }

    if (!languageIdSet.has(row.languageId)) {
      rowErrors.push('risk profile references unknown languageId');
    }

    const requiredSources = asStringArray(row?.required?.sources);
    const requiredSinks = asStringArray(row?.required?.sinks);
    const requiredSanitizers = asStringArray(row?.required?.sanitizers);
    const optionalSources = asStringArray(row?.optional?.sources);
    const optionalSinks = asStringArray(row?.optional?.sinks);
    const optionalSanitizers = asStringArray(row?.optional?.sanitizers);
    const unsupportedSources = asStringArray(row?.unsupported?.sources);
    const unsupportedSinks = asStringArray(row?.unsupported?.sinks);
    const unsupportedSanitizers = asStringArray(row?.unsupported?.sanitizers);

    const capabilities = row.capabilities || {};
    const riskLocal = typeof capabilities.riskLocal === 'string' ? capabilities.riskLocal : 'unsupported';
    const riskInterprocedural = typeof capabilities.riskInterprocedural === 'string' ? capabilities.riskInterprocedural : 'unsupported';

    const overlapRequiredOptional = [
      ...findRiskOverlap(requiredSources, optionalSources),
      ...findRiskOverlap(requiredSinks, optionalSinks),
      ...findRiskOverlap(requiredSanitizers, optionalSanitizers)
    ];
    if (overlapRequiredOptional.length > 0) {
      rowErrors.push(`required and optional taxonomy entries overlap: ${[...new Set(overlapRequiredOptional)].join(', ')}`);
    }

    const overlapUnsupported = [
      ...findRiskOverlap(requiredSources, unsupportedSources),
      ...findRiskOverlap(optionalSources, unsupportedSources),
      ...findRiskOverlap(requiredSinks, unsupportedSinks),
      ...findRiskOverlap(optionalSinks, unsupportedSinks),
      ...findRiskOverlap(requiredSanitizers, unsupportedSanitizers),
      ...findRiskOverlap(optionalSanitizers, unsupportedSanitizers)
    ];
    if (overlapUnsupported.length > 0) {
      rowErrors.push(`supported and unsupported taxonomy entries overlap: ${[...new Set(overlapUnsupported)].join(', ')}`);
    }

    const interproceduralGating = row.interproceduralGating || {};
    const minEvidenceKinds = asStringArray(interproceduralGating.minEvidenceKinds);
    const enabledByDefault = interproceduralGating.enabledByDefault === true;

    if (riskInterprocedural === 'unsupported' && enabledByDefault) {
      rowErrors.push('interproceduralGating.enabledByDefault must be false when riskInterprocedural=unsupported');
    }

    if (riskInterprocedural !== 'unsupported' && minEvidenceKinds.length === 0) {
      rowErrors.push('interprocedural profiles require non-empty interproceduralGating.minEvidenceKinds');
    }

    if (riskLocal === 'supported' && (requiredSources.length === 0 || requiredSinks.length === 0)) {
      rowErrors.push('riskLocal=supported requires non-empty required.sources and required.sinks');
    }

    if (riskLocal === 'partial' && requiredSanitizers.length === 0) {
      rowWarnings.push('riskLocal=partial should include at least one required sanitizer class');
    }

    const severityLevels = asStringArray(row?.severityPolicy?.levels);
    const defaultSeverity = row?.severityPolicy?.defaultLevel;
    if (typeof defaultSeverity !== 'string' || !severityLevels.includes(defaultSeverity)) {
      rowErrors.push('severityPolicy.defaultLevel must be present in severityPolicy.levels');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.languageId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.languageId} ${message}`));
    }

    rows.push({
      languageId: row.languageId,
      frameworkProfile,
      riskLocal,
      riskInterprocedural,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
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
  const level = typeof targetLevel === 'string' ? targetLevel : '';
  const conformanceLaneByLevel = buildConformanceLaneByLevel(knownLanes);
  const defaultLane = conformanceLaneByLevel[level] || 'ci';
  const evaluation = validateUsrConformanceLevelCoverage({
    targetLevel: level,
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes
  });

  const rows = evaluation.rows.map((row) => ({
    profileId: row.profileId,
    targetLevel: row.targetLevel,
    requiresLevel: row.requiresLevel,
    hasConformanceRow: row.hasConformanceRow,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
        scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'lane',
        scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : defaultLane
      }
      : { scopeType: 'lane', scopeId: defaultLane }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-conformance-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane: typeof lane === 'string' && lane.trim() ? lane : defaultLane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      targetLevel: level,
      profileCount: rows.length,
      requiredProfileCount: rows.filter((row) => row.requiresLevel).length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'conformance',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'conformance',
      message
    })),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows,
    payload
  };
}

const CONFORMANCE_DASHBOARD_LEVELS = Object.freeze(['C0', 'C1', 'C2', 'C3', 'C4']);

const buildConformanceCoverageMapByLevel = ({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  levels = CONFORMANCE_DASHBOARD_LEVELS
} = {}) => {
  const coverageByLevel = new Map();
  const errors = [];
  const warnings = [];

  for (const level of levels) {
    const evaluation = validateUsrConformanceLevelCoverage({
      targetLevel: level,
      languageProfilesPayload,
      conformanceLevelsPayload,
      knownLanes
    });

    coverageByLevel.set(level, {
      evaluation,
      rowsByProfileId: new Map((evaluation.rows || []).map((row) => [row.profileId, row]))
    });

    if (evaluation.errors.length > 0) {
      errors.push(...evaluation.errors.map((message) => `${level} ${message}`));
    }
    if (evaluation.warnings.length > 0) {
      warnings.push(...evaluation.warnings.map((message) => `${level} ${message}`));
    }
  }

  return {
    coverageByLevel,
    errors,
    warnings
  };
};

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
  const languageValidation = validateUsrMatrixRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...languageValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }

  const conformanceValidation = validateUsrMatrixRegistry('usr-conformance-levels', conformanceLevelsPayload);
  if (!conformanceValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...conformanceValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }

  const { coverageByLevel, errors, warnings } = buildConformanceCoverageMapByLevel({
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes,
    levels: CONFORMANCE_DASHBOARD_LEVELS
  });

  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const rows = [];

  for (const languageRow of languageRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const requiredLevels = asStringArray(languageRow.requiredConformance);
    const levelStatus = {};

    for (const level of CONFORMANCE_DASHBOARD_LEVELS) {
      const coverage = coverageByLevel.get(level);
      const coverageRow = coverage?.rowsByProfileId?.get(languageRow.id) || null;
      if (!coverageRow) {
        rowErrors.push(`missing conformance coverage row for level ${level}`);
        levelStatus[level] = {
          requiresLevel: requiredLevels.includes(level),
          pass: false,
          hasCoverageRow: false
        };
        continue;
      }

      levelStatus[level] = {
        requiresLevel: coverageRow.requiresLevel,
        pass: coverageRow.pass,
        hasCoverageRow: true
      };

      if (requiredLevels.includes(level) && !coverageRow.pass) {
        rowErrors.push(`required level ${level} is failing`);
      }

      if (coverageRow.warnings.length > 0) {
        rowWarnings.push(...coverageRow.warnings.map((message) => `${level} ${message}`));
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${languageRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${languageRow.id} ${message}`));
    }

    rows.push({
      rowType: 'language-conformance-dashboard',
      profileId: languageRow.id,
      requiredLevels,
      frameworkProfiles: asStringArray(languageRow.frameworkProfiles),
      levelStatus,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  const status = errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-conformance-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      dashboard: 'language-conformance',
      profileCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: warnings.length,
      errorCount: errors.length,
      levelCoverage: Object.fromEntries(CONFORMANCE_DASHBOARD_LEVELS.map((level) => {
        const requiredCount = rows.filter((row) => asStringArray(row.requiredLevels).includes(level)).length;
        const passingRequiredCount = rows.filter((row) => asStringArray(row.requiredLevels).includes(level) && row.levelStatus[level]?.pass).length;
        return [level, { requiredCount, passingRequiredCount }];
      }))
    },
    blockingFindings: errors.map((message) => ({
      class: 'conformance',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'conformance',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows),
    payload
  };
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
  const frameworkValidation = validateUsrMatrixRegistry('usr-framework-profiles', frameworkProfilesPayload);
  if (!frameworkValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...frameworkValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }

  const languageValidation = validateUsrMatrixRegistry('usr-language-profiles', languageProfilesPayload);
  if (!languageValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...languageValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([]),
      payload: null
    };
  }

  const c4Coverage = validateUsrConformanceLevelCoverage({
    targetLevel: 'C4',
    languageProfilesPayload,
    conformanceLevelsPayload,
    knownLanes
  });

  const errors = [...c4Coverage.errors.map((message) => `C4 ${message}`)];
  const warnings = [...c4Coverage.warnings.map((message) => `C4 ${message}`)];
  const rows = [];

  const frameworkRows = Array.isArray(frameworkProfilesPayload?.rows) ? frameworkProfilesPayload.rows : [];
  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];
  const languageById = new Map(languageRows.map((row) => [row.id, row]));
  const c4ByLanguageId = new Map((c4Coverage.rows || []).map((row) => [row.profileId, row]));

  for (const frameworkRow of frameworkRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const appliesToLanguages = asStringArray(frameworkRow.appliesToLanguages);
    const failingLanguages = [];

    if (appliesToLanguages.length === 0) {
      rowErrors.push('appliesToLanguages must not be empty');
    }

    for (const languageId of appliesToLanguages) {
      const languageRow = languageById.get(languageId);
      if (!languageRow) {
        rowErrors.push(`unknown language in appliesToLanguages: ${languageId}`);
        continue;
      }

      const languageFrameworkProfiles = asStringArray(languageRow.frameworkProfiles);
      if (!languageFrameworkProfiles.includes(frameworkRow.id)) {
        rowErrors.push(`inverse language frameworkProfiles linkage is missing for ${languageId}`);
      }

      const coverageRow = c4ByLanguageId.get(languageId);
      if (!coverageRow) {
        rowErrors.push(`missing C4 coverage row for ${languageId}`);
        failingLanguages.push(languageId);
        continue;
      }

      if (coverageRow.requiresLevel && !coverageRow.pass) {
        rowErrors.push(`C4 required coverage is failing for ${languageId}`);
        failingLanguages.push(languageId);
      } else if (!coverageRow.requiresLevel) {
        rowWarnings.push(`language ${languageId} does not require C4 despite framework applicability`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${frameworkRow.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${frameworkRow.id} ${message}`));
    }

    rows.push({
      rowType: 'framework-conformance-dashboard',
      profileId: frameworkRow.id,
      appliesToLanguages,
      failingLanguages: sortedStrings(failingLanguages),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  const status = errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-conformance-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      dashboard: 'framework-conformance',
      profileCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: warnings.length,
      errorCount: errors.length
    },
    blockingFindings: errors.map((message) => ({
      class: 'framework-conformance',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'framework-conformance',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows),
    payload
  };
}

const TEST_ROLLOUT_LEVELS = Object.freeze(['C0', 'C1']);
const DEEP_CONFORMANCE_LEVELS = Object.freeze(['C2', 'C3']);
const FRAMEWORK_CONFORMANCE_LEVELS = Object.freeze(['C4']);
const PROMOTION_READINESS_LEVELS = Object.freeze([
  ...TEST_ROLLOUT_LEVELS,
  ...DEEP_CONFORMANCE_LEVELS,
  ...FRAMEWORK_CONFORMANCE_LEVELS
]);

const toConformanceSummaryByLevel = (levelResults) => Object.freeze(
  Object.fromEntries(
    levelResults.map((row) => [
      row.level,
      Object.freeze({
        level: row.level,
        requiredProfileCount: row.requiredProfileCount,
        failingRequiredProfileCount: row.failingRequiredProfileCount,
        errorCount: row.errorCount,
        warningCount: row.warningCount,
        pass: row.pass
      })
    ])
  )
);

export function evaluateUsrConformancePromotionReadiness({
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = [],
  missingArtifacts = [],
  failingBlockingGateIds = []
} = {}) {
  const errors = [];
  const warnings = [];
  const blockers = [];
  const levelResults = [];

  for (const level of PROMOTION_READINESS_LEVELS) {
    const coverage = validateUsrConformanceLevelCoverage({
      targetLevel: level,
      languageProfilesPayload,
      conformanceLevelsPayload,
      knownLanes
    });

    const requiredRows = coverage.rows.filter((row) => row.requiresLevel);
    const failingRequiredRows = requiredRows.filter((row) => !row.pass);

    const levelPass = coverage.errors.length === 0 && failingRequiredRows.length === 0 && requiredRows.length > 0;
    levelResults.push({
      level,
      requiredProfileCount: requiredRows.length,
      failingRequiredProfileCount: failingRequiredRows.length,
      errorCount: coverage.errors.length,
      warningCount: coverage.warnings.length,
      pass: levelPass
    });

    if (coverage.errors.length > 0) {
      errors.push(...coverage.errors.map((message) => `${level} ${message}`));
    }
    if (coverage.warnings.length > 0) {
      warnings.push(...coverage.warnings.map((message) => `${level} ${message}`));
    }

    if (!levelPass) {
      const missingRows = requiredRows.length === 0;
      const levelReason = missingRows
        ? 'no required profiles'
        : (coverage.errors[0] || `${failingRequiredRows.length} required profiles failing`);

      if (TEST_ROLLOUT_LEVELS.includes(level)) {
        blockers.push(`missing-test-rollout-readiness:${level}:${levelReason}`);
      }
      if (DEEP_CONFORMANCE_LEVELS.includes(level)) {
        blockers.push(`missing-deep-conformance-readiness:${level}:${levelReason}`);
      }
      if (FRAMEWORK_CONFORMANCE_LEVELS.includes(level)) {
        blockers.push(`missing-framework-conformance-readiness:${level}:${levelReason}`);
      }
    }
  }

  for (const artifactId of asStringArray(missingArtifacts)) {
    blockers.push(`missing-artifact:${artifactId}`);
  }
  for (const gateId of asStringArray(failingBlockingGateIds)) {
    blockers.push(`failing-gate:${gateId}`);
  }

  const uniqueBlockers = [...new Set(blockers)];
  const testRolloutBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-test-rollout-readiness:'));
  const deepConformanceBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-deep-conformance-readiness:'));
  const frameworkConformanceBlocked = uniqueBlockers.some((blocker) => blocker.startsWith('missing-framework-conformance-readiness:'));

  return {
    ok: uniqueBlockers.length === 0,
    blocked: uniqueBlockers.length > 0,
    blockers: Object.freeze(uniqueBlockers),
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    conformanceByLevel: toConformanceSummaryByLevel(levelResults),
    readiness: Object.freeze({
      testRolloutBlocked,
      deepConformanceBlocked,
      frameworkConformanceBlocked
    })
  };
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












