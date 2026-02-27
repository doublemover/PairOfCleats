const hasIterable = (value) => value != null && typeof value[Symbol.iterator] === 'function';

/**
 * Normalize a potentially mixed type-entry collection shape into an array.
 *
 * @param {unknown} value
 * @returns {Array<unknown>}
 */
export const toTypeEntryCollection = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Set) return Array.from(value);
  if (value instanceof Map) return Array.from(value.values());
  if (hasIterable(value)) return Array.from(value);
  if (value && typeof value === 'object' && Object.hasOwn(value, 'type')) return [value];
  return [];
};

/**
 * Normalize one type entry into the canonical {type, source, confidence} shape.
 *
 * @param {unknown} entry
 * @returns {{type:string,source:string|null,confidence:number|null}|null}
 */
export const normalizeTypeEntry = (entry) => {
  if (typeof entry === 'string') {
    const type = entry.trim();
    if (!type) return null;
    return {
      type,
      source: null,
      confidence: null
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.type) return null;
  const type = String(entry.type).trim();
  if (!type) return null;
  const sourceValue = entry.source == null ? null : String(entry.source).trim();
  return {
    type,
    source: sourceValue || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
  };
};

/**
 * Merge and dedupe type entries, keeping highest-confidence variants.
 *
 * @param {unknown} existing
 * @param {unknown} incoming
 * @param {{cap?:number}} [options]
 * @returns {{list:Array<{type:string,source:string|null,confidence:number|null}>,truncated:boolean}}
 */
export const mergeTypeEntries = (existing, incoming, options = {}) => {
  const capValue = Number(options?.cap);
  const cap = Number.isFinite(capValue) && capValue > 0 ? Math.floor(capValue) : 0;
  const map = new Map();
  const addEntry = (entry) => {
    const normalized = normalizeTypeEntry(entry);
    if (!normalized) return;
    const key = `${normalized.type}:${normalized.source || ''}`;
    const prior = map.get(key);
    if (!prior) {
      map.set(key, normalized);
      return;
    }
    const priorConfidence = Number.isFinite(prior.confidence) ? prior.confidence : 0;
    const nextConfidence = Number.isFinite(normalized.confidence) ? normalized.confidence : 0;
    if (nextConfidence > priorConfidence) map.set(key, normalized);
  };
  for (const entry of toTypeEntryCollection(existing)) addEntry(entry);
  for (const entry of toTypeEntryCollection(incoming)) addEntry(entry);
  const list = Array.from(map.values());
  list.sort((a, b) => {
    const typeCmp = a.type.localeCompare(b.type);
    if (typeCmp) return typeCmp;
    const sourceCmp = String(a.source || '').localeCompare(String(b.source || ''));
    if (sourceCmp) return sourceCmp;
    const confA = Number.isFinite(a.confidence) ? a.confidence : 0;
    const confB = Number.isFinite(b.confidence) ? b.confidence : 0;
    return confB - confA;
  });
  if (cap && list.length > cap) {
    return { list: list.slice(0, cap), truncated: true };
  }
  return { list, truncated: false };
};
