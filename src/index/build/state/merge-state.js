export const appendArrayProperty = (target, key, sourceValue) => {
  if (!Array.isArray(sourceValue)) return;
  if (!Array.isArray(target[key])) target[key] = [];
  target[key].push(...sourceValue);
};

/**
 * Copy an array property from source only when target has no entries yet.
 * Used for "first writer wins" metadata like discovery snapshots.
 */
export const copyArrayPropertyWhenTargetEmpty = (target, key, sourceValue) => {
  if (!Array.isArray(sourceValue) || !sourceValue.length) return;
  if (!Array.isArray(target[key]) || target[key].length === 0) {
    target[key] = sourceValue.slice();
  }
};

/**
 * Copy source scalar only when target does not already have a value.
 * Used for deterministic first-writer hash metadata.
 */
export const copyScalarPropertyWhenMissing = (target, key, sourceValue) => {
  if (!sourceValue) return;
  if (!target[key]) {
    target[key] = sourceValue;
  }
};

export const mergeMapEntries = (targetMap, sourceMap) => {
  if (!sourceMap || typeof sourceMap.entries !== 'function') return;
  for (const [key, value] of sourceMap.entries()) {
    targetMap.set(key, value);
  }
};

export const mergeMapEntriesIfMissing = (targetMap, sourceMap) => {
  if (!sourceMap || typeof sourceMap.entries !== 'function') return;
  for (const [key, value] of sourceMap.entries()) {
    if (!targetMap.has(key)) {
      targetMap.set(key, value);
    }
  }
};

export const mergeNumericObjectTotals = (target, key, sourceValue) => {
  if (!sourceValue || typeof sourceValue !== 'object') return;
  if (!target[key] || typeof target[key] !== 'object') {
    target[key] = { ...sourceValue };
    return;
  }
  for (const [entryKey, value] of Object.entries(sourceValue)) {
    if (!Number.isFinite(value)) continue;
    target[key][entryKey] = (target[key][entryKey] || 0) + value;
  }
};
