/**
 * Keep immutable memo values within entry and retained-size proxy limits.
 * Reads and replacements preserve FIFO order. The size calculation must remain
 * stable for a retained key/value; values are stored directly without wrappers.
 */
export const createFifoBudgetMemo = ({ maxEntries, maxBytes, sizeCalculation }) => {
  const entryLimit = Number.isFinite(maxEntries) ? Math.max(0, Math.floor(maxEntries)) : 0;
  const byteLimit = Number.isFinite(maxBytes) ? Math.max(0, Math.floor(maxBytes)) : 0;
  const entries = new Map();
  let retainedBytes = 0;
  const measure = (key, value) => {
    try {
      const size = sizeCalculation(value, key);
      return Number.isFinite(size) && size >= 0 ? Math.ceil(size) : Infinity;
    } catch {
      return Infinity;
    }
  };
  const remove = (key) => {
    if (!entries.has(key)) return false;
    retainedBytes = Math.max(0, retainedBytes - measure(key, entries.get(key)));
    return entries.delete(key);
  };
  return {
    get: (key) => entries.get(key),
    has: (key) => entries.has(key),
    keys: () => entries.keys(),
    set(key, value) {
      const size = measure(key, value);
      if (!entryLimit || !byteLimit || size > byteLimit) {
        remove(key);
        return false;
      }
      if (entries.has(key)) retainedBytes -= measure(key, entries.get(key));
      entries.set(key, value);
      retainedBytes += size;
      while (entries.size > entryLimit || retainedBytes > byteLimit) {
        remove(entries.keys().next().value);
      }
      return entries.has(key);
    },
    delete: remove,
    clear() {
      entries.clear();
      retainedBytes = 0;
    },
    get size() { return entries.size; },
    get retainedBytes() { return retainedBytes; }
  };
};
