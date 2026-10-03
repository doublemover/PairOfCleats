export const isDlopenFailure = (err) => {
  const code = err?.code || err?.cause?.code;
  if (code === 'ERR_DLOPEN_FAILED') return true;
  const message = err?.message || '';
  return message.includes('ERR_DLOPEN_FAILED');
};

export const normalizeAdapterPrewarmTexts = (value) => {
  const source = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? value.split(/[\r\n,]+/) : null);
  if (!source) return null;
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const text = typeof entry === 'string' ? entry.trim() : '';
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out.length ? out : null;
};

export const estimateTokensHeuristic = (text) => {
  const value = typeof text === 'string' ? text : String(text ?? '');
  if (!value) return 1;
  const words = value.match(/[A-Za-z0-9_]+/g)?.length || 0;
  const punctuation = value.match(/[^\sA-Za-z0-9_]/g)?.length || 0;
  return Math.max(1, words + Math.ceil(punctuation * 0.5));
};

export const touchEntry = (entry, ttlMs, now = Date.now()) => {
  if (!entry || typeof entry !== 'object') return;
  entry.lastAccessAt = now;
  entry.expiresAt = now + ttlMs;
};

export const pruneCache = (cache, { maxEntries, now = Date.now() } = {}) => {
  for (const [key, entry] of cache.entries()) {
    if (!entry || typeof entry !== 'object') {
      cache.delete(key);
      continue;
    }
    if (entry.expiresAt && entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  if (!Number.isFinite(Number(maxEntries)) || cache.size <= maxEntries) return;
  const overflow = cache.size - maxEntries;
  const oldest = Array.from(cache.entries())
    .sort((a, b) => (a[1]?.lastAccessAt || 0) - (b[1]?.lastAccessAt || 0))
    .slice(0, overflow);
  for (const [key] of oldest) {
    cache.delete(key);
  }
};
