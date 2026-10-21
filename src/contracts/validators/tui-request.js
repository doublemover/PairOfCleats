/** Bound internal native requests before recursive validation or serialization. */
export const assertBoundedTuiRequest = (value, { code, message }) => {
  const invalid = () => { throw Object.assign(new TypeError(message), { code }); };
  const stack = [{ value, depth: 0 }], seen = new Set();
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (++nodes > 4096 || entry.depth > 20) invalid();
    if (entry.value && typeof entry.value === 'object') {
      if (seen.has(entry.value)) invalid();
      seen.add(entry.value);
      const prototype = Object.getPrototypeOf(entry.value);
      if (!Array.isArray(entry.value) && prototype !== Object.prototype && prototype !== null) invalid();
      for (const key in entry.value) {
        if (!Object.hasOwn(entry.value, key)) continue;
        if (nodes + stack.length >= 4096) invalid();
        stack.push({ value: entry.value[key], depth: entry.depth + 1 });
      }
    } else if (entry.value !== null && !['boolean', 'number', 'string'].includes(typeof entry.value)) invalid();
    else if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > 128 * 1024) invalid();
  return value;
};
