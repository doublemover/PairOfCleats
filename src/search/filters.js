import { parseJson } from './query-cache.js';

/**
 * Normalize extension filters into a lowercase list.
 * @param {string|string[]|null|undefined} extArg
 * @returns {string[]|null}
 */
export function normalizeExtFilter(extArg) {
  const entries = Array.isArray(extArg) ? extArg : (extArg ? [extArg] : []);
  if (!entries.length) return null;
  const normalized = [];
  for (const entry of entries) {
    String(entry || '')
      .split(/[,\\s]+/)
      .map((raw) => raw.trim())
      .filter(Boolean)
      .forEach((raw) => {
        let value = raw.toLowerCase();
        value = value.replace(/^\\*+/, '');
        if (!value) return;
        if (!value.startsWith('.')) value = `.${value}`;
        normalized.push(value);
      });
  }
  return normalized.length ? Array.from(new Set(normalized)) : null;
}

/**
 * Parse --meta and --meta-json into a normalized filter list.
 * @param {string|string[]|null|undefined} metaArg
 * @param {string|string[]|null|undefined} metaJsonArg
 * @returns {Array<{key:string,value:any}>|null}
 */
export function parseMetaFilters(metaArg, metaJsonArg) {
  const filters = [];
  const pushFilter = (rawKey, rawValue) => {
    const key = String(rawKey || '').trim();
    if (!key) return;
    const value = rawValue === undefined ? null : rawValue;
    filters.push({ key, value });
  };
  const handleEntry = (entry) => {
    const text = String(entry || '').trim();
    if (!text) return;
    const split = text.split('=');
    const key = split.shift();
    const value = split.length ? split.join('=').trim() : null;
    pushFilter(key, value === '' ? null : value);
  };
  const metaEntries = Array.isArray(metaArg) ? metaArg : (metaArg ? [metaArg] : []);
  for (const entry of metaEntries) handleEntry(entry);
  const metaJsonEntries = Array.isArray(metaJsonArg) ? metaJsonArg : (metaJsonArg ? [metaJsonArg] : []);
  for (const entry of metaJsonEntries) {
    const parsed = parseJson(entry, null);
    if (!parsed) continue;
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        Object.entries(item).forEach(([key, value]) => pushFilter(key, value));
      });
    } else if (typeof parsed === 'object') {
      Object.entries(parsed).forEach(([key, value]) => pushFilter(key, value));
    }
  }
  return filters.length ? filters : null;
}
