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

const OBSERVABILITY_METRIC_SELECTORS = Object.freeze({
  capability_downgrade_rate: (metrics) => metrics.capabilityDowngradeRate,
  critical_diagnostic_count: (metrics) => metrics.criticalDiagnosticCount,
  lane_duration_ms: (metrics) => metrics.durationMs,
  lane_peak_memory_mb: (metrics) => metrics.peakMemoryMb,
  redaction_failure_count: (metrics) => metrics.redactionFailureCount,
  unknown_kind_rate: (metrics) => metrics.unknownKindRate,
  unresolved_reference_rate: (metrics) => metrics.unresolvedRate
});

const compareByOperator = ({ left, operator, right }) => {
  if (operator === '>') {
    return left > right;
  }
  if (operator === '>=') {
    return left >= right;
  }
  if (operator === '<') {
    return left < right;
  }
  if (operator === '<=') {
    return left <= right;
  }
  if (operator === '==') {
    return left === right;
  }
  return false;
};

const normalizeObservabilityLaneMetrics = (observedLaneMetrics) => {
  if (Array.isArray(observedLaneMetrics)) {
    return new Map(
      observedLaneMetrics
        .filter((row) => row && typeof row === 'object' && typeof row.laneId === 'string')
        .map((row) => [row.laneId, row])
    );
  }

  if (observedLaneMetrics && typeof observedLaneMetrics === 'object') {
    return new Map(
      Object.entries(observedLaneMetrics)
        .filter(([, value]) => value && typeof value === 'object')
        .map(([laneId, value]) => [laneId, { laneId, ...value }])
    );
  }

  return new Map();
};

const validateObservedNumber = ({ value, field, rowErrors, rowWarnings, blocking }) => {
  if (Number.isFinite(value)) {
    return true;
  }
  const message = `observed metric missing or non-numeric: ${field}`;
  if (blocking) {
    rowErrors.push(message);
  } else {
    rowWarnings.push(message);
  }
  return false;
};

