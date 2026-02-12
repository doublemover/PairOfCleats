import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../schemas/usr-matrix.js';
import { USR_REPORT_SCHEMA_DEFS } from '../schemas/usr.js';
import {
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from './usr.js';

const ajv = createAjv({
  dialect: '2020',
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const RUNTIME_CONFIG_LAYER_ORDER = Object.freeze([
  { key: 'policyFile', label: 'policy-file' },
  { key: 'env', label: 'env' },
  { key: 'argv', label: 'argv' }
]);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const toBoolean = (value) => {
  if (typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected boolean' };
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return { ok: true, value: true };
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return { ok: true, value: false };
  }
  return { ok: false, error: `invalid boolean literal: ${value}` };
};

const toInteger = (value) => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { ok: false, error: `expected integer, received ${value}` };
    }
    return { ok: true, value };
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected integer' };
  }
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    return { ok: false, error: `invalid integer literal: ${value}` };
  }
  return { ok: true, value: Number.parseInt(normalized, 10) };
};

const toEnum = (value) => {
  if (typeof value !== 'string') {
    return { ok: false, error: 'expected enum string' };
  }
  return { ok: true, value };
};

const coerceRuntimeConfigValue = (row, rawValue) => {
  let coerced;
  if (row.valueType === 'boolean') {
    coerced = toBoolean(rawValue);
  } else if (row.valueType === 'integer') {
    coerced = toInteger(rawValue);
  } else if (row.valueType === 'enum') {
    coerced = toEnum(rawValue);
  } else {
    return { ok: false, error: `unsupported runtime config valueType: ${row.valueType}` };
  }

  if (!coerced.ok) {
    return coerced;
  }

  if (row.valueType === 'integer') {
    if (row.minValue != null && coerced.value < row.minValue) {
      return { ok: false, error: `value ${coerced.value} below minValue ${row.minValue}` };
    }
    if (row.maxValue != null && coerced.value > row.maxValue) {
      return { ok: false, error: `value ${coerced.value} above maxValue ${row.maxValue}` };
    }
  }

  if (row.valueType === 'enum' && Array.isArray(row.allowedValues)) {
    if (!row.allowedValues.includes(coerced.value)) {
      return { ok: false, error: `value ${coerced.value} not in allowedValues` };
    }
  }

  return coerced;
};

const validateUnknownRuntimeKeys = ({ sourceValues, sourceLabel, knownKeys, strictMode, errors, warnings }) => {
  if (!sourceValues || typeof sourceValues !== 'object') {
    return;
  }
  for (const key of Object.keys(sourceValues)) {
    if (knownKeys.has(key)) {
      continue;
    }
    const message = `unknown runtime config key at ${sourceLabel}: ${key}`;
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  }
};

const applyRuntimeOverride = ({ row, layerLabel, rawValue, strictMode, errors, warnings }) => {
  const parsed = coerceRuntimeConfigValue(row, rawValue);
  if (parsed.ok) {
    return parsed;
  }

  const message = `invalid runtime config value for ${row.key} at ${layerLabel}: ${parsed.error}`;
  const disallowInStrictMode = row.strictModeBehavior === 'disallow';
  if (strictMode && disallowInStrictMode) {
    errors.push(message);
  } else {
    warnings.push(message);
  }

  return { ok: false, error: parsed.error };
};

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
  const policyValidation = validateUsrMatrixRegistry('usr-runtime-config-policy', policyPayload);
  const errors = [];
  const warnings = [];
  const values = {};
  const appliedByKey = {};

  if (!policyValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...policyValidation.errors]),
      warnings: Object.freeze(warnings),
      values: Object.freeze(values),
      appliedByKey: Object.freeze(appliedByKey)
    };
  }

  const rows = Array.isArray(policyPayload?.rows) ? policyPayload.rows : [];
  const rowsByKey = new Map();
  for (const row of rows) {
    if (rowsByKey.has(row.key)) {
      errors.push(`duplicate runtime config key in policy: ${row.key}`);
      continue;
    }
    rowsByKey.set(row.key, row);
  }

  for (const layer of RUNTIME_CONFIG_LAYER_ORDER) {
    validateUnknownRuntimeKeys({
      sourceValues: layers[layer.key],
      sourceLabel: layer.label,
      knownKeys: rowsByKey,
      strictMode,
      errors,
      warnings
    });
  }

  for (const row of rows) {
    values[row.key] = row.defaultValue;
    appliedByKey[row.key] = 'default';

    for (const layer of RUNTIME_CONFIG_LAYER_ORDER) {
      const sourceValues = layers[layer.key];
      if (!sourceValues || typeof sourceValues !== 'object') {
        continue;
      }
      if (!hasOwn(sourceValues, row.key)) {
        continue;
      }

      const parsed = applyRuntimeOverride({
        row,
        layerLabel: layer.label,
        rawValue: sourceValues[row.key],
        strictMode,
        errors,
        warnings
      });
      if (!parsed.ok) {
        continue;
      }

      values[row.key] = parsed.value;
      appliedByKey[row.key] = layer.label;
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    values: Object.freeze(values),
    appliedByKey: Object.freeze(appliedByKey)
  };
}


