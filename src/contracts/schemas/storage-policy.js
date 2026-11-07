export const STORAGE_POLICY_VERSION = 1;
export const COMMAND_PROBE_POLICY_DEFAULTS = Object.freeze({ enabled: true, entryLimit: 256,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, hardBytes: 256 * 8 * 1024 * 1024 });
const integer = maximum => ({ type: 'integer', minimum: 0, maximum });
export const COMMAND_PROBE_STORAGE_POLICY_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  required: ['enabled', 'entryLimit', 'maxAgeMs', 'hardBytes'], properties: {
    enabled: { type: 'boolean' }, entryLimit: integer(10000), maxAgeMs: integer(Number.MAX_SAFE_INTEGER),
    hardBytes: integer(Number.MAX_SAFE_INTEGER)
  } });

/** Dependency-free validation follows the authoritative flat policy schema. */
export const assertCommandProbeStoragePolicy = (value, { partial = false } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Command-probe policy must be an object.');
  const schema = COMMAND_PROBE_STORAGE_POLICY_SCHEMA;
  if (!partial && schema.required.some(key => !Object.hasOwn(value, key))) throw new TypeError('Command-probe policy is incomplete.');
  for (const [key, field] of Object.entries(value)) {
    const rule = Object.hasOwn(schema.properties, key) ? schema.properties[key] : null;
    if (!rule || (rule.type === 'boolean' ? typeof field !== 'boolean'
      : !Number.isSafeInteger(field) || field < rule.minimum || field > rule.maximum)) {
      throw new TypeError(`Unknown or invalid command-probe policy field: ${key}`);
    }
  }
  return value;
};

/** Flat authoritative policy fields have primitive values. JSON key order is
 * not policy meaning; both sides remain strict complete current contracts.
 */
export const sameCommandProbeStoragePolicy = (left, right) => {
  assertCommandProbeStoragePolicy(left); assertCommandProbeStoragePolicy(right);
  return COMMAND_PROBE_STORAGE_POLICY_SCHEMA.required.every(key => left[key] === right[key]);
};

/** Internal coordinated planning input, not a persisted policy selection or a
 * deletion capability. Global limits remain on the existing quota owner. */
export const STORAGE_QUOTA_SCOPE_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  required: ['scope', 'id'], properties: {
    scope: { enum: ['category', 'repository'] }, id: { type: 'string', minLength: 1, maxLength: 256 },
    softBytes: integer(Number.MAX_SAFE_INTEGER), hardBytes: integer(Number.MAX_SAFE_INTEGER),
    retainCount: integer(100000), maxAgeMs: integer(Number.MAX_SAFE_INTEGER)
  } });
export const assertStorageQuotaScope = value => {
  const schema = STORAGE_QUOTA_SCOPE_SCHEMA;
  if (!value || typeof value !== 'object' || Array.isArray(value) || schema.required.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Quota scope requires its category/repository kind and exact identity.');
  }
  for (const [key, field] of Object.entries(value)) {
    const rule = Object.hasOwn(schema.properties, key) ? schema.properties[key] : null;
    if (!rule || (rule.enum ? !rule.enum.includes(field) : rule.type === 'string'
      ? typeof field !== 'string' || field.length < rule.minLength || field.length > rule.maxLength
      : !Number.isSafeInteger(field) || field < rule.minimum || field > rule.maximum)) throw new TypeError(`Unknown or invalid quota scope field: ${key}`);
  }
  if (value.softBytes !== undefined && value.hardBytes !== undefined && value.softBytes > value.hardBytes) {
    throw new TypeError('Scoped soft storage budget exceeds hard budget.');
  }
  return value;
};