export function evaluateUsrObservabilityRollup({
  sloBudgetsPayload,
  alertPoliciesPayload,
  observedLaneMetrics = {}
} = {}) {
  const sloValidation = validateUsrMatrixRegistry('usr-slo-budgets', sloBudgetsPayload);
  if (!sloValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...sloValidation.errors]),
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

  const errors = [];
  const warnings = [];
  const rows = [];

  const sloRows = Array.isArray(sloBudgetsPayload?.rows) ? sloBudgetsPayload.rows : [];
  const alertRows = Array.isArray(alertPoliciesPayload?.rows) ? alertPoliciesPayload.rows : [];
  const metricsByLane = normalizeObservabilityLaneMetrics(observedLaneMetrics);

  for (const row of sloRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = metricsByLane.get(row.laneId) || null;

    if (!observed) {
      const message = `missing observed lane metrics for laneId=${row.laneId}`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else {
      const durationOk = validateObservedNumber({
        value: observed.durationMs,
        field: 'durationMs',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (durationOk && observed.durationMs > row.maxDurationMs) {
        const message = `durationMs exceeds slo maxDurationMs: ${observed.durationMs} > ${row.maxDurationMs}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const memoryOk = validateObservedNumber({
        value: observed.peakMemoryMb,
        field: 'peakMemoryMb',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (memoryOk && observed.peakMemoryMb > row.maxMemoryMb) {
        const message = `peakMemoryMb exceeds slo maxMemoryMb: ${observed.peakMemoryMb} > ${row.maxMemoryMb}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const parserOk = validateObservedNumber({
        value: observed.parserTimePerSegmentMs,
        field: 'parserTimePerSegmentMs',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (parserOk && observed.parserTimePerSegmentMs > row.maxParserTimePerSegmentMs) {
        const message = `parserTimePerSegmentMs exceeds slo maxParserTimePerSegmentMs: ${observed.parserTimePerSegmentMs} > ${row.maxParserTimePerSegmentMs}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const unknownKindOk = validateObservedNumber({
        value: observed.unknownKindRate,
        field: 'unknownKindRate',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (unknownKindOk && observed.unknownKindRate > row.maxUnknownKindRate) {
        const message = `unknownKindRate exceeds slo maxUnknownKindRate: ${observed.unknownKindRate} > ${row.maxUnknownKindRate}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }

      const unresolvedOk = validateObservedNumber({
        value: observed.unresolvedRate,
        field: 'unresolvedRate',
        rowErrors,
        rowWarnings,
        blocking: row.blocking
      });
      if (unresolvedOk && observed.unresolvedRate > row.maxUnresolvedRate) {
        const message = `unresolvedRate exceeds slo maxUnresolvedRate: ${observed.unresolvedRate} > ${row.maxUnresolvedRate}`;
        if (row.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors.map((message) => `${row.laneId} ${message}`));
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings.map((message) => `${row.laneId} ${message}`));
    }

    rows.push({
      rowType: 'slo-budget',
      laneId: row.laneId,
      scopeId: row.scopeId,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const [laneId] of metricsByLane.entries()) {
    if (!sloRows.some((row) => row.laneId === laneId)) {
      warnings.push(`observed lane metrics without matching slo budget row: ${laneId}`);
    }
  }

  for (const alert of alertRows) {
    const metricSelector = OBSERVABILITY_METRIC_SELECTORS[alert.metric];
    if (!metricSelector) {
      const message = `unsupported alert metric mapping: ${alert.metric}`;
      if (alert.blocking) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
      continue;
    }

    for (const [laneId, observed] of metricsByLane.entries()) {
      const rowErrors = [];
      const rowWarnings = [];
      const observedValue = metricSelector(observed);
      const numeric = Number.isFinite(observedValue);
      let triggered = false;

      if (!numeric) {
        const message = `observed metric missing or non-numeric for alert ${alert.id}: ${alert.metric}`;
        if (alert.blocking) {
          rowErrors.push(message);
        } else {
          rowWarnings.push(message);
        }
      } else {
        triggered = compareByOperator({
          left: observedValue,
          operator: alert.comparator,
          right: alert.threshold
        });

        if (triggered) {
          const message = `alert triggered ${alert.metric} ${alert.comparator} ${alert.threshold} (observed=${observedValue})`;
          if (alert.blocking) {
            rowErrors.push(message);
          } else {
            rowWarnings.push(message);
          }
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors.map((message) => `${alert.id} ${laneId} ${message}`));
      }
      if (rowWarnings.length > 0) {
        warnings.push(...rowWarnings.map((message) => `${alert.id} ${laneId} ${message}`));
      }

      rows.push({
        rowType: 'alert-evaluation',
        id: `${alert.id}::${laneId}`,
        alertId: alert.id,
        laneId,
        metric: alert.metric,
        comparator: alert.comparator,
        threshold: alert.threshold,
        observedValue: numeric ? observedValue : null,
        severity: alert.severity,
        escalationPolicyId: alert.escalationPolicyId,
        blocking: Boolean(alert.blocking),
        triggered,
        pass: rowErrors.length === 0,
        errors: Object.freeze([...rowErrors]),
        warnings: Object.freeze([...rowWarnings])
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
    warnings: Object.freeze([...warnings]),
    rows: Object.freeze(rows)
  };
}

export function buildUsrObservabilityRollupReport({
  sloBudgetsPayload,
  alertPoliciesPayload,
  observedLaneMetrics = {},
  generatedAt = new Date().toISOString(),
  producerId = 'usr-observability-rollup-evaluator',
  producerVersion = null,
  runId = 'run-usr-observability-rollup',
  lane = 'ci',
  buildId = null,
  scope = { scopeType: 'global', scopeId: 'global' }
} = {}) {
  const evaluation = evaluateUsrObservabilityRollup({
    sloBudgetsPayload,
    alertPoliciesPayload,
    observedLaneMetrics
  });

  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

  const payload = {
    schemaVersion: 'usr-1.0.0',
    artifactId: 'usr-observability-rollup',
    generatedAt,
    producerId,
    producerVersion,
    runId,
    lane,
    buildId,
    status,
    scope: scope && typeof scope === 'object'
      ? {
          scopeType: typeof scope.scopeType === 'string' ? scope.scopeType : 'global',
          scopeId: typeof scope.scopeId === 'string' ? scope.scopeId : 'global'
        }
      : { scopeType: 'global', scopeId: 'global' },
    summary: {
      rowCount: rows.length,
      sloBudgetRowCount: rows.filter((row) => row.rowType === 'slo-budget').length,
      alertEvaluationRowCount: rows.filter((row) => row.rowType === 'alert-evaluation').length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      alertTriggerCount: rows.filter((row) => row.rowType === 'alert-evaluation' && row.triggered).length,
      blockingAlertTriggerCount: rows.filter((row) => row.rowType === 'alert-evaluation' && row.blocking && row.triggered).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'observability',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'observability',
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

const normalizeObservedResultMap = (observedResults, keyField = 'id') => {
  if (observedResults instanceof Map) {
    return new Map(observedResults.entries());
  }

  if (Array.isArray(observedResults)) {
    return new Map(
      observedResults
        .filter((row) => row && typeof row === 'object' && typeof row[keyField] === 'string')
        .map((row) => [row[keyField], row])
    );
  }

  if (observedResults && typeof observedResults === 'object') {
    return new Map(Object.entries(observedResults));
  }

  return new Map();
};

const resolveObservedGatePass = (observed) => {
  if (typeof observed === 'boolean') {
    return observed;
  }

  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return observed.pass;
    }
    if (typeof observed.status === 'string') {
      return observed.status.toLowerCase() === 'pass';
    }
  }

  return null;
};

const resolveObservedRedactionResult = (observed) => {
  if (typeof observed === 'boolean') {
    return {
      pass: observed,
      misses: observed ? 0 : null
    };
  }

  if (observed && typeof observed === 'object') {
    if (typeof observed.pass === 'boolean') {
      return {
        pass: observed.pass,
        misses: Number.isFinite(observed.misses) ? observed.misses : null
      };
    }

    if (Number.isFinite(observed.misses)) {
      return {
        pass: observed.misses <= 0,
        misses: observed.misses
      };
    }
  }

  return {
    pass: null,
    misses: null
  };
};

export function validateUsrSecurityGateControls({
  securityGatesPayload,
  redactionRulesPayload,
  gateResults = {},
  redactionResults = {}
} = {}) {
  const securityValidation = validateUsrMatrixRegistry('usr-security-gates', securityGatesPayload);
  if (!securityValidation.ok) {
    return {
      ok: false,
      errors: Object.freeze([...securityValidation.errors]),
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

  const securityRows = Array.isArray(securityGatesPayload?.rows) ? securityGatesPayload.rows : [];
  const redactionRows = Array.isArray(redactionRulesPayload?.rows) ? redactionRulesPayload.rows : [];
  const gateResultMap = normalizeObservedResultMap(gateResults, 'id');
  const redactionResultMap = normalizeObservedResultMap(redactionResults, 'id');

  for (const row of securityRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = gateResultMap.get(row.id) ?? gateResultMap.get(row.check) ?? null;
    const observedPass = resolveObservedGatePass(observed);
    const treatAsBlocking = Boolean(row.blocking || row.enforcement === 'strict');

    if (observedPass === null) {
      const message = `missing security-gate result for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const message = `security-gate failed for ${row.id} (${row.check})`;
      if (treatAsBlocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    rows.push({
      rowType: 'security-gate',
      id: row.id,
      check: row.check,
      scope: row.scope,
      enforcement: row.enforcement,
      blocking: treatAsBlocking,
      pass: rowErrors.length === 0,
      errors: Object.freeze([...rowErrors]),
      warnings: Object.freeze([...rowWarnings])
    });
  }

  for (const row of redactionRows) {
    const rowErrors = [];
    const rowWarnings = [];
    const observed = redactionResultMap.get(row.id) ?? redactionResultMap.get(row.class) ?? null;
    const { pass: observedPass, misses } = resolveObservedRedactionResult(observed);

    if (observedPass === null) {
      const message = `missing redaction result for ${row.id} (${row.class})`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    } else if (!observedPass) {
      const suffix = Number.isFinite(misses) ? ` misses=${misses}` : '';
      const message = `redaction rule failed for ${row.id} (${row.class})${suffix}`;
      if (row.blocking) {
        rowErrors.push(message);
      } else {
        rowWarnings.push(message);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    }
    if (rowWarnings.length > 0) {
      warnings.push(...rowWarnings);
    }

    rows.push({
      rowType: 'redaction-rule',
      id: row.id,
      class: row.class,
      blocking: Boolean(row.blocking),
      pass: rowErrors.length === 0,
      misses: Number.isFinite(misses) ? misses : null,
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
  const evaluation = validateUsrSecurityGateControls({
    securityGatesPayload,
    redactionRulesPayload,
    gateResults,
    redactionResults
  });

  const status = evaluation.errors.length > 0
    ? 'fail'
    : (evaluation.warnings.length > 0 ? 'warn' : 'pass');

  const rows = evaluation.rows.map((row) => ({
    ...row,
    errors: row.errors,
    warnings: row.warnings
  }));

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
    scope: normalizeReportScope(scope, 'lane', lane),
    summary: {
      rowCount: rows.length,
      securityGateRowCount: rows.filter((row) => row.rowType === 'security-gate').length,
      redactionRuleRowCount: rows.filter((row) => row.rowType === 'redaction-rule').length,
      passCount: rows.filter((row) => row.pass).length,
      failCount: rows.filter((row) => !row.pass).length,
      blockingFailureCount: rows.filter((row) => row.blocking && !row.pass).length,
      warningCount: evaluation.warnings.length,
      errorCount: evaluation.errors.length
    },
    blockingFindings: evaluation.errors.map((message) => ({
      class: 'security-gate',
      message
    })),
    advisoryFindings: evaluation.warnings.map((message) => ({
      class: 'security-gate',
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
    rows: evaluation.rows,
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











