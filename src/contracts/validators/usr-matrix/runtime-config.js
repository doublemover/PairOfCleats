export const RUNTIME_CONFIG_LAYER_ORDER = Object.freeze([
  { key: 'policyFile', label: 'policy-file' },
  { key: 'env', label: 'env' },
  { key: 'argv', label: 'argv' }
]);

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

export const coerceRuntimeConfigValue = (row, rawValue) => {
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

export const validateUnknownRuntimeKeys = ({ sourceValues, sourceLabel, knownKeys, strictMode, errors, warnings }) => {
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

export const applyRuntimeOverride = ({ row, layerLabel, rawValue, strictMode, errors, warnings }) => {
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

export const hasRuntimeConfigKey = hasOwn;
