import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../schemas/usr-matrix.js';
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







