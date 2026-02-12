import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  USR_MATRIX_SCHEMA_DEFS,
  USR_MATRIX_ROW_SCHEMAS
} from '../schemas/usr-matrix.js';

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

