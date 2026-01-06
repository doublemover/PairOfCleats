export function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeConfig(base, overrides) {
  if (!isPlainObject(base)) return overrides;
  if (!isPlainObject(overrides)) return base;
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeConfig(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}
