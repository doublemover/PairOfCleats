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
