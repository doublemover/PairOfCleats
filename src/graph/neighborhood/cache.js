export const getCachedValue = (cache, key) => {
  if (!cache || !key) return null;
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
};

export const setCachedValue = (cache, key, value, maxSize) => {
  if (!cache || !key) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  let evictions = 0;
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
    evictions += 1;
  }
  return evictions;
};
