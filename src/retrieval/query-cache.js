import fs from 'node:fs';

/**
 * Load query cache data from disk.
 * @param {string} cachePath
 * @returns {{version:number,entries:Array}}
 */
export function loadQueryCache(cachePath) {
  if (!fs.existsSync(cachePath)) return { version: 1, entries: [] };
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (data && Array.isArray(data.entries)) return data;
  } catch {}
  return { version: 1, entries: [] };
}

/**
 * Prune cache entries to a maximum count.
 * @param {{entries?:Array}} cache
 * @param {number} maxEntries
 * @returns {{entries?:Array}}
 */
export function pruneQueryCache(cache, maxEntries) {
  if (!cache || !Array.isArray(cache.entries)) return cache;
  cache.entries = cache.entries
    .filter((entry) => entry && entry.key && entry.ts)
    .sort((a, b) => b.ts - a.ts);
  if (cache.entries.length > maxEntries) {
    cache.entries = cache.entries.slice(0, maxEntries);
  }
  return cache;
}

/**
 * Parse JSON when given a string; otherwise return the value.
 * @param {any} value
 * @param {any} fallback
 * @returns {any}
 */
export function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
  }
  return value;
}

/**
 * Parse a field into a string array.
 * @param {any} value
 * @returns {string[]}
 */
export function parseArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = parseJson(trimmed, []);
      return Array.isArray(parsed) ? parsed : [];
    }
    return trimmed.split(/\s+/).filter(Boolean);
  }
  return [];
}
