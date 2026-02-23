/**
 * Runtime config layer precedence from lowest to highest priority.
 *
 * Precedence contract:
 * - `policy-file` is applied first, then `env`, then `argv`.
 * - A later layer only replaces a value when coercion succeeds.
 * - Failed coercions never erase the last valid value.
 */
const RUNTIME_CONFIG_LAYER_ORDER = Object.freeze([
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

const validateUnknownRuntimeKeys = ({
  sourceValues,
  sourceLabel,
  knownKeys,
  strictMode,
  errors,
  warnings
}) => {
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

/**
 * Attempt to apply a single layer override for one runtime-config row.
 *
 * Failure contract:
 * - Invalid overrides become errors only when `strictMode=true` and policy marks the key as `disallow`.
 * - All other invalid overrides are emitted as warnings.
 * - On any failure, caller retains the previously resolved value/source.
 */
const applyRuntimeOverride = ({
  row,
  layerLabel,
  rawValue,
  strictMode,
  errors,
  warnings
}) => {
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

/**
 * Resolve effective USR runtime config values from layered overrides.
 *
 * Precedence contract:
 * - Defaults are seeded from policy rows.
 * - Layers are applied in this fixed order: `policy-file` < `env` < `argv`.
 * - Higher-precedence values win only when coercion/validation succeeds.
 *
 * Failure contract:
 * - Invalid policy payload returns immediately with schema errors.
 * - Unknown keys are strict-mode errors, non-strict warnings.
 * - Invalid overrides are strict-mode errors only for `strictModeBehavior=disallow`; otherwise warnings.
 * - The resolver never throws; all failures are surfaced through `errors`/`warnings`.
 *
 * @param {{
 *   policyPayload:object,
 *   layers?:{policyFile?:object,env?:object,argv?:object},
 *   strictMode?:boolean,
 *   validateRegistry:(registryId:string,payload:object)=>{ok:boolean,errors:string[]}
 * }} [input]
 * @returns {{ok:boolean,errors:ReadonlyArray<string>,warnings:ReadonlyArray<string>,values:Readonly<Record<string,unknown>>,appliedByKey:Readonly<Record<string,string>>}}
 */
export const resolveUsrRuntimeConfig = ({
  policyPayload,
  layers = {},
  strictMode = true,
  validateRegistry
} = {}) => {
  const validator = typeof validateRegistry === 'function'
    ? validateRegistry
    : () => ({ ok: false, errors: ['missing validateRegistry callback'] });
  const policyValidation = validator('usr-runtime-config-policy', policyPayload);
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
};
