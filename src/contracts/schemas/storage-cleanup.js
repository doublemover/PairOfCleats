export const STORAGE_CLEANUP_PLAN_VERSION = 2;
export const LIFECYCLE_CLEANUP_PLAN_VERSION = 3;
export const STORAGE_CLEANUP_LIMITS_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  required: ['maxEntries', 'maxDurationMs'], properties: {
    maxEntries: { type: 'integer', minimum: 1, maximum: 100000 },
    maxDurationMs: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
  } });
export const assertStorageCleanupLimits = value => {
  const schema = STORAGE_CLEANUP_LIMITS_SCHEMA;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || schema.required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).length !== schema.required.length) {
    throw new TypeError('Cleanup requires exact bounded entry/time limits.');
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    if (!Number.isSafeInteger(value[key]) || value[key] < rule.minimum || value[key] > rule.maximum) throw new TypeError('Invalid cleanup ' + key + '.');
  }
  return value;
};
