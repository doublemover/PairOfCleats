/** Deterministic retained-projection accounting, not measured V8 heap/RSS.
 * Visit iteratively, stop before crossing admission, and include typed-array
 * backing stores without detaching borrowed buffers. */
export const measureBundleProjectionBytes = (value, limit = Number.MAX_SAFE_INTEGER) => {
  const seen = new WeakSet(), stack = [{ value }]; let bytes = 0;
  const charge = amount => {
    bytes += amount;
    if (!Number.isSafeInteger(bytes) || bytes > limit) throw Object.assign(
      new Error('Decoded bundle exceeds its admitted projection-byte allowance.'), { code: 'ERR_SQLITE_BUNDLE_DECODE_BUDGET' });
  };
  while (stack.length) {
    const frame = stack.at(-1);
    if (frame.iterator) {
      const next = frame.iterator.next();
      if (next.done) { stack.pop(); continue; }
      charge(frame.map ? 48 : 32);
      if (frame.map) { stack.push({ value: next.value[1] }); stack.push({ value: next.value[0] }); }
      else stack.push({ value: next.value });
      continue;
    }
    if (frame.keys) {
      if (frame.index >= frame.keys.length) { stack.pop(); continue; }
      const key = frame.keys[frame.index++]; charge(key.length * 2 + 48);
      stack.push({ value: frame.value[key] }); continue;
    }
    if (frame.array) {
      if (frame.index >= frame.value.length) { stack.pop(); continue; }
      charge(8); stack.push({ value: frame.value[frame.index++] }); continue;
    }
    const item = frame.value;
    if (item == null) { charge(8); stack.pop(); continue; }
    if (typeof item === 'string') { charge(item.length * 2 + 32); stack.pop(); continue; }
    if (typeof item !== 'object') { charge(8); stack.pop(); continue; }
    if (seen.has(item)) { stack.pop(); continue; }
    seen.add(item); charge(64);
    if (ArrayBuffer.isView(item)) { stack.pop(); stack.push({ value: item.buffer }); continue; }
    if (item instanceof ArrayBuffer || item instanceof SharedArrayBuffer) { charge(item.byteLength); stack.pop(); continue; }
    if (item instanceof Map || item instanceof Set) { frame.iterator = item[Symbol.iterator](); frame.map = item instanceof Map; continue; }
    if (Array.isArray(item)) { frame.array = true; frame.index = 0; continue; }
    frame.keys = Object.keys(item); frame.index = 0;
  }
  return bytes;
};
