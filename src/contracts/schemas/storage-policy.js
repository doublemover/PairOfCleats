export const STORAGE_POLICY_VERSION = 2;
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

export const STORAGE_POLICY_CATEGORIES = Object.freeze(['command-probes', 'lifecycle']);
const globalProperties = Object.freeze({ softBytes: integer(Number.MAX_SAFE_INTEGER),
  hardBytes: integer(Number.MAX_SAFE_INTEGER), minimumFreeBytes: integer(Number.MAX_SAFE_INTEGER),
  retainCount: integer(100000), maxAgeMs: integer(Number.MAX_SAFE_INTEGER) });
export const LIFECYCLE_QUOTA_POLICY_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  required: ['enabled', 'global', 'scopes'], properties: { enabled: { type: 'boolean' },
    global: { type: 'object', additionalProperties: false, properties: globalProperties },
    scopes: { type: 'array', maxItems: 1024, items: STORAGE_QUOTA_SCOPE_SCHEMA } } });

export const assertLifecycleQuotaPolicy = (value, { partial = false } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !partial && LIFECYCLE_QUOTA_POLICY_SCHEMA.required.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError('Lifecycle policy requires enabled, global limits and explicit category/repository scopes.');
  }
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(LIFECYCLE_QUOTA_POLICY_SCHEMA.properties, key)) throw new TypeError('Unknown lifecycle policy field: ' + key);
    if (key === 'enabled' && typeof field !== 'boolean') throw new TypeError('Lifecycle enabled must be a boolean.');
    if (key === 'global') {
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw new TypeError('Global quota limits must be an object.');
      for (const [name, limit] of Object.entries(field)) {
        const rule = globalProperties[name];
        if (!Object.hasOwn(globalProperties, name) || !Number.isSafeInteger(limit) || limit < rule.minimum || limit > rule.maximum) {
          throw new TypeError('Unknown or invalid global quota limit: ' + name);
        }
      }
      if (field.softBytes !== undefined && field.hardBytes !== undefined && field.softBytes > field.hardBytes) {
        throw new TypeError('Global soft storage budget exceeds hard budget.');
      }
    }
    if (key === 'scopes') {
      if (!Array.isArray(field) || field.length > 1024) throw new TypeError('Lifecycle policy accepts at most 1024 quota scopes.');
      const identities = new Set();
      for (const scope of field) {
        assertStorageQuotaScope(scope);
        const identity = JSON.stringify([scope.scope, scope.id]);
        if (identities.has(identity)) throw new TypeError('Duplicate lifecycle policy scope.');
        identities.add(identity);
      }
    }
  }
  return value;
};

export const assertStoragePolicyCategory = category => {
  if (!STORAGE_POLICY_CATEGORIES.includes(category)) throw new TypeError('Unregistered storage policy category.');
  return category;
};
export const assertStoragePolicy = (category, value, options = {}) => {
  assertStoragePolicyCategory(category);
  return category === 'command-probes' ? assertCommandProbeStoragePolicy(value, options) : assertLifecycleQuotaPolicy(value, options);
};
export const storagePolicyDefaults = category => {
  assertStoragePolicyCategory(category);
  return category === 'command-probes' ? { ...COMMAND_PROBE_POLICY_DEFAULTS } : { enabled: false, global: {}, scopes: [] };
};
const canonicalLimits = (value, keys) => keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]);
export const sameStoragePolicy = (category, left, right) => {
  assertStoragePolicy(category, left); assertStoragePolicy(category, right);
  if (category === 'command-probes') return sameCommandProbeStoragePolicy(left, right);
  const limits = Object.keys(globalProperties);
  const canonical = policy => [policy.enabled, canonicalLimits(policy.global, limits),
    policy.scopes.map(scope => [scope.scope, scope.id, canonicalLimits(scope, limits)])
      .sort((a, b) => { const left = JSON.stringify(a.slice(0, 2)), right = JSON.stringify(b.slice(0, 2)); return left < right ? -1 : left > right ? 1 : 0; })];
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
};