export function validateUsrFeatureFlagConflicts({
  values = {},
  strictMode = true
} = {}) {
  const errors = [];
  const warnings = [];

  const addConflict = (message) => {
    if (strictMode) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  };

  const cutoverEnabled = values['usr.rollout.cutoverEnabled'] === true;
  const shadowReadEnabled = values['usr.rollout.shadowReadEnabled'] === true;
  if (cutoverEnabled && shadowReadEnabled) {
    addConflict('disallowed feature-flag conflict: usr.rollout.cutoverEnabled and usr.rollout.shadowReadEnabled cannot both be true');
  }

  if (strictMode && values['usr.strictMode.enabled'] === false) {
    errors.push('disallowed feature-flag value in strict mode: usr.strictMode.enabled cannot be false');
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings])
  };
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
  const resolved = resolveUsrRuntimeConfig({
    policyPayload,
    layers,
    strictMode
  });

  const conflictValidation = validateUsrFeatureFlagConflicts({
    values: resolved.values,
    strictMode
  });

  const errors = [
    ...resolved.errors,
    ...conflictValidation.errors
  ];
  const warnings = [
    ...resolved.warnings,
    ...conflictValidation.warnings
  ];

  const policyRows = Array.isArray(policyPayload?.rows) ? policyPayload.rows : [];
  const rows = policyRows.map((row) => ({
    id: row.id,
    key: row.key,
    value: resolved.values[row.key],
    source: resolved.appliedByKey[row.key] || 'default',
    valueType: row.valueType,
    rolloutClass: row.rolloutClass,
    strictModeBehavior: row.strictModeBehavior,
    requiresRestart: Boolean(row.requiresRestart),
    blocking: Boolean(row.blocking)
  }));

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const status = errors.length > 0
    ? 'fail'
    : (warnings.length > 0 ? 'warn' : 'pass');

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-feature-flag-state',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      strictMode,
      keyCount: rows.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      conflictCount: conflictValidation.errors.length + conflictValidation.warnings.length
    },
    blockingFindings: errors.map((message) => ({
      class: 'runtime-config',
      message
    })),
    advisoryFindings: warnings.map((message) => ({
      class: 'runtime-config',
      message
    })),
    rows
  };

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    values: resolved.values,
    appliedByKey: resolved.appliedByKey,
    payload
  };
}

const normalizeFailureScenarioResults = (results) => {
  if (Array.isArray(results)) {
    return new Map(
      results
        .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
        .map((row) => [row.id, row])
    );
  }

  if (results && typeof results === 'object') {
    return new Map(Object.entries(results));
  }

  return new Map();
};

const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

const validateScenarioCodeArrays = ({
  scenarioId,
  mode,
  diagnostics,
  reasonCodes,
  strictEnum,
  errors
}) => {
  for (const diagnostic of diagnostics) {
    const diagnosticValidation = validateUsrDiagnosticCode(diagnostic, { strictEnum });
    if (!diagnosticValidation.ok) {
      errors.push(`${scenarioId} ${mode} diagnostic invalid: ${diagnosticValidation.errors.join('; ')}`);
    }
  }

  for (const reasonCode of reasonCodes) {
    const reasonValidation = validateUsrReasonCode(reasonCode, { strictEnum });
    if (!reasonValidation.ok) {
      errors.push(`${scenarioId} ${mode} reasonCode invalid: ${reasonValidation.errors.join('; ')}`);
    }
  }
};

export function evaluateUsrFailureInjectionScenarios({
  matrixPayload,
  strictScenarioResults = {},
  nonStrictScenarioResults = {},
  strictEnum = true
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-failure-injection-matrix', matrixPayload);
  if (!matrixValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...matrixValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const matrixRows = Array.isArray(matrixPayload?.rows) ? matrixPayload.rows : [];
  const matrixIds = new Set(matrixRows.map((row) => row.id));

  const strictById = normalizeFailureScenarioResults(strictScenarioResults);
  const nonStrictById = normalizeFailureScenarioResults(nonStrictScenarioResults);

  for (const [id] of strictById.entries()) {
    if (!matrixIds.has(id)) {
      warnings.push(`strict scenario result does not map to matrix row: ${id}`);
    }
  }
  for (const [id] of nonStrictById.entries()) {
    if (!matrixIds.has(id)) {
      warnings.push(`non-strict scenario result does not map to matrix row: ${id}`);
    }
  }

  for (const row of matrixRows) {
    const rowErrors = [];

    const strictObserved = strictById.get(row.id) || null;
    const nonStrictObserved = nonStrictById.get(row.id) || null;

    if (!strictObserved) {
      rowErrors.push('missing strict scenario result');
    }
    if (!nonStrictObserved) {
      rowErrors.push('missing non-strict scenario result');
    }

    if (strictObserved) {
      if (strictObserved.outcome !== row.strictExpectedOutcome) {
        rowErrors.push(`strict outcome mismatch: expected ${row.strictExpectedOutcome}, received ${strictObserved.outcome}`);
      }
    }

    if (nonStrictObserved) {
      if (nonStrictObserved.outcome !== row.nonStrictExpectedOutcome) {
        rowErrors.push(`non-strict outcome mismatch: expected ${row.nonStrictExpectedOutcome}, received ${nonStrictObserved.outcome}`);
      }
    }

    const requiredDiagnostics = asStringArray(row.requiredDiagnostics);
    const requiredReasonCodes = asStringArray(row.requiredReasonCodes);

    const strictDiagnostics = asStringArray(strictObserved?.diagnostics);
    const strictReasonCodes = asStringArray(strictObserved?.reasonCodes);
    const strictRecoveryEvidence = asStringArray(strictObserved?.recoveryEvidence);
    const nonStrictDiagnostics = asStringArray(nonStrictObserved?.diagnostics);
    const nonStrictReasonCodes = asStringArray(nonStrictObserved?.reasonCodes);
    const nonStrictRecoveryEvidence = asStringArray(nonStrictObserved?.recoveryEvidence);

    for (const requiredDiagnostic of requiredDiagnostics) {
      if (!strictDiagnostics.includes(requiredDiagnostic)) {
        rowErrors.push(`strict diagnostics missing required code ${requiredDiagnostic}`);
      }
      if (!nonStrictDiagnostics.includes(requiredDiagnostic)) {
        rowErrors.push(`non-strict diagnostics missing required code ${requiredDiagnostic}`);
      }
    }

    for (const requiredReasonCode of requiredReasonCodes) {
      if (!strictReasonCodes.includes(requiredReasonCode)) {
        rowErrors.push(`strict reasonCodes missing required code ${requiredReasonCode}`);
      }
      if (!nonStrictReasonCodes.includes(requiredReasonCode)) {
        rowErrors.push(`non-strict reasonCodes missing required code ${requiredReasonCode}`);
      }
    }

    if (row.blocking) {
      if (strictRecoveryEvidence.length === 0) {
        rowErrors.push('strict recoveryEvidence missing for blocking scenario');
      }
      if (nonStrictRecoveryEvidence.length === 0) {
        rowErrors.push('non-strict recoveryEvidence missing for blocking scenario');
      }
    }

    validateScenarioCodeArrays({
      scenarioId: row.id,
      mode: 'strict',
      diagnostics: strictDiagnostics,
      reasonCodes: strictReasonCodes,
      strictEnum,
      errors: rowErrors
    });

    validateScenarioCodeArrays({
      scenarioId: row.id,
      mode: 'non-strict',
      diagnostics: nonStrictDiagnostics,
      reasonCodes: nonStrictReasonCodes,
      strictEnum,
      errors: rowErrors
    });

    const pass = rowErrors.length === 0;
    if (!pass) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      faultClass: row.faultClass,
      injectionLayer: row.injectionLayer,
      blocking: Boolean(row.blocking),
      strictExpectedOutcome: row.strictExpectedOutcome,
      nonStrictExpectedOutcome: row.nonStrictExpectedOutcome,
      strictObservedOutcome: strictObserved?.outcome ?? null,
      nonStrictObservedOutcome: nonStrictObserved?.outcome ?? null,
      strictRecoveryEvidenceCount: strictRecoveryEvidence.length,
      nonStrictRecoveryEvidenceCount: nonStrictRecoveryEvidence.length,
      pass,
      errors: Object.freeze([...rowErrors])
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
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
  const evaluation = evaluateUsrFailureInjectionScenarios({
    matrixPayload,
    strictScenarioResults,
    nonStrictScenarioResults,
    strictEnum
  });

  const rows = evaluation.rows.map((row) => ({
    id: row.id,
    faultClass: row.faultClass,
    injectionLayer: row.injectionLayer,
    blocking: row.blocking,
    strictExpectedOutcome: row.strictExpectedOutcome,
    nonStrictExpectedOutcome: row.nonStrictExpectedOutcome,
    strictObservedOutcome: row.strictObservedOutcome,
    nonStrictObservedOutcome: row.nonStrictObservedOutcome,
    strictRecoveryEvidenceCount: row.strictRecoveryEvidenceCount,
    nonStrictRecoveryEvidenceCount: row.nonStrictRecoveryEvidenceCount,
    pass: row.pass,
    errors: row.errors
  }));

  const failRows = rows.filter((row) => row.pass === false);
  const blockingFailureCount = failRows.filter((row) => row.blocking).length;
  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-failure-injection-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      strictMode,
      scenarioCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: failRows.length,
      blockingFailureCount,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'failure-injection',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'failure-injection',
      message
    })),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows: evaluation.rows,
    payload
  };
}

