import { canonicalBundleSourceKey } from '../../../shared/bundle-source-key.js';

export const normalizeIncrementalRelPath = (value) => {
  const normalized = canonicalBundleSourceKey(value);
  return normalized;
};

export const resolvePrefetchedVfsRows = (store, normalizedFile, rawFile) => {
  if (store && typeof store.get === 'function') {
    if (store.has(normalizedFile)) {
      return { hit: true, rows: store.get(normalizedFile) || null };
    }
    if (store.has(rawFile)) {
      return { hit: true, rows: store.get(rawFile) || null };
    }
    return { hit: false, rows: null };
  }
  if (store && typeof store === 'object') {
    if (Object.prototype.hasOwnProperty.call(store, normalizedFile)) {
      return { hit: true, rows: store[normalizedFile] || null };
    }
    if (Object.prototype.hasOwnProperty.call(store, rawFile)) {
      return { hit: true, rows: store[rawFile] || null };
    }
  }
  return { hit: false, rows: null };
};
