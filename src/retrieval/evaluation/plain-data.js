/** Evaluation snapshots accept inert, bounded JSON values and own them before
 * any cooperative yield. The allowance conservatively counts retained fields. */
export const snapshotEvaluationData = (input, { maxBytes, maxNodes = 200000, maxDepth = 12,
  maxItems = 8192, code = 'ERR_EVALUATION_INPUT' } = {}) => {
  const fail = message => Object.assign(new Error(message), { code });
  if (![maxBytes, maxNodes, maxDepth, maxItems].every(value => Number.isSafeInteger(value) && value > 0)) throw fail('Evaluation snapshot requires explicit finite retained-data bounds.');
  const active = new Set(); let bytes = 0, nodes = 0;
  const charge = count => { bytes += count; if (bytes > maxBytes) throw fail('Evaluation input exceeds its retained byte allowance.'); };
  const copy = (value, depth) => {
    if (++nodes > maxNodes || depth > maxDepth) throw fail('Evaluation requires bounded plain JSON data.');
    if (value === null || typeof value === 'boolean') { charge(5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { charge(32); return value; }
    if (typeof value === 'string') {
      if (value.length > maxBytes) throw fail('Evaluation input exceeds its retained byte allowance.');
      charge(Buffer.byteLength(JSON.stringify(value))); return value;
    }
    if (!value || typeof value !== 'object' || active.has(value)
      || (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw fail('Evaluation requires bounded acyclic plain JSON data.');
    if (Array.isArray(value) && value.length > maxItems) throw fail('Evaluation arrays exceed their item allowance.');
    active.add(value); charge(2);
    const keys = Object.keys(value), result = Array.isArray(value) ? [] : Object.create(null);
    if (keys.length > maxItems || (Array.isArray(value) && (keys.length !== value.length
      || keys.some((key, index) => key !== String(index))))) throw fail('Evaluation arrays must be bounded dense JSON data.');
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Evaluation cannot execute input accessors.');
      charge(Buffer.byteLength(JSON.stringify(key)) + 2);
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    active.delete(value); return result;
  };
  return copy(input, 0);
};
