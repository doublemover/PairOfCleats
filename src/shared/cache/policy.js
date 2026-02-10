const parseNonNegativeInt = (value, label) => {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`[cache-policy] ${label} must be a non-negative number.`);
  }
  return Math.floor(numeric);
};

const parseInvalidationTriggers = (value) => {
  const raw = Array.isArray(value) ? value : [value];
  const triggers = raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
  if (!triggers.length) {
    throw new Error('[cache-policy] invalidationTrigger is required.');
  }
  return Array.from(new Set(triggers));
};

/**
 * Define a normalized cache policy contract.
 * Every cache must declare max entries/bytes, ttl, invalidation trigger, and shutdown hook.
 * @param {{
 *   name:string,
 *   maxEntries?:number|null,
 *   maxBytes?:number|null,
 *   ttlMs?:number|null,
 *   invalidationTrigger:string|string[],
 *   shutdown:(entry?:any)=>void|Promise<void>
 * }} input
 */
export const defineCachePolicy = (input = {}) => {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    throw new Error('[cache-policy] name is required.');
  }
  const shutdown = input.shutdown;
  if (typeof shutdown !== 'function') {
    throw new Error(`[cache-policy] ${name} must declare a shutdown hook.`);
  }
  const maxEntries = parseNonNegativeInt(input.maxEntries, `${name}.maxEntries`);
  const maxBytes = parseNonNegativeInt(input.maxBytes, `${name}.maxBytes`);
  const ttlMs = parseNonNegativeInt(input.ttlMs, `${name}.ttlMs`);
  const invalidationTriggers = parseInvalidationTriggers(input.invalidationTrigger);
  return Object.freeze({
    name,
    maxEntries,
    maxBytes,
    ttlMs,
    invalidationTrigger: invalidationTriggers[0],
    invalidationTriggers,
    shutdown
  });
};

/**
 * Resolve a cache policy from defaults + overrides.
 * @param {object|null|undefined} overrides
 * @param {object} defaults
 */
export const resolveCachePolicy = (overrides, defaults) => {
  const base = defaults && typeof defaults === 'object' ? defaults : {};
  const next = overrides && typeof overrides === 'object' ? overrides : {};
  return defineCachePolicy({
    name: next.name ?? base.name,
    maxEntries: next.maxEntries ?? base.maxEntries,
    maxBytes: next.maxBytes ?? base.maxBytes,
    ttlMs: next.ttlMs ?? base.ttlMs,
    invalidationTrigger: next.invalidationTrigger ?? base.invalidationTrigger,
    shutdown: next.shutdown ?? base.shutdown
  });
};

