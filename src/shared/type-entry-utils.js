import { canonicalizeTypeText } from './type-normalization.js';

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
    const normalized = canonicalizeTypeText(entry);
    if (!normalized.displayText) return null;
    return {
      type: normalized.displayText,
      normalizedType: normalized.canonicalText,
      originalText: normalized.originalText,
      source: null,
      confidence: null
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.type) return null;
  const normalized = canonicalizeTypeText(entry.type, { languageId: entry.languageId || null });
  if (!normalized.displayText) return null;
  const sourceValue = entry.source == null ? null : String(entry.source).trim();
  return {
    type: normalized.displayText,
    normalizedType: normalized.canonicalText,
    originalText: typeof entry.originalText === 'string' ? entry.originalText : normalized.originalText,
    source: sourceValue || null,
    confidence: Number.isFinite(entry.confidence) ? entry.confidence : null
  };
};

const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
// Scores are existing evidence strengths, not calibrated probabilities. Missing
// confidence sorts after every explicit finite score, including explicit zero.
const compareAdmission = (left, right) => {
  const knownLeft = Number.isFinite(left.confidence), knownRight = Number.isFinite(right.confidence);
  if (knownLeft !== knownRight) return knownLeft ? -1 : 1;
  if (knownLeft && left.confidence !== right.confidence) return right.confidence - left.confidence;
  return compareText(left.normalizedType || left.type, right.normalizedType || right.type)
    || compareText(left.source || '', right.source || '')
    || compareText(left.type, right.type) || compareText(left.originalText, right.originalText);
};

// Keep capped admission streaming even for Set/Map/iterable callers. The public
// collection-conversion helper retains its existing array-returning contract.
const iterateTypeEntries = function* (value) {
  if (value == null) return;
  if (typeof value === 'string') { yield value; return; }
  if (value instanceof Map) { yield* value.values(); return; }
  if (Array.isArray(value) || value instanceof Set || hasIterable(value)) { yield* value; return; }
  if (typeof value === 'object' && Object.hasOwn(value, 'type')) yield value;
};

/**
 * Merge and dedupe by canonical type/source, admitting strongest bounded facts
 * before the existing display ordering. A zero/absent cap remains uncapped.
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
  let truncated = false;
  const addEntry = (entry) => {
    const normalized = normalizeTypeEntry(entry);
    if (!normalized) return;
    const key = JSON.stringify([normalized.normalizedType || normalized.type, normalized.source || '']);
    const prior = map.get(key);
    if (prior) {
      if (compareAdmission(normalized, prior) < 0) map.set(key, normalized);
      return;
    }
    if (!cap || map.size < cap) { map.set(key, normalized); return; }
    truncated = true;
    let weakestKey, weakest;
    for (const [candidateKey, candidate] of map) {
      if (!weakest || compareAdmission(candidate, weakest) > 0) { weakestKey = candidateKey; weakest = candidate; }
    }
    if (compareAdmission(normalized, weakest) < 0) {
      map.delete(weakestKey);
      map.set(key, normalized);
    }
  };
  for (const entry of iterateTypeEntries(existing)) addEntry(entry);
  for (const entry of iterateTypeEntries(incoming)) addEntry(entry);
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
  return { list, truncated };
};
