import { types } from 'node:util';

/** Own bounded inert JSON before any cooperative yield. Domain adapters retain
 * their error vocabulary; this performs no source, path or resource admission. */
export const snapshotPlainData = (input, { maxBytes, maxNodes = 200000, maxDepth = 12,
  maxItems = 8192, code = 'ERR_PLAIN_DATA', label = 'Plain data', freeze = false, nullPrototype = true } = {}) => {
  const fail = message => Object.assign(new Error(message), { code });
  if (![maxBytes, maxNodes, maxDepth, maxItems].every(value => Number.isSafeInteger(value) && value > 0)) throw fail(`${label} snapshot requires explicit finite retained-data bounds.`);
  const active = new Set(); let bytes = 0, nodes = 0;
  const charge = count => { bytes += count; if (bytes > maxBytes) throw fail(`${label} input exceeds its retained byte allowance.`); };
  const copy = (value, depth) => {
    if (++nodes > maxNodes || depth > maxDepth) throw fail(`${label} requires bounded plain JSON data.`);
    if (value === null || typeof value === 'boolean') { charge(5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { charge(32); return value; }
    if (typeof value === 'string') {
      if (value.length > maxBytes) throw fail(`${label} input exceeds its retained byte allowance.`);
      charge(Buffer.byteLength(JSON.stringify(value))); return value;
    }
    if (!value || typeof value !== 'object' || types.isProxy(value) || active.has(value)
      || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw fail(`${label} requires bounded acyclic plain JSON data.`);
    if (Array.isArray(value) && value.length > maxItems) throw fail(`${label} arrays exceed their item allowance.`);
    active.add(value); charge(2);
    const keys = Object.keys(value), names = Reflect.ownKeys(value), array = Array.isArray(value);
    if (names.some(key => typeof key !== 'string') || names.length !== keys.length + (array ? 1 : 0)) throw fail(`${label} cannot retain hidden or symbolic input fields.`);
    const result = array ? [] : nullPrototype ? Object.create(null) : {};
    if (keys.length > maxItems || (array && (keys.length !== value.length
      || keys.some((key, index) => key !== String(index))))) throw fail(`${label} arrays must be bounded dense JSON data.`);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail(`${label} cannot execute input accessors.`);
      charge(Buffer.byteLength(JSON.stringify(key)) + 2);
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(value); return freeze ? Object.freeze(result) : result;
  };
  return copy(input, 0);
};