export function validateUsrFixtureGovernanceControls({
  fixtureGovernancePayload
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-fixture-governance', fixtureGovernancePayload);
  if (!matrixValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...matrixValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const payloadRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const fixtureIdCounts = new Map();
  for (const row of payloadRows) {
    fixtureIdCounts.set(row.fixtureId, (fixtureIdCounts.get(row.fixtureId) || 0) + 1);
  }

  for (const row of payloadRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((fixtureIdCounts.get(row.fixtureId) || 0) > 1) {
      rowErrors.push('fixtureId must be unique within fixture-governance matrix');
    }

    if (typeof row.owner !== 'string' || row.owner.trim() === '') {
      rowErrors.push('owner must be non-empty');
    }

    const reviewers = asStringArray(row.reviewers);
    if (reviewers.length === 0) {
      rowErrors.push('reviewers must contain at least one reviewer');
    }

    if (reviewers.includes(row.owner)) {
      rowWarnings.push('owner also appears in reviewers list');
    }

    const families = asStringArray(row.families);
    if (families.length === 0) {
      rowErrors.push('families must include at least one fixture family');
    }

    const conformanceLevels = asStringArray(row.conformanceLevels);
    if (conformanceLevels.length === 0) {
      rowErrors.push('conformanceLevels must include at least one level');
    }

    if (row.profileType === 'framework' && !conformanceLevels.includes('C4')) {
      rowErrors.push('framework fixture rows must include C4 in conformanceLevels');
    }

    if (families.includes('framework-overlay') && !conformanceLevels.includes('C4')) {
      rowErrors.push('framework-overlay families must include C4 conformance level');
    }

    if (families.includes('golden') && row.goldenRequired !== true) {
      rowErrors.push('golden family rows must set goldenRequired=true');
    }

    if (row.blocking === true && row.mutationPolicy === 'allow-generated-refresh') {
      rowErrors.push('blocking fixture rows cannot use mutationPolicy=allow-generated-refresh');
    }

    if (row.blocking === true && row.stabilityClass === 'volatile') {
      rowWarnings.push('blocking fixture row marked volatile; ensure drift is intentionally managed');
    }

    if (!/^language-|^framework-|^usr-/.test(String(row.owner || ''))) {
      rowWarnings.push('owner naming does not match expected prefix convention (language-/framework-/usr-)');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.fixtureId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.fixtureId} ${message}`));
    }

    rows.push({
      fixtureId: row.fixtureId,
      profileType: row.profileType,
      profileId: row.profileId,
      blocking: Boolean(row.blocking),
      mutationPolicy: row.mutationPolicy,
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
  const validation = validateUsrFixtureGovernanceControls({ fixtureGovernancePayload });

  const rows = validation.rows.map((row) => ({
    fixtureId: row.fixtureId,
    profileType: row.profileType,
    profileId: row.profileId,
    blocking: row.blocking,
    mutationPolicy: row.mutationPolicy,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-validation-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      validationDomain: 'fixture-governance',
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'fixture-governance',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'fixture-governance',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows: validation.rows,
    payload
  };
}

const normalizeBenchmarkObservedResults = (results) => {
  if (Array.isArray(results)) {
    return new Map(
      results
        .filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
        .map((row) => [row.id, row])
    );
  }

  if (results && typeof results === 'object') {
    return new Map(Object.entries(results));
  }

  return new Map();
};

const toNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export function validateUsrBenchmarkMethodology({
  benchmarkPolicyPayload,
  sloBudgetsPayload
} = {}) {
  const benchmarkPolicyValidation = validateUsrMatrixRegistry('usr-benchmark-policy', benchmarkPolicyPayload);
  if (!benchmarkPolicyValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...benchmarkPolicyValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const sloBudgetValidation = validateUsrMatrixRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloBudgetValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...sloBudgetValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];

  const idCounts = new Map();
  for (const row of benchmarkRows) {
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }

  const sloByLane = new Map();
  for (const row of sloRows) {
    if (sloByLane.has(row.laneId)) {
      warnings.push(`duplicate slo budget lane row; first row retained for laneId=${row.laneId}`);
      continue;
    }
    sloByLane.set(row.laneId, row);
  }

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((idCounts.get(row.id) || 0) > 1) {
      rowErrors.push('benchmark policy id must be unique');
    }

    if (row.warmupRuns < 1) {
      rowErrors.push('warmupRuns must be >= 1 for deterministic methodology');
    }

    if (row.measureRuns < 3) {
      rowErrors.push('measureRuns must be >= 3 for deterministic percentile confidence');
    }

    const p50 = row?.percentileTargets?.p50DurationMs;
    const p95 = row?.percentileTargets?.p95DurationMs;
    const p99 = row?.percentileTargets?.p99DurationMs;
    if (!(p50 <= p95 && p95 <= p99)) {
      rowErrors.push('percentileTargets must satisfy p50 <= p95 <= p99');
    }

    if (row.maxVariancePct <= 0 || row.maxVariancePct > 100) {
      rowErrors.push('maxVariancePct must be in (0, 100]');
    }

    const sloBudget = sloByLane.get(row.laneId);
    if (!sloBudget) {
      if (row.blocking) {
        rowErrors.push(`blocking benchmark row requires matching slo budget laneId=${row.laneId}`);
      } else {
        rowWarnings.push(`non-blocking benchmark row has no matching slo budget laneId=${row.laneId}`);
      }
    } else {
      if (row.maxPeakMemoryMb > sloBudget.maxMemoryMb) {
        rowErrors.push(`benchmark maxPeakMemoryMb exceeds slo maxMemoryMb for laneId=${row.laneId}`);
      }
      if (row.percentileTargets.p95DurationMs > sloBudget.maxDurationMs) {
        rowErrors.push(`benchmark p95DurationMs exceeds slo maxDurationMs for laneId=${row.laneId}`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
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

export function evaluateUsrBenchmarkRegression({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {}
} = {}) {
  const methodology = validateUsrBenchmarkMethodology({
    benchmarkPolicyPayload,
    sloBudgetsPayload
  });

  const errors = [...methodology.errors];
  const warnings = [...methodology.warnings];

  const benchmarkRows = Array.isArray(benchmarkPolicyPayload?.rows) ? benchmarkPolicyPayload.rows : [];
  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const sloByLane = new Map(sloRows.map((row) => [row.laneId, row]));
  const observedById = normalizeBenchmarkObservedResults(observedResults);

  const rows = [];

  for (const row of benchmarkRows) {
    const rowErrors = [];
    const rowWarnings = [];

    const observed = observedById.get(row.id);
    if (!observed) {
      if (row.blocking) {
        rowErrors.push('missing observed benchmark results for blocking row');
      } else {
        rowWarnings.push('missing observed benchmark results for non-blocking row');
      }
    }

    const p50Observed = toNumber(observed?.p50DurationMs);
    const p95Observed = toNumber(observed?.p95DurationMs);
    const p99Observed = toNumber(observed?.p99DurationMs);
    const varianceObserved = toNumber(observed?.variancePct);
    const peakMemoryObserved = toNumber(observed?.peakMemoryMb);

    const compare = ({ condition, message }) => {
      if (condition) {
        return;
      }
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    };

    if (observed) {
      compare({ condition: p50Observed != null, message: 'observed p50DurationMs must be numeric' });
      compare({ condition: p95Observed != null, message: 'observed p95DurationMs must be numeric' });
      compare({ condition: p99Observed != null, message: 'observed p99DurationMs must be numeric' });
      compare({ condition: varianceObserved != null, message: 'observed variancePct must be numeric' });
      compare({ condition: peakMemoryObserved != null, message: 'observed peakMemoryMb must be numeric' });

      if (p50Observed != null) {
        compare({ condition: p50Observed <= row.percentileTargets.p50DurationMs, message: `p50DurationMs regression: ${p50Observed} > ${row.percentileTargets.p50DurationMs}` });
      }
      if (p95Observed != null) {
        compare({ condition: p95Observed <= row.percentileTargets.p95DurationMs, message: `p95DurationMs regression: ${p95Observed} > ${row.percentileTargets.p95DurationMs}` });
      }
      if (p99Observed != null) {
        compare({ condition: p99Observed <= row.percentileTargets.p99DurationMs, message: `p99DurationMs regression: ${p99Observed} > ${row.percentileTargets.p99DurationMs}` });
      }
      if (varianceObserved != null) {
        compare({ condition: varianceObserved <= row.maxVariancePct, message: `variancePct regression: ${varianceObserved} > ${row.maxVariancePct}` });
      }
      if (peakMemoryObserved != null) {
        compare({ condition: peakMemoryObserved <= row.maxPeakMemoryMb, message: `peakMemoryMb regression: ${peakMemoryObserved} > ${row.maxPeakMemoryMb}` });
      }

      const sloBudget = sloByLane.get(row.laneId);
      if (sloBudget) {
        if (p95Observed != null) {
          compare({ condition: p95Observed <= sloBudget.maxDurationMs, message: `p95DurationMs exceeds slo maxDurationMs: ${p95Observed} > ${sloBudget.maxDurationMs}` });
        }
        if (peakMemoryObserved != null) {
          compare({ condition: peakMemoryObserved <= sloBudget.maxMemoryMb, message: `peakMemoryMb exceeds slo maxMemoryMb: ${peakMemoryObserved} > ${sloBudget.maxMemoryMb}` });
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0 && rowWarnings.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings]),
      observed: observed || null
    });
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrBenchmarkRegressionReport({
  benchmarkPolicyPayload,
  sloBudgetsPayload,
  observedResults = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-benchmark-regression-evaluator',
  producerVersion = null,
  runId = 'run-usr-benchmark-regression',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrBenchmarkRegression({
    benchmarkPolicyPayload,
    sloBudgetsPayload,
    observedResults
  });

  const rows = evaluation.rows.map((row) => ({
    id: row.id,
    laneId: row.laneId,
    blocking: row.blocking,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings,
    observed: row.observed
  }));

  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-benchmark-regression-summary',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'benchmark-regression',
      message
    })),
    rows
  };

  return {
    ok: evaluation.ok,
    errors: evaluation.errors,
    warnings: evaluation.warnings,
    rows: evaluation.rows,
    payload
  };
}

const BATCH_SHARD_ID_ORDER = Object.freeze(['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
const REQUIRED_BATCH_SHARD_IDS = Object.freeze(new Set(BATCH_SHARD_ID_ORDER));
const LANGUAGE_BATCH_IDS = Object.freeze(new Set(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']));
const BATCH_DEPENDENCIES = Object.freeze({
  B0: [],
  B1: ['B0'],
  B2: ['B1'],
  B3: ['B1'],
  B4: ['B1'],
  B5: ['B1'],
  B6: ['B1'],
  B7: ['B1'],
  B8: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']
});

const sortedStrings = (value) => [...asStringArray(value)].sort((left, right) => left.localeCompare(right));

const equalStringSets = (left, right) => {
  const leftSorted = sortedStrings(left);
  const rightSorted = sortedStrings(right);
  if (leftSorted.length !== rightSorted.length) {
    return false;
  }
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

export function validateUsrLanguageBatchShards({
  batchShardsPayload,
  languageProfilesPayload
} = {}) {
  const batchValidation = validateUsrMatrixRegistry('usr-language-batch-shards', batchShardsPayload);
  if (!batchValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...batchValidation.errors]),
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

  const errors = [];
  const warnings = [];
  const rows = [];

  const shardRows = Array.isArray(batchShardsPayload?.rows) ? batchShardsPayload.rows : [];
  const languageRows = Array.isArray(languageProfilesPayload?.rows) ? languageProfilesPayload.rows : [];

  const languageIds = new Set(languageRows.map((row) => row.id));
  const batchById = new Map();
  const laneIdCounts = new Map();
  const sequenceCounts = new Map();
  const languageToBatch = new Map();

  for (const row of shardRows) {
    laneIdCounts.set(row.laneId, (laneIdCounts.get(row.laneId) || 0) + 1);
    sequenceCounts.set(row.sequence, (sequenceCounts.get(row.sequence) || 0) + 1);
  }

  for (const row of shardRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if (batchById.has(row.id)) {
      rowErrors.push('batch shard id must be unique');
    }
    batchById.set(row.id, row);

    const expectedLaneId = `batch-b${row.sequence}`;
    if (row.laneId !== expectedLaneId) {
      rowErrors.push(`laneId must match sequence mapping: expected ${expectedLaneId}`);
    }

    const expectedOrderManifest = `tests/${row.laneId}/${row.laneId}.order.txt`;
    if (row.orderManifest !== expectedOrderManifest) {
      rowErrors.push(`orderManifest must match lane path: expected ${expectedOrderManifest}`);
    }

    if ((laneIdCounts.get(row.laneId) || 0) > 1) {
      rowErrors.push('laneId must be unique');
    }

    if ((sequenceCounts.get(row.sequence) || 0) > 1) {
      rowErrors.push('sequence must be unique');
    }

    if (!REQUIRED_BATCH_SHARD_IDS.has(row.id)) {
      rowErrors.push(`unexpected batch shard id: ${row.id}`);
    }

    const expectedDependencies = BATCH_DEPENDENCIES[row.id] || [];
    if (!equalStringSets(row.dependsOn, expectedDependencies)) {
      rowErrors.push(`dependsOn must match canonical dependency set: ${expectedDependencies.join(', ') || '<none>'}`);
    }

    const expectedScopeType = row.id === 'B0'
      ? 'foundation'
      : (row.id === 'B8' ? 'integration' : 'language-batch');
    if (row.scopeType !== expectedScopeType) {
      rowErrors.push(`scopeType must be ${expectedScopeType} for ${row.id}`);
    }

    const sortedLanguageIds = sortedStrings(row.languageIds);
    const rawLanguageIds = asStringArray(row.languageIds);
    if (sortedLanguageIds.length !== rawLanguageIds.length || !sortedLanguageIds.every((value, index) => value === rawLanguageIds[index])) {
      rowErrors.push('languageIds must be sorted ascending for deterministic manifests');
    }

    if (LANGUAGE_BATCH_IDS.has(row.id) && sortedLanguageIds.length === 0) {
      rowErrors.push('language batch shard must declare at least one language id');
    }

    if ((row.id === 'B0' || row.id === 'B8') && sortedLanguageIds.length > 0) {
      rowErrors.push('B0 and B8 shards must not enumerate languageIds directly');
    }

    for (const languageId of sortedLanguageIds) {
      if (!languageIds.has(languageId)) {
        rowErrors.push(`unknown language id in shard: ${languageId}`);
        continue;
      }
      const owner = languageToBatch.get(languageId);
      if (owner && owner !== row.id) {
        rowErrors.push(`language id assigned to multiple shards: ${languageId} (existing ${owner})`);
      } else {
        languageToBatch.set(languageId, row.id);
      }
    }

    if (asStringArray(row.requiredConformance).length === 0) {
      rowWarnings.push('requiredConformance should include at least one level');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      laneId: row.laneId,
      sequence: row.sequence,
      scopeType: row.scopeType,
      languageCount: sortedLanguageIds.length,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const requiredId of REQUIRED_BATCH_SHARD_IDS) {
    if (!batchById.has(requiredId)) {
      errors.push(`missing required batch shard id: ${requiredId}`);
    }
  }

  for (const languageId of languageIds) {
    if (!languageToBatch.has(languageId)) {
      errors.push(`language profile is missing from batch shard mapping: ${languageId}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

const CONFORMANCE_LANE_BY_LEVEL = Object.freeze({
  C0: 'conformance-c0',
  C1: 'conformance-c1',
  C2: 'conformance-c2',
  C3: 'conformance-c3',
  C4: 'conformance-c4'
});

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
      const expectedLane = CONFORMANCE_LANE_BY_LEVEL[conformanceLevel];
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

const CONFORMANCE_LEVEL_TO_LANE = Object.freeze({
  C0: 'conformance-c0',
  C1: 'conformance-c1',
  C2: 'conformance-c2',
  C3: 'conformance-c3',
  C4: 'conformance-c4'
});

export function validateUsrConformanceLevelCoverage({
  targetLevel,
  languageProfilesPayload,
  conformanceLevelsPayload,
  knownLanes = []
} = {}) {
  const level = typeof targetLevel === 'string' ? targetLevel : '';
  if (!Object.prototype.hasOwnProperty.call(CONFORMANCE_LEVEL_TO_LANE, level)) {
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
  const expectedLane = CONFORMANCE_LEVEL_TO_LANE[level];
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
  const defaultLane = CONFORMANCE_LEVEL_TO_LANE[level] || 'ci';
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
    rows: evaluation.rows,
    payload
  };
}

const USR_VERSION_PATTERN = /^usr-\d+\.\d+\.\d+$/;
const REQUIRED_BACKCOMPAT_IDS = Object.freeze(
  new Set(Array.from({ length: 12 }, (_, index) => `BC-${String(index + 1).padStart(3, '0')}`))
);

export function validateUsrBackcompatMatrixCoverage({
  backcompatMatrixPayload,
  strictEnum = true
} = {}) {
  const matrixValidation = validateUsrMatrixRegistry('usr-backcompat-matrix', backcompatMatrixPayload);
  if (!matrixValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...matrixValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const matrixRows = Array.isArray(backcompatMatrixPayload?.rows) ? backcompatMatrixPayload.rows : [];
  const idCounts = new Map();
  const seenIds = new Set();

  for (const row of matrixRows) {
    idCounts.set(row.id, (idCounts.get(row.id) || 0) + 1);
  }

  for (const row of matrixRows) {
    const rowErrors = [];
    const rowWarnings = [];

    seenIds.add(row.id);

    if ((idCounts.get(row.id) || 0) > 1) {
      rowErrors.push('backcompat row id must be unique');
    }

    if (!USR_VERSION_PATTERN.test(String(row.producerVersion || ''))) {
      rowErrors.push(`producerVersion must match usr-semver format: ${row.producerVersion}`);
    }

    const readerVersions = asStringArray(row.readerVersions);
    if (readerVersions.length === 0) {
      rowErrors.push('readerVersions must include at least one reader version');
    }

    for (const version of readerVersions) {
      if (!USR_VERSION_PATTERN.test(version)) {
        rowErrors.push(`readerVersion must match usr-semver format: ${version}`);
      }
    }

    const requiredDiagnostics = asStringArray(row.requiredDiagnostics);
    for (const diagnostic of requiredDiagnostics) {
      const diagnosticValidation = validateUsrDiagnosticCode(diagnostic, { strictEnum });
      if (!diagnosticValidation.ok) {
        rowErrors.push(`requiredDiagnostics contains invalid code ${diagnostic}: ${diagnosticValidation.errors.join('; ')}`);
      }
    }

    if (row.expectedOutcome === 'accept-with-adapter') {
      if (row.readerMode !== 'non-strict') {
        rowErrors.push('accept-with-adapter rows must use readerMode=non-strict');
      }
      if (row.blocking !== false) {
        rowErrors.push('accept-with-adapter rows must be non-blocking');
      }
      if (!requiredDiagnostics.includes('USR-W-BACKCOMPAT-ADAPTER')) {
        rowWarnings.push('accept-with-adapter row should include USR-W-BACKCOMPAT-ADAPTER diagnostic');
      }
    }

    if (row.expectedOutcome === 'reject') {
      if (row.blocking !== true) {
        rowErrors.push('reject rows must be blocking');
      }
      if (requiredDiagnostics.length === 0) {
        rowErrors.push('reject rows must include at least one required diagnostic');
      }
    }

    if (row.expectedOutcome === 'accept' && row.blocking !== true) {
      rowWarnings.push('accept rows are expected to remain blocking for strict compatibility guarantees');
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      readerMode: row.readerMode,
      expectedOutcome: row.expectedOutcome,
      blocking: Boolean(row.blocking),
      readerVersionCount: readerVersions.length,
      requiredDiagnostics,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const requiredId of REQUIRED_BACKCOMPAT_IDS) {
    if (!seenIds.has(requiredId)) {
      errors.push(`missing required backcompat scenario row: ${requiredId}`);
    }
  }

  const pairwiseExpandedRows = matrixRows.filter((row) => asStringArray(row.readerVersions).length > 1);
  if (pairwiseExpandedRows.length === 0) {
    errors.push('backcompat matrix must include at least one pairwise-expanded readerVersions row');
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrBackcompatMatrixReport({
  backcompatMatrixPayload,
  strictEnum = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-backcompat-validator',
  producerVersion = null,
  runId = 'run-usr-backcompat-matrix-results',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrBackcompatMatrixCoverage({
    backcompatMatrixPayload,
    strictEnum
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    readerMode: row.readerMode,
    expectedOutcome: row.expectedOutcome,
    blocking: row.blocking,
    readerVersionCount: row.readerVersionCount,
    requiredDiagnostics: row.requiredDiagnostics,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-backcompat-matrix-results',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      scenarioCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      strictScenarioCount: rows.filter((row) => row.readerMode === 'strict').length,
      nonStrictScenarioCount: rows.filter((row) => row.readerMode === 'non-strict').length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'backcompat',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'backcompat',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows: validation.rows,
    payload
  };
}

export function validateUsrThreatModelCoverage({
  threatModelPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload
} = {}) {
  const threatValidation = validateUsrMatrixRegistry('usr-threat-model-matrix', threatModelPayload);
  if (!threatValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...threatValidation.errors]),
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

  const securityValidation = validateUsrMatrixRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...securityValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const alertValidation = validateUsrMatrixRegistry('usr-alert-policies', alertPoliciesPayload);
  if (!alertValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...alertValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const redactionValidation = validateUsrMatrixRegistry('usr-redaction-rules', redactionRulesPayload);
  if (!redactionValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...redactionValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const threatRows = Array.isArray(threatModelPayload?.rows) ? threatModelPayload.rows : [];
  const fixtureRows = Array.isArray(fixtureGovernancePayload?.rows) ? fixtureGovernancePayload.rows : [];
  const securityRows = Array.isArray(securityGatesPayload?.rows) ? securityGatesPayload.rows : [];
  const alertRows = Array.isArray(alertPoliciesPayload?.rows) ? alertPoliciesPayload.rows : [];
  const redactionRows = Array.isArray(redactionRulesPayload?.rows) ? redactionRulesPayload.rows : [];

  const controlIds = new Set([
    ...securityRows.map((row) => row.id),
    ...alertRows.map((row) => row.id),
    ...redactionRows.map((row) => row.id)
  ]);

  const fixtureById = new Map(fixtureRows.map((row) => [row.fixtureId, row]));
  const threatIdCounts = new Map();
  for (const row of threatRows) {
    threatIdCounts.set(row.id, (threatIdCounts.get(row.id) || 0) + 1);
  }

  for (const row of threatRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((threatIdCounts.get(row.id) || 0) > 1) {
      rowErrors.push('threat id must be unique within threat-model matrix');
    }

    const requiredControls = asStringArray(row.requiredControls);
    const requiredFixtures = asStringArray(row.requiredFixtures);

    if (requiredControls.length === 0) {
      rowErrors.push('requiredControls must contain at least one control id');
    }
    if (requiredFixtures.length === 0) {
      rowErrors.push('requiredFixtures must contain at least one fixture id');
    }

    const missingControls = requiredControls.filter((controlId) => !controlIds.has(controlId));
    const missingFixtures = requiredFixtures.filter((fixtureId) => !fixtureById.has(fixtureId));

    if (missingControls.length > 0) {
      rowErrors.push(`missing control mappings: ${missingControls.join(', ')}`);
    }
    if (missingFixtures.length > 0) {
      rowErrors.push(`missing fixture mappings: ${missingFixtures.join(', ')}`);
    }

    if (row.severity === 'critical' && row.blocking !== true) {
      rowErrors.push('critical threat rows must be blocking');
    }

    for (const fixtureId of requiredFixtures) {
      const fixtureRow = fixtureById.get(fixtureId);
      if (!fixtureRow) {
        continue;
      }
      if (row.blocking && fixtureRow.blocking !== true) {
        rowErrors.push(`blocking threat row requires blocking fixture mapping: ${fixtureId}`);
      }
      if (!Array.isArray(fixtureRow.families) || fixtureRow.families.length === 0) {
        rowWarnings.push(`mapped fixture has no family metadata: ${fixtureId}`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      threatClass: row.threatClass,
      attackSurface: row.attackSurface,
      severity: row.severity,
      blocking: Boolean(row.blocking),
      missingControls,
      missingFixtures,
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

export function buildUsrThreatModelCoverageReport({
  threatModelPayload,
  fixtureGovernancePayload,
  securityGatesPayload,
  alertPoliciesPayload,
  redactionRulesPayload,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-threat-model-validator',
  producerVersion = null,
  runId = 'run-usr-threat-model-coverage',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrThreatModelCoverage({
    threatModelPayload,
    fixtureGovernancePayload,
    securityGatesPayload,
    alertPoliciesPayload,
    redactionRulesPayload
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    threatClass: row.threatClass,
    attackSurface: row.attackSurface,
    severity: row.severity,
    blocking: row.blocking,
    pass: row.pass,
    missingControls: row.missingControls,
    missingFixtures: row.missingFixtures,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-threat-model-coverage-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      rowCount: rows.length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length,
      controlGapCount: rows.reduce((sum, row) => sum + row.missingControls.length, 0),
      fixtureGapCount: rows.reduce((sum, row) => sum + row.missingFixtures.length, 0)
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'threat-model',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'threat-model',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows: validation.rows,
    payload
  };
}

const WAIVER_SCOPE_TYPES = Object.freeze(new Set([
  'global',
  'lane',
  'language',
  'framework',
  'artifact',
  'phase'
]));

const WAIVER_APPROVER_PATTERN = /^(usr|language|framework)-[a-z0-9][a-z0-9-]*$/;
const WAIVER_EXPIRY_WARNING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const DISALLOWED_WAIVER_CLASSES = Object.freeze(new Set([
  'strict-security-bypass',
  'schema-hard-block-bypass'
]));

const toIsoDate = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
};

const toFixedDays = (ms) => Number((ms / (24 * 60 * 60 * 1000)).toFixed(2));

const buildKnownCompensatingArtifacts = ({ ownershipRows = [] } = {}) => {
  const known = new Set(
    Object.keys(USR_REPORT_SCHEMA_DEFS).map((artifactId) => `${artifactId}.json`)
  );
  for (const row of ownershipRows) {
    for (const evidenceArtifact of asStringArray(row.evidenceArtifacts)) {
      known.add(evidenceArtifact);
    }
  }
  return known;
};

export function validateUsrWaiverPolicyControls({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true
} = {}) {
  const waiverValidation = validateUsrMatrixRegistry('usr-waiver-policy', waiverPolicyPayload);
  if (!waiverValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...waiverValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const ownershipValidation = validateUsrMatrixRegistry('usr-ownership-matrix', ownershipMatrixPayload);
  if (!ownershipValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...ownershipValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const escalationValidation = validateUsrMatrixRegistry('usr-escalation-policy', escalationPolicyPayload);
  if (!escalationValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...escalationValidation.errors]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const evaluationDate = toIsoDate(evaluationTime);
  if (!evaluationDate) {
    return {
      ok: false,
      errors: Object.freeze([`invalid evaluationTime timestamp: ${evaluationTime}`]),
      warnings: Object.freeze([]),
      rows: Object.freeze([])
    };
  }

  const errors = [];
  const warnings = [];
  const rows = [];

  const waiverRows = Array.isArray(waiverPolicyPayload?.rows) ? waiverPolicyPayload.rows : [];
  const ownershipRows = Array.isArray(ownershipMatrixPayload?.rows) ? ownershipMatrixPayload.rows : [];
  const escalationRows = Array.isArray(escalationPolicyPayload?.rows) ? escalationPolicyPayload.rows : [];

  const knownArtifactIds = new Set(Object.keys(USR_REPORT_SCHEMA_DEFS));
  const knownCompensatingArtifacts = buildKnownCompensatingArtifacts({ ownershipRows });

  const governanceApprovers = new Set();
  for (const row of ownershipRows) {
    if (typeof row.ownerRole === 'string') {
      governanceApprovers.add(row.ownerRole);
    }
    if (typeof row.backupOwnerRole === 'string') {
      governanceApprovers.add(row.backupOwnerRole);
    }
  }
  for (const row of escalationRows) {
    for (const approver of asStringArray(row.requiredApprovers)) {
      governanceApprovers.add(approver);
    }
  }

  const waiverIdCounts = new Map();
  for (const row of waiverRows) {
    waiverIdCounts.set(row.id, (waiverIdCounts.get(row.id) || 0) + 1);
  }

  for (const row of waiverRows) {
    const rowErrors = [];
    const rowWarnings = [];

    if ((waiverIdCounts.get(row.id) || 0) > 1) {
      rowErrors.push('waiver id must be unique within waiver-policy matrix');
    }

    if (!WAIVER_SCOPE_TYPES.has(row.scopeType)) {
      rowErrors.push(`unsupported scopeType: ${row.scopeType}`);
    }

    if (row.scopeType === 'artifact' && !knownArtifactIds.has(row.scopeId)) {
      rowErrors.push(`artifact scopeId is not a known USR report artifact: ${row.scopeId}`);
    }

    if (DISALLOWED_WAIVER_CLASSES.has(row.waiverClass)) {
      rowErrors.push(`waiverClass is disallowed by policy: ${row.waiverClass}`);
    }

    const approvers = asStringArray(row.approvers);
    if (approvers.length === 0) {
      rowErrors.push('approvers must contain at least one approver role');
    }

    const approverSet = new Set(approvers);
    if (approverSet.size !== approvers.length) {
      rowErrors.push('approvers must be unique within a waiver row');
    }

    for (const approver of approvers) {
      if (!WAIVER_APPROVER_PATTERN.test(approver)) {
        rowErrors.push(`approver id must match governance naming policy: ${approver}`);
      }
    }

    if (row.blocking) {
      if (approvers.length < 2) {
        rowErrors.push('blocking waivers require at least two approvers');
      }
      if (!approvers.some((approver) => governanceApprovers.has(approver))) {
        rowErrors.push('blocking waivers require at least one approver in ownership/escalation governance roles');
      }
    }

    const compensatingControls = asStringArray(row.requiredCompensatingControls);
    if (compensatingControls.length === 0) {
      rowErrors.push('requiredCompensatingControls must include at least one evidence artifact');
    }

    for (const artifactFile of compensatingControls) {
      if (!artifactFile.endsWith('.json')) {
        rowErrors.push(`compensating control must reference a JSON evidence artifact: ${artifactFile}`);
        continue;
      }
      if (!knownCompensatingArtifacts.has(artifactFile)) {
        const message = `compensating control does not map to a governed report artifact: ${artifactFile}`;
        if (strictMode || row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }
    }

    const allowedUntilDate = toIsoDate(row.allowedUntil);
    let isExpired = false;
    let expiresInDays = null;
    let expiresSoon = false;

    if (!allowedUntilDate) {
      rowErrors.push(`allowedUntil must be a valid ISO 8601 timestamp: ${row.allowedUntil}`);
    } else {
      const deltaMs = allowedUntilDate.getTime() - evaluationDate.getTime();
      isExpired = deltaMs <= 0;
      expiresInDays = toFixedDays(deltaMs);
      expiresSoon = !isExpired && deltaMs <= WAIVER_EXPIRY_WARNING_WINDOW_MS;

      if (isExpired) {
        const message = `waiver is expired at evaluationTime=${evaluationDate.toISOString()}`;
        if (strictMode || row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      } else if (expiresSoon) {
        rowWarnings.push('waiver expires within 14 days and requires renewal planning');
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.id} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.id} ${message}`));
    }

    rows.push({
      id: row.id,
      waiverClass: row.waiverClass,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      blocking: Boolean(row.blocking),
      allowedUntil: row.allowedUntil,
      isExpired,
      expiresSoon,
      expiresInDays,
      approvers,
      requiredCompensatingControls: compensatingControls,
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

export function buildUsrWaiverActiveReport({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-waiver-policy-validator',
  producerVersion = null,
  runId = 'run-usr-waiver-active-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode
  });

  const activeRows = validation.rows.filter((row) => row.isExpired === false);
  const rows = activeRows.map((row) => ({
    id: row.id,
    waiverClass: row.waiverClass,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    blocking: row.blocking,
    allowedUntil: row.allowedUntil,
    expiresSoon: row.expiresSoon,
    expiresInDays: row.expiresInDays,
    approvers: row.approvers,
    requiredCompensatingControls: row.requiredCompensatingControls,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-waiver-active-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      evaluationTime,
      waiverCount: validation.rows.length,
      activeCount: rows.length,
      blockingActiveCount: rows.filter((row) => row.blocking).length,
      expiringSoonCount: rows.filter((row) => row.expiresSoon).length,
      failCount: rows.filter((row) => row.pass === false).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows: validation.rows,
    payload
  };
}

export function buildUsrWaiverExpiryReport({
  waiverPolicyPayload,
  ownershipMatrixPayload,
  escalationPolicyPayload,
  evaluationTime = new Date().toISOString(),
  strictMode = true,
  generatedAt = new Date().toISOString(),
  producerId = 'usr-waiver-policy-validator',
  producerVersion = null,
  runId = 'run-usr-waiver-expiry-report',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const validation = validateUsrWaiverPolicyControls({
    waiverPolicyPayload,
    ownershipMatrixPayload,
    escalationPolicyPayload,
    evaluationTime,
    strictMode
  });

  const rows = validation.rows.map((row) => ({
    id: row.id,
    waiverClass: row.waiverClass,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    blocking: row.blocking,
    allowedUntil: row.allowedUntil,
    isExpired: row.isExpired,
    expiresSoon: row.expiresSoon,
    expiresInDays: row.expiresInDays,
    pass: row.pass,
    errors: row.errors,
    warnings: row.warnings
  }));

  const status = validation.errors.length > 0
    ? 'fail'
    : (validation.warnings.length > 0 ? 'warn' : 'pass');

  const normalizedScope = (
    scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' }
  );

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-waiver-expiry-report',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: normalizedScope,
    summary: {
      evaluationTime,
      waiverCount: rows.length,
      expiredCount: rows.filter((row) => row.isExpired).length,
      expiringSoonCount: rows.filter((row) => row.expiresSoon).length,
      blockingExpiredCount: rows.filter((row) => row.blocking && row.isExpired).length,
      warningCount: validation.warnings.length,
      errorCount: validation.errors.length
    },
    blockingFindings: validation.errors.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    advisoryFindings: validation.warnings.map((message) => ({
      class: 'waiver-policy',
      message
    })),
    rows
  };

  return {
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
    rows: validation.rows,
    payload
  };
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











